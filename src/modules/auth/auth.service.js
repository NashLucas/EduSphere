// ─────────────────────────────────────────────────────────────────────────────
// Auth service — TRD §6.1, §7. Task 3.3 opened this file with register() and task
// 3.4 adds login(); refresh, logout, password recovery and email verification
// land here as tasks 3.5–3.8 and share the helpers at the top.
//
// The service knows nothing about HTTP. It returns plain objects and throws from
// the AppError taxonomy; the controller (task 3.9) turns those into envelopes and
// status codes (plan:1021). That is why there is no `res` anywhere below, and why
// the one place this file reaches for a status code — a 409 versus a 503 — does it
// by choosing a constructor rather than a number.
//
// ── WHY THE REDIS WRITE SITS INSIDE THE POSTGRES TRANSACTION ─────────────────
//
// register() writes two stores: the `users` row in PostgreSQL and the
// `verify:email:<sha256(token)>` key in Redis. The obvious arrangement is to
// commit the user first and then write the token, because a transaction that
// spans a second datastore is a distributed-transaction fiction and holds a pool
// connection open across a network call to something else.
//
// It is still wrong here, and the reason is a gap in the endpoint surface rather
// than a preference. THERE IS NO RESEND-VERIFICATION ENDPOINT: searched, the
// string "resend" appears nowhere in EduTRD.md, docs/apidoc.md or
// IMPLEMENTATION_PLAN.md, and TRD §6.1 lists exactly one way to obtain a
// verification token — registering. So a user row that commits without its token
// is not "unverified for now", it is unverifiable forever. TRD:1482 makes that
// permanent state expensive: the account can log in and browse, and is refused by
// POST /enrollments, POST /courses and every quiz submission for the rest of its
// life. It cannot even start over, because re-registering the same address is the
// 409 below.
//
// Rolling the user row back instead costs the caller a 503 and a retry, which is
// the strictly recoverable failure. So the token write is inside the transaction,
// and a Redis outage means no account was created rather than a broken one.
//
// The cost is bounded and was measured, not assumed. With Redis stopped,
// register() threw its 503 after 626 ms and created no row: at the start of an
// outage src/config/redis.js's maxRetriesPerRequest (2) is what fires, and as the
// outage lengthens and the backoff grows its commandTimeout takes over with a
// hard ~1 s ceiling on any single command. Prisma's default interactive
// transaction deadline is 5000 ms — read out of its own P2028 error text rather
// than the docs — so both bounds sit comfortably inside it. The worst case is a
// transaction held ~1 s longer than usual during an outage that is already
// failing every request.
//
// What this does NOT buy is atomicity, and the residual failure is worth naming
// for task 3.8: if the Redis write succeeds and the COMMIT then fails, the token
// survives pointing at a userId that was rolled back. verifyEmail() must
// therefore treat "key resolved to a userId with no matching user" as an invalid
// token rather than as an impossible state. It self-heals in 24 h either way.
//
// ── THE 409 IS GENERIC, AND THE PRE-CHECK IS NOT WHAT GUARANTEES IT ──────────
//
// TRD:1480 requires register to return "a generic 409 that does not distinguish
// 'already registered' from other conflicts", so the throw below carries
// MESSAGES.COMMON.CONFLICT and never the wording in apidoc §8.2's 409 row — that
// row describes the trigger, the way apidoc §5's 409 row lists six unrelated
// triggers for the same code, and is not a response body.
//
// Uniqueness is checked twice on purpose, and only the second check is load-
// bearing. The findUnique() pre-check exists because plan:344 puts it first and
// because it keeps ~290 ms of bcrypt off the duplicate-registration path; it is
// inherently racy, since two concurrent registrations of one address both pass it.
// The `email @unique` index is what actually decides, and the P2002 catch is what
// turns its verdict into the same 409 the pre-check produces. That the catch is
// load-bearing rather than defensive was demonstrated: two register() calls for
// one fresh address launched together produced one row, one success and one
// rejection, and the loser's 409 came from this catch. Converting P2002
// here rather than leaning on normalizeError() — which already maps it to an
// identical 409 — keeps the service's contract true without an HTTP layer
// underneath it, so a unit test can assert the conflict directly.
//
// Neither check filters on `deletedAt`, which looks like an omission and is not:
// TRD:1497 rewrites a deleted account's email to `deleted-<uuid>@invalid`
// specifically so the original address becomes reusable, so a soft-deleted row
// no longer holds the address being registered. Were one to hold it anyway, the
// unique index would refuse the insert and the answer would still be 409.
//
// ── WHAT register() DELIBERATELY DOES NOT RETURN ─────────────────────────────
//
// A conflict between the two documents, resolved in favour of the plan and left
// visible here rather than silently.
//
// plan:344 ends "return sanitized user object (no passwordHash)". apidoc §8.2's
// 201 body is `data: { user: {...}, accessToken: "eyJ..." }`. Minting that token
// is task 3.4's job — it is the task that introduces JWT_SECRET, the 15-minute
// lifetime and the `jti` — and it does not exist yet, so this function cannot
// produce one without pre-empting it.
//
// So register() returns the user, and task 3.9's controller is responsible for
// composing `{ user, accessToken }` from 3.4's helper. Two notes for whoever
// writes it: a register-issued access token arrives at requireAuth (3.10) with no
// `user:state:<id>` record, because plan:376 writes that key on login, on
// ban/unban and on role change but not on registration — which is survivable
// only because a MISS on user:state is defined to fall through to PostgreSQL and
// re-derive the truth (src/utils/cache-keys.js:316), unlike a Redis outage, which
// fails closed. If 3.10 instead treats an absent key as "not authorized", a
// register-issued token is dead on arrival and this is where that starts.
//
// ── THE INSTRUCTOR PROFILE IS NOT CREATED HERE, AND THAT IS A KNOWN GAP ──────
//
// plan:412 (task 4.10) requires that registering as INSTRUCTOR create the
// `Instructor` profile row "in the same transaction", and warns that a user with
// role INSTRUCTOR and no profile row "cannot author anything, and the failure
// surfaces much later as a null dereference in an ownership check".
//
// It is still left to 4.10, because doing it now would get it wrong in a way that
// task would have to undo. `Instructor.title` is required with no default in
// schema.prisma, and the register body carries no title — apidoc §8.2's body is
// fullName/email/password/role — so creating the row here means inventing a
// default title, which is user-visible text on a public instructor profile
// (apidoc §8.4). And plan:412's actual requirement is that registration and admin
// elevation "must use the same helper"; the elevation call site does not exist
// yet, so a version written here becomes the duplicate that requirement exists to
// prevent. The insertion point is marked below.
//
// Until 4.10 lands, an account registered with role INSTRUCTOR has no Instructor
// row. It is created, it can log in, and it will fail on its first authoring
// call.
//
// ═════════════════════════════════════════════════════════════════════════════
// login() — task 3.4
// ═════════════════════════════════════════════════════════════════════════════
//
// ── WHY LOGIN SPENDS ~370 ms ON A PASSWORD IT ALREADY KNOWS IS WRONG ─────────
//
// MESSAGES.AUTH.INVALID_CREDENTIALS is "deliberately identical for an unknown
// email and a wrong password" so the login form cannot be used to test whether an
// address has an account. The obvious implementation throws that message away for
// free: `if (!user) throw Unauthorized` returns before bcrypt runs, so an unknown
// address answers in about a millisecond while a known address with a wrong
// password spends a full cost-12 comparison first. The message is identical and
// the RESPONSE TIME is not, which is the same oracle with extra steps.
//
// Measured here over 7 runs each, cost 12: no comparison at all is ~0.0 ms, a
// comparison against a real hash is 373 ms median (349-448). A 373 ms split is not
// a subtle side channel — it is legible over the internet, in one request, without
// statistics.
//
// So a miss compares against DECOY_HASH instead of returning early, and both paths
// pay for one comparison. Re-measured with the decoy in place: 396 ms median
// (351-468) for the miss against 373 ms (349-448) for the wrong password, a 23 ms
// median gap between two ranges that almost entirely overlap. That residual is
// scheduling noise rather than signal, and the AUTH rate-limit tier (5 requests /
// 15 min, RATE_LIMITS.AUTH) is what makes averaging it away impractical. The claim
// is "no single-request oracle", not "constant time".
//
// What this deliberately does NOT do is skip the comparison when the password
// could not possibly match. Every early exit is a timing branch.
//
// ── PASSWORD FIRST, THEN THE ACCOUNT CHECKS ──────────────────────────────────
//
// plan:345 orders it "verify password hash → check isBanned → check deletedAt",
// and the order is the point rather than an incidental. Checking the ban first
// would answer 403 to anyone who merely guessed an address, which tells a stranger
// both that the account exists and that it is banned. After the password check,
// the 403 of apidoc §8.2 is only ever read by someone who owns the credentials —
// which is exactly why that row can afford to be honest ("the caller proved
// identity; the account is denied") where the 401 above cannot.
//
// The deletedAt check is defence in depth and looks like dead code. TRD:1497
// rewrites a soft-deleted account's email to `deleted-<uuid>@invalid`, so the
// lookup normally misses and the answer is the 401, not the 403. It stays because
// nothing in the schema enforces that rewrite: a row soft-deleted by a path that
// forgets it would otherwise keep logging in forever. Note the check is
// `!== null` rather than a truthiness test, so a future select that drops the
// column denies every login instead of admitting every deleted account — loud, and
// in the safe direction.
//
// ── TWO KEYS, TWO JTIS, AND WHICH ONE NAMES THE SESSION ──────────────────────
//
// Access tokens are signed with JWT_SECRET and refresh tokens with
// JWT_REFRESH_SECRET (TRD:1669), "two distinct keys, so a leaked access-signing
// key cannot mint refresh tokens". plan:384 states the observable form of that:
// a refresh token presented as a Bearer token must fail signature verification.
// The `type` claim in each payload is secondary — RFC 8725 §3.11 defence in depth
// so 3.5 and 3.10 can also reject a confused token explicitly — and must never
// become the thing a verifier relies on instead of the key.
//
// env.js already refuses identical secrets at boot, and jwtConfig() below checks
// it again on every call. That is not redundant: env.js is imported by
// src/server.js and by nothing else on purpose (it calls process.exit(1)), so this
// module cannot assume it ever ran. A script, a worker, or a test that reaches
// login() with one secret set for both classes gets a loud throw rather than
// silently minting interchangeable tokens.
//
// Both tokens carry their own unique jti, per plan:345. Only the REFRESH one is
// remembered. TRD §7.1 calls session:<jti> the "active refresh-token record", 3.5
// verifies the cookie's token and then looks for exactly that key, and 3.6 needs
// the same jti to UNLINK — all three reach it through the cookie, which TRD:1673
// makes readable only by /auth/refresh and /auth/logout. The access token's jti is
// generated and discarded: nothing indexes access tokens, because their revocation
// story is user:state plus a 15-minute lifetime, not a keyspace lookup per request
// (plan:376). Keeping them distinct means a leaked access token does not name the
// session key that would let its holder mint new ones.
//
// ── THE ORDER OF THE THREE REDIS WRITES IS A SECURITY PROPERTY ───────────────
//
// SADD the index entry, then SET the session, then SET user:state. Not the reading
// order, and not arbitrary.
//
// Any of the three can fail mid-sequence, so the question is which partial states
// are survivable. Index-first means a jti can exist in the index with no session
// key behind it, which plan:367 and TRD:1723 both declare inert — the index is
// specified as a SUPERSET, since nothing prunes a jti whose session merely expired,
// and "UNLINK on a dead jti is harmless". Session-first inverts that into a
// session:<jti> key that no index lists, and a session absent from the index is a
// session that "revoke all sessions" (plan:373) walks straight past — refreshable
// for its full 7 days and surviving the ban that was supposed to kill it. The
// weaker guarantee is the one worth holding: never a session the index does not
// know about.
//
// user:state goes last because its absence is the one failure the system already
// has a defined answer for. A MISS on user:state falls through to PostgreSQL and
// re-derives the truth (src/utils/cache-keys.js:316) — that is also why a
// register-issued token works at all — whereas an unreachable Redis fails closed
// (plan:379). A missing state key costs one query; the other two orderings cost
// correctness.
//
// The three are sequential awaits rather than a MULTI, and atomicity is worth what
// the paragraphs above say it is worth: the only reachable partial state is inert
// by specification, so a transaction would buy tidiness rather than safety. It
// would cost the setWithTTL guarantees — mandatory positive TTL, JSON encoding, EX
// re-applied on every write — which a pipelined raw SET would have to duplicate,
// and duplicated key handling is what cache-keys.js exists to prevent (TRD §7.1).
// Three local round trips are ~1 ms each.
//
// A failure in any of them is a 503 and NO TOKENS. Returning the pair anyway would
// hand back a working 15-minute access token whose refresh path is already dead,
// so the client discovers the outage 15 minutes later as an unexplained logout;
// 3.5 makes the same choice explicitly ("fail closed with 503 if Redis is
// unreachable"). The user row is untouched either way — login writes no Postgres —
// so unlike register() there is nothing to roll back.
//
// ── TWO TTLS SHADOW TWO ENV VARS, AND THE ENV VARS DO NOT WIN ────────────────
//
// TTL.session (7 days) and TTL.userState (15 minutes) are fixed in cache-keys.js,
// while the token lifetimes they mirror come from JWT_REFRESH_EXPIRES_IN and
// JWT_ACCESS_EXPIRES_IN. Raising JWT_REFRESH_EXPIRES_IN to 30d does not extend a
// session: the refresh token stays cryptographically valid while session:<jti>
// expires at 7 days, and 3.5 requires that key to exist, so the effective lifetime
// is the MINIMUM of the two. The failure is a working token that stops being
// accepted, which reads as a bug.
//
// Lowering JWT_ACCESS_EXPIRES_IN below 15 minutes is safe. Raising it is not, and
// plan:370 says why: user:state's TTL is 15 minutes BECAUSE that is the access
// token's lifetime, so a 1-hour access token means a banned user keeps working for
// up to an hour after the ban ("banned users rejected within one user:state TTL,
// not one access-token TTL", plan:388). Neither coupling is enforced here — that
// would mean re-implementing the `ms` duration grammar jsonwebtoken already owns —
// so it is documented instead, and the defaults below match the TTLs exactly.
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes, randomUUID } from 'node:crypto';

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import prisma from '../../database/index.js';
import redis from '../../config/redis.js';
import { BCRYPT_ROUNDS, TOKEN, UserRole } from '../../config/constants.js';
import { MESSAGES } from '../../config/system_messages.js';
import {
  ConflictError,
  ForbiddenError,
  ServiceUnavailableError,
  UnauthorizedError,
} from '../../utils/app-error.js';
import { keys, setWithTTL, TTL } from '../../utils/cache-keys.js';
import { sendVerificationEmail } from '../../integrations/email/index.js';
import { logger } from '../../middlewares/logging.middleware.js';

const log = logger.child({ module: 'auth' });

/**
 * The user shape that may leave this module — apidoc §8.2's `data.user`, exactly.
 *
 * A Prisma `select` rather than a delete-the-field-afterwards, so `passwordHash`
 * is never read out of the database at all. The difference matters the moment a
 * caller logs or serialises whatever it was handed: a field that was never
 * fetched cannot leak from an object nobody remembered to strip.
 */
const PUBLIC_USER_FIELDS = Object.freeze({
  id: true,
  fullName: true,
  email: true,
  role: true,
  isEmailVerified: true,
});

/**
 * The roles a stranger may claim for themselves.
 *
 * An allow-list, never `role !== 'ADMIN'`: plan:342 makes the point that a
 * negative check "is one future enum member away from being wrong", while a list
 * of the roles self-registration may mint is wrong only if someone edits it.
 */
const SELF_SERVICE_ROLES = Object.freeze([
  UserRole.STUDENT,
  UserRole.INSTRUCTOR,
]);

/**
 * A single-use token for an emailed link — verification (24 h) and, from task
 * 3.7, password reset (15 min).
 *
 * `randomBytes`, not `Math.random` or a timestamp: possessing one of these
 * verifies an account or resets a password, so it has to be unguessable rather
 * than merely unlikely to be guessed. TOKEN.BYTES of hex is what auth.schema.js's
 * `token` builder validates, from the same constant.
 *
 * The RAW value returned here goes into the email and nowhere else. What is
 * stored is `keys.emailVerify(raw)`, i.e. only its SHA-256 digest, so a Redis
 * dump yields no usable tokens (TRD:1474).
 *
 * @returns {string} TOKEN.LENGTH lowercase hex characters
 */
export function generateToken() {
  return randomBytes(TOKEN.BYTES).toString('hex');
}

/**
 * Registers a new student or instructor account — plan:344, apidoc §8.2.
 *
 * Ordering follows plan:344: uniqueness, then hash, then create, then token, then
 * email. Two steps sit outside the transaction deliberately — see the header for
 * why the Redis write does not.
 *
 * @param {{fullName: string, email: string, password: string, role?: string}} input
 *        Already validated by registerSchema when the caller is the controller.
 * @returns {Promise<{id: string, fullName: string, email: string, role: string,
 *          isEmailVerified: boolean}>} the sanitized user; no `passwordHash`
 * @throws {AppError} 409 when the address is taken, 503 when Redis cannot store
 *         the verification token (nothing is created in that case)
 */
export async function register({ fullName, email, password, role }) {
  // Re-normalised even though registerSchema already trimmed and lowercased it.
  // `email @unique` is a case-SENSITIVE PostgreSQL index, so this is the step
  // that stops 'Alex@example.com' becoming a second account alongside
  // 'alex@example.com' — and a caller that reaches this function without going
  // through the schema (a script, a future internal flow, a unit test) would
  // otherwise create exactly that row.
  const normalizedEmail = email.trim().toLowerCase();

  // Defence in depth behind the schema, not instead of it. registerSchema
  // enumerates STUDENT and INSTRUCTOR so ADMIN is refused at the boundary
  // (plan:342); this is the guard for every other way into this function, since
  // `register()` is an exported function and nothing about its signature stops
  // `{ role: 'ADMIN' }`. A plain Error rather than an AppError on purpose: no
  // client can trigger this, so it is a bug in a call site, and the handler's
  // generic 500 plus the logged message is the right pair of answers.
  const requestedRole = role ?? UserRole.STUDENT;
  if (!SELF_SERVICE_ROLES.includes(requestedRole)) {
    throw new Error(
      `auth.register: refusing to create a ${requestedRole} account — ` +
        `self-service registration is limited to ${SELF_SERVICE_ROLES.join(', ')}`,
    );
  }

  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });

  if (existing) {
    throw ConflictError();
  }

  // Outside the transaction, for the reason src/database/seed.js:199 already
  // records: cost 12 is ~290 ms of pure CPU (measured, see BCRYPT_ROUNDS) and has
  // no business holding a database transaction — or a pool connection — open while
  // it runs. Skipping it on the duplicate path is measurable: the 409 above
  // returns in 2 ms against this path's 290 ms.
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Both computed before the transaction opens. Hashing the token is pure CPU,
  // and doing it here means a TypeError from a malformed token surfaces as the
  // bug it is rather than inside the Redis catch below, which reports outages.
  const rawToken = generateToken();
  const verifyKey = keys.emailVerify(rawToken);

  let user;

  try {
    user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          fullName,
          email: normalizedEmail,
          passwordHash,
          role: requestedRole,
        },
        select: PUBLIC_USER_FIELDS,
      });

      // TASK 4.10 GOES HERE: when `requestedRole` is INSTRUCTOR, create the
      // Instructor profile through the shared helper that admin elevation also
      // calls (plan:412). It belongs inside this callback so that a failure to
      // create the profile rolls the user back rather than leaving a role with no
      // profile. See the header for why it is not written yet.

      try {
        await setWithTTL(verifyKey, created.id, TTL.emailVerify);
      } catch (err) {
        // Logged in full before being converted, because the 503 the client sees
        // cannot distinguish an outage from a bug in this call and the log line
        // is the only thing that can. Throwing rolls the user row back — the
        // whole point of writing the token in here.
        log.error(
          { err, userId: created.id },
          '[auth] verification token write failed — registration rolled back',
        );
        throw ServiceUnavailableError();
      }

      return created;
    });
  } catch (err) {
    // The uniqueness guarantee, as opposed to the pre-check above: two
    // simultaneous registrations of one address both pass findUnique and one of
    // them lands here. Generic message per TRD:1480 — identical to the
    // pre-check's, so the two paths are indistinguishable from outside.
    if (err?.code === 'P2002') {
      throw ConflictError();
    }
    throw err;
  }

  // Fire-and-forget, after the commit, never inside it (TRD:1135, TRD:1138,
  // plan:734). No await and no .catch(): src/integrations/email/index.js
  // guarantees that none of its functions can reject — verified there against 84
  // hostile floating calls — so this cannot become an unhandledRejection, and
  // TRD:2009 requires that a mail-provider outage "costs an email, never a
  // certificate or an enrollment". The raw token appears here and in nothing that
  // is persisted.
  sendVerificationEmail({
    to: user.email,
    fullName: user.fullName,
    token: rawToken,
  });

  return user;
}

// ── login() helpers — task 3.4 ───────────────────────────────────────────────

/**
 * The default token lifetimes, matching src/config/env.js's defaults for the same
 * two variables and TRD:1669's "15 min" and "7 days".
 *
 * Duplicated rather than imported because env.js must not enter this import graph
 * (see note 3 in src/config/redis.js). The pair that matters is these against
 * TTL.session and TTL.userState in cache-keys.js — see the header.
 */
const DEFAULT_ACCESS_TTL = '15m';
const DEFAULT_REFRESH_TTL = '7d';

/**
 * The `type` claim. Secondary to the two signing keys, never a substitute — see
 * the header.
 */
const TOKEN_TYPE = Object.freeze({ ACCESS: 'access', REFRESH: 'refresh' });

/**
 * A real cost-12 bcrypt hash, compared against when no user matched, so that the
 * miss costs the same ~370 ms as a wrong password. See the header for the measured
 * numbers and why an early return is the bug this closes.
 *
 * Its preimage is 32 bytes from crypto.randomBytes that were hashed and discarded
 * without being recorded, so no input to this application matches it. Nothing rests
 * on that: login() throws on `!user` independently of the comparison's result, so
 * even a known preimage would authenticate nobody. Being a valid cost-12 hash is
 * the only property required of it — bcrypt reads the cost out of the string, so a
 * lower-cost decoy would reintroduce the gap it exists to close.
 */
const DECOY_HASH =
  '$2a$12$FnfXIrAF1z2Qx2HtyRFNQuSUPsQo1lniV4DhiWoovJEy9FfYcNmjK';

/**
 * What login reads: the public shape plus the three columns it decides on.
 *
 * `passwordHash` has to be selected here — a comparison needs it — which is the
 * one place this module breaks the never-fetch-it rule PUBLIC_USER_FIELDS exists
 * to enforce. toPublicUser() below is what keeps it from travelling any further.
 */
const LOGIN_USER_FIELDS = Object.freeze({
  ...PUBLIC_USER_FIELDS,
  passwordHash: true,
  isBanned: true,
  deletedAt: true,
});

/**
 * Narrows a LOGIN_USER_FIELDS row back to apidoc §8.2's `data.user`.
 *
 * Built by picking PUBLIC_USER_FIELDS' own keys rather than by deleting the three
 * private ones, so the two lists cannot drift apart in the dangerous direction:
 * a column added to LOGIN_USER_FIELDS is invisible here until someone also adds it
 * to the public set, while a `delete row.passwordHash` style would leak every
 * future addition by default.
 */
function toPublicUser(row) {
  return Object.fromEntries(
    Object.keys(PUBLIC_USER_FIELDS).map((field) => [field, row[field]]),
  );
}

/**
 * Resolves the two signing keys and two lifetimes.
 *
 * Read from process.env at CALL time, not at import time. Both reasons are
 * practical: env.js cannot be imported here (it exits the process, and Vitest loads
 * no .env), and a module-scope read would capture whatever the environment held
 * when the import graph was first walked — which for a test that sets the secrets
 * in a hook is `undefined`.
 *
 * No fallback for either secret. A default signing key is a key an attacker already
 * has, and one shipped as a fallback is one nobody notices is in use; jsonwebtoken's
 * own error for an absent secret ("secretOrPrivateKey must have a value") names no
 * variable, so the throw is spelled out here instead.
 *
 * A plain Error rather than an AppError, matching the role guard in register(): no
 * client can cause this, so it is a misconfiguration or a bug in a call site, and
 * the handler's generic 500 plus the logged message is the right pair of answers.
 *
 * @throws {Error} if either secret is missing, or if the two are the same
 */
function jwtConfig() {
  const accessSecret = process.env.JWT_SECRET;
  const refreshSecret = process.env.JWT_REFRESH_SECRET;

  if (!accessSecret || !refreshSecret) {
    throw new Error(
      'auth.login: both JWT_SECRET and JWT_REFRESH_SECRET must be set — ' +
        'refusing to sign a token with an absent or default key',
    );
  }

  // env.js rejects this at boot; re-checked because env.js is not in this
  // module's import graph and cannot be assumed to have run. See the header.
  if (accessSecret === refreshSecret) {
    throw new Error(
      'auth.login: JWT_SECRET and JWT_REFRESH_SECRET are identical — a refresh ' +
        'token would then verify as an access token (TRD §7)',
    );
  }

  return {
    accessSecret,
    refreshSecret,
    accessTtl: process.env.JWT_ACCESS_EXPIRES_IN || DEFAULT_ACCESS_TTL,
    refreshTtl: process.env.JWT_REFRESH_EXPIRES_IN || DEFAULT_REFRESH_TTL,
  };
}

/**
 * Authenticates a set of credentials and opens a session — plan:345, apidoc §8.2.
 *
 * Deliberately NOT a check on `isEmailVerified`. TRD:1482 is explicit that "an
 * unverified user may log in and browse", and refuses only POST /enrollments, POST
 * /courses and quiz submissions until the address is confirmed — which is task
 * 3.11's `requireVerifiedEmail`, not this function's business. The flag is written
 * into user:state so 3.11 can read it without a query.
 *
 * The signature is two arguments where register() takes one, and the split is
 * meaningful: the first object is what the CLIENT sent and loginSchema validated,
 * the second is what the SERVER observed about the request. Merging them would
 * invite a caller to pass a client-supplied `ip`, which is the value that then gets
 * written into the session record as provenance. The service has no `req`, so the
 * controller (3.9) supplies both from `req.ip` — trustworthy only because task 2.1
 * set `trust proxy` — and `req.get('user-agent')`.
 *
 * @param {{email: string, password: string}} credentials
 *        Already validated by loginSchema when the caller is the controller.
 * @param {{ip?: string, userAgent?: string}} [context]
 *        Request provenance for the session record. Absent values are stored as
 *        null rather than dropped, so the record's shape never varies.
 * @returns {Promise<{user: {id: string, fullName: string, email: string,
 *          role: string, isEmailVerified: boolean}, accessToken: string,
 *          refreshToken: string}>} the sanitized user and the token pair. The
 *          refresh token is the controller's to put in the HttpOnly cookie
 *          (TRD:1669); Max-Age should be TTL.session, which is the real upper
 *          bound on its usefulness.
 * @throws {AppError} 401 on unknown address or wrong password — one message for
 *         both; 403 when the credentials are right but the account is banned or
 *         soft-deleted; 503 when Redis cannot record the session, in which case no
 *         tokens are issued
 */
export async function login({ email, password }, { ip, userAgent } = {}) {
  // Same normalization as register(), for the same reason: `email @unique` is a
  // case-sensitive PostgreSQL index, so 'ADA@Example.com' has to find the row
  // stored as 'ada@example.com' or a correct password answers 401.
  const normalizedEmail = email.trim().toLowerCase();

  const row = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: LOGIN_USER_FIELDS,
  });

  // Runs on BOTH paths — see the header. The decoy keeps an unknown address as
  // expensive as a known one, which is what makes the shared 401 message below
  // mean anything.
  const passwordMatches = await bcrypt.compare(
    password,
    row?.passwordHash ?? DECOY_HASH,
  );

  // `!row` is tested independently of the comparison rather than trusting that
  // nothing matches DECOY_HASH.
  if (!row || !passwordMatches) {
    throw UnauthorizedError(MESSAGES.AUTH.INVALID_CREDENTIALS);
  }

  // Only reachable with a correct password, which is what lets this answer be
  // specific where the 401 above cannot be (apidoc §8.2).
  if (row.isBanned || row.deletedAt !== null) {
    throw ForbiddenError(MESSAGES.AUTH.ACCOUNT_DISABLED);
  }

  const { accessSecret, refreshSecret, accessTtl, refreshTtl } = jwtConfig();

  // Carries `email` and `role` so requireAuth (3.10) can build
  // `req.user = { id, email, role }` with no database round trip per request
  // (plan:376). Its jti is generated and discarded: nothing indexes access
  // tokens. `sub` is the standard subject claim; 3.10 maps it to `id`.
  const accessToken = jwt.sign(
    {
      sub: row.id,
      email: row.email,
      role: row.role,
      type: TOKEN_TYPE.ACCESS,
    },
    accessSecret,
    { expiresIn: accessTtl, jwtid: randomUUID() },
  );

  // A uuid, not base64: cache-keys.js validates every segment against
  // /^[A-Za-z0-9._-]+$/, and a jti containing ':' or '+' would either be refused
  // or — the reason that guard exists — let a crafted jti of `index:<victimId>`
  // make session() emit what sessionIndex() emits.
  const refreshJti = randomUUID();

  // Deliberately minimal. `role` and `email` would be 7 days stale by the time
  // this token is redeemed, and 3.5 re-reads both from the session record.
  const refreshToken = jwt.sign(
    { sub: row.id, type: TOKEN_TYPE.REFRESH },
    refreshSecret,
    { expiresIn: refreshTtl, jwtid: refreshJti },
  );

  try {
    // Index first, then the session it indexes, then the fast-path state. The
    // order is the security property — see the header. SADD not setWithTTL: the
    // index has no expiry by design (TTL.sessionIndex is null, and that helper
    // throws on a non-positive TTL saying so).
    await redis.sadd(keys.sessionIndex(row.id), refreshJti);

    await setWithTTL(
      keys.session(refreshJti),
      {
        userId: row.id,
        role: row.role,
        issuedAt: new Date().toISOString(),
        ip: ip ?? null,
        userAgent: userAgent ?? null,
      },
      TTL.session,
    );

    // plan:358's shape exactly. A JSON String, never a hash: HGETALL would
    // return `false` as the string 'false', and `if (state.isBanned)` on that
    // rejects everybody (plan:364). `deletedAt` is null on every write that gets
    // here — the guard above refused anything else — and is written anyway so the
    // record stays truthful if that check is ever relaxed.
    await setWithTTL(
      keys.userState(row.id),
      {
        role: row.role,
        isBanned: row.isBanned,
        isEmailVerified: row.isEmailVerified,
        deletedAt: row.deletedAt,
      },
      TTL.userState,
    );
  } catch (err) {
    // Logged before conversion, as in register(): the 503 cannot distinguish an
    // outage from a bug in this call, and this line is the only thing that can.
    log.error(
      { err, userId: row.id },
      '[auth] session write failed — login refused, no tokens issued',
    );
    throw ServiceUnavailableError();
  }

  return {
    user: toPublicUser(row),
    accessToken,
    refreshToken,
  };
}

export default { register, generateToken, login };
