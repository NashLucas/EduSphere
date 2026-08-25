// ─────────────────────────────────────────────────────────────────────────────
// Auth service — TRD §6.1, §7. Task 3.3 opens this file with register(); login,
// refresh, logout, password recovery and email verification land here as tasks
// 3.4–3.8 and share the helpers at the top.
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
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes } from 'node:crypto';

import bcrypt from 'bcryptjs';

import prisma from '../../database/index.js';
import { BCRYPT_ROUNDS, TOKEN, UserRole } from '../../config/constants.js';
import {
  ConflictError,
  ServiceUnavailableError,
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

export default { register, generateToken };
