// ─────────────────────────────────────────────────────────────────────────────
// requireAuth / optionalAuth — TRD §3.2/§7.1, apidoc §2/§3, task 3.10.
//
// Two exports, and the difference between them is the whole file:
//
//   requireAuth     the gate. Refuses the request unless a live, un-banned
//                   account is behind the Bearer token, and attaches
//                   `req.user = { id, email, role }`.
//   optionalAuth    the same resolution, but NEVER refuses. A caller it cannot
//                   positively identify continues as `req.user === null`.
//
// Position is fixed by TRD §3.2: validate(schema) → requireAuth →
// requireRole([...]) → controller. Both are bare middleware, not factories —
// `router.get('/me', requireAuth, meHandler)` — because there is nothing to
// configure. requireRole is what takes an argument, and task 3.11 owns it.
//
// ── THE THREE ANSWERS, AND WHY THEY ARE NOT INTERCHANGEABLE ──────────────────
//
// apidoc §3:159 gives 401 to "missing, invalid or expired token" and §3:160
// gives 403 to "insufficient role, banned or soft-deleted account". They are
// different answers to different questions, and collapsing them would be a
// client-facing bug: a 401 tells a browser to bin its token and re-authenticate,
// which is exactly the wrong instruction for a banned user whose credential is
// perfectly valid and whose next login will fail the same way.
//
//   401  no Authorization header, or not a Bearer one
//   401  a token that does not verify: bad signature, expired, malformed,
//        or signed under an algorithm other than the pinned one
//   401  a token that verifies but is not an ACCESS token, or whose `sub` /
//        `email` claims are not strings, or whose `sub` is not a UUID
//   401  no such account (the row is gone — see readAccountRow below)
//   403  the account exists and is banned, or is soft-deleted
//   503  the authorization state could not be read at all
//
// The 503 is the one that is easy to get wrong, and plan:379 and plan:386 both
// spell it out: a security read that cannot reach Redis FAILS CLOSED. It must
// never degrade to "allow", and it must not degrade to 401 either — telling a
// client with a good token to throw it away because a cache went down would log
// out the whole platform over an outage that lasts seconds. 503 says "retry".
//
// ── REDIS FIRST, POSTGRES ONLY ON A MISS (TRD:1672, plan:376) ────────────────
//
// The point of `user:state:<id>` is that a guard on every authenticated request
// must not be a query on every authenticated request. So: read the key, and
// trust it. It holds `{ role, isBanned, isEmailVerified, deletedAt }` as a JSON
// STRING with a 15-minute TTL, written by login(), by refresh(), by
// verifyEmail(), and (Day 14) by the ban/unban and role-change handlers.
//
// A miss falls through to PostgreSQL, which is the only other place the truth
// lives. A miss is ordinary rather than exceptional — the TTL is 15 minutes and
// register() writes no record at all (disclosed at the bottom) — so the
// fallthrough is a normal code path, not an error path.
//
// It does NOT write the record back. plan:376 enumerates the writers and this
// guard is not among them, and TRD:1672 asks only that it "falls through to
// Postgres on a miss". A read-through fill would be a fourth writer sitting on
// the request path, and it would need its own policy for a failed write; the
// cost of not having it is one extra query per authenticated request until the
// account's next login writes the key. That trade is recorded here so that
// turning it around later is a decision rather than a discovery.
//
// ── WHY THE CACHED RECORD IS SHAPE-CHECKED AND A BAD ONE IS A MISS ───────────
//
// Because both denial flags fail UNSAFELY on a partial record, in opposite
// directions. Measured on `JSON.parse('{"role":"STUDENT"}')`:
//
//   isBanned            undefined → falsy → `if (state.isBanned)` admits a
//                       banned account
//   deletedAt !== null  undefined !== null is TRUE → a LIVE account is refused
//                       with 403
//
// So a record that is not the full four fields is treated as a miss and the row
// is read instead. This is also the guard plan:364 asks for from the other end:
// the record is a String and not a Hash precisely because `HGETALL` would
// return `'false'` for `isBanned`, and `'false'` is truthy — the boolean check
// below is only meaningful because JSON preserved the type, and
// `typeof state.isBanned === 'boolean'` is what proves it did.
//
// `deletedAt` survives the round trip as an ISO STRING, not a Date (measured:
// JSON.stringify(new Date(...)) yields '2026-01-01T00:00:00.000Z'), while the
// Postgres row yields a Date. Both are `!== null`, which is the only thing
// either path asks of it — no branch parses it.
//
// ── role COMES FROM THE STATE, email COMES FROM THE TOKEN ────────────────────
//
// Deliberately asymmetric.
//
// `role` is an authorization input, and the token's copy of it is frozen at
// mint time for the full 15 minutes. The state record's copy is REWRITTEN by
// the Day 14 role-change handler (plan:376), so it is the fresher of the two
// and it costs nothing extra — this middleware has already read it. Ignoring
// the claim is what makes a demotion take effect on the next request instead of
// on the next login. Where the record was a miss, the role comes from the row,
// which is fresher still.
//
// `email` is display and log data, is not in the state record at all, and is
// therefore taken from the token in every case — including the Postgres path,
// where the row could supply it. Uniformity is worth more here than freshness:
// a `req.user.email` that changed meaning depending on whether a cache key
// happened to be warm would be the harder thing to reason about, and nothing
// authorizes on it. It is up to 15 minutes stale after a change of address.
//
// ── optionalAuth: ANY DOUBT RESOLVES TO ANONYMOUS ────────────────────────────
//
// plan:351 requires that it never 401s, so every operational refusal above
// becomes `req.user = null` and `next()`. That includes the 503: during a Redis
// outage an optionalAuth route serves its public view to everybody, which is
// strictly less privilege than it would otherwise grant and therefore still
// fails closed in the sense plan:379 means. A banned user reaching a public
// route is treated as a stranger rather than refused, which is the correct
// outcome for a route a stranger may read anyway.
//
// What it does NOT swallow is a non-operational error. `AppError.isOperational`
// is false (or absent) for a misconfiguration or a bug — an unset JWT_SECRET,
// most obviously — and those propagate to the 500 handler. Swallowing them
// would make every optionalAuth route silently anonymous forever, which is the
// failure mode nobody notices until a feature is quietly missing in production.
//
// ── THE SECRET IS CHECKED BEFORE jwt.verify, NOT BY IT ───────────────────────
//
// Measured, and the reason this is not left to the library: jwt.verify with an
// undefined or empty secret throws `JsonWebTokenError: secret or public key
// must be provided` — the same error class as a bad signature. Left to the
// catch below, an unset JWT_SECRET would answer 401 "Authentication required"
// to every request on the platform, and the logs would show a plausible-looking
// wave of authentication failures rather than a misconfiguration. So the
// secrets are read and asserted first, and a failure there is a plain Error:
// no client can cause it, and its message must not reach one.
//
// The distinctness check is the same rule jwtConfig() applies in the auth
// service before signing, restated here rather than imported. Two identical
// secrets would make a refresh token verify as an access token, and the only
// thing standing between that and a 7-day access credential would be the `type`
// claim — which is meant to be the second line of defence, not the first.
//
// ── RESIDUALS ───────────────────────────────────────────────────────────────
//
// 1. register() writes no `user:state` record (task 3.3), so every request made
//    with a registration-issued access token misses the cache and reads the row
//    for up to 15 minutes, until the account's first login. Survivable only
//    because a miss falls through; a guard that read an absent key as "not
//    authorized" would make every register-issued token dead on arrival. The
//    fix belongs in register(), not here.
//
// 2. An access token stays valid for its full 15 minutes after a password
//    reset. Neither `user:state` nor anything else records "credentials changed
//    at", and there is no `access:<jti>` key to revoke — that is the accepted
//    cost of a stateless access token, and TRD §6.1 chose it. A ban is caught
//    within one TTL; a password change is not caught at all.
//
// 3. Duplicate Authorization headers are not rejected. Measured: Node keeps the
//    FIRST and discards the rest, so `req.get('authorization')` returns
//    'Bearer first' for a request carrying two — it does not join them into one
//    unparseable value the way it would for a list-valued header. This app has
//    no edge authorizer that could read a different one than we do, so the
//    ambiguity is recorded rather than closed.
// ─────────────────────────────────────────────────────────────────────────────

import jwt from 'jsonwebtoken';

import { JWT_ALGORITHM, TOKEN_TYPE } from '../config/constants.js';
import { MESSAGES } from '../config/system_messages.js';
import prisma from '../database/index.js';
import {
  AppError,
  ForbiddenError,
  ServiceUnavailableError,
  UnauthorizedError,
} from '../utils/app-error.js';
import { getJSON, keys } from '../utils/cache-keys.js';
import { logger } from './logging.middleware.js';

const log = logger.child({ module: 'auth-guard' });

/**
 * `Bearer <token>`, RFC 6750 §2.1.
 *
 * Case-insensitive on the scheme because RFC 7235 §2.1 defines it that way and
 * real clients send `bearer`. One or more spaces, because the grammar is 1*SP.
 * `\S+` and the anchors together are what refuse the awkward inputs — measured:
 * 'Bearer' alone, 'Bearer ' (Node strips the trailing space), 'Basic abc',
 * 'abc.def.ghi' with no scheme, and 'Bearer abc def' all fail to match, and a
 * JWT contains no whitespace so nothing legitimate is lost.
 */
const BEARER = /^Bearer +(\S+)$/i;

/**
 * A canonical v4-shaped UUID, the format `User.id` is declared as
 * (`@db.Uuid`, schema.prisma:103).
 *
 * Checked before either read, for a reason that is specific to the PostgreSQL
 * half: `where: { id: 'abc' }` against a uuid column is not a miss, it is an
 * invalid input the database rejects — and this middleware reports a failed row
 * read as a 503, so a crafted `sub` would masquerade as an outage. Refusing the
 * shape up front means the 503 can only ever mean what it says.
 *
 * It also subsumes what keys.userState() enforces on its own segment
 * (`/^[A-Za-z0-9._-]+$/`, cache-keys.js:79) — hex and dashes are a strict
 * subset — which is why the key is built below without a try/catch around it.
 * A `sub` that reaches that call cannot make it throw.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The three authorization columns, and nothing else.
 *
 * Narrower than the auth service's ACCOUNT_FIELDS on purpose: this read decides
 * one question — may this account hold a session — and `fullName`, `email` and
 * `isEmailVerified` are not part of it. `passwordHash` is not part of any read
 * outside login(). Selecting less also keeps the fallthrough cheap, which
 * matters because it runs on every request until the key is warm.
 */
const STATE_FIELDS = Object.freeze({
  role: true,
  isBanned: true,
  deletedAt: true,
});

/**
 * Pulls the token out of the Authorization header, or null if there isn't one.
 *
 * Only that header. A token in a query string would land in every access log,
 * proxy log and browser history on the path, and a token in a cookie would make
 * every authenticated route CSRF-reachable — the refresh cookie is the one
 * cookie-borne credential in this application and it is scoped to a single path
 * and guarded by an origin check for exactly that reason.
 */
function bearerToken(req) {
  const header = req.get('authorization');

  if (header === undefined) {
    return null;
  }

  const match = BEARER.exec(header);

  return match === null ? null : match[1];
}

/**
 * The access-token verification key.
 *
 * Read from process.env at call time rather than at import time, matching
 * jwtConfig() in the auth service: env.js cannot be imported here (it exits the
 * process on a bad environment, and Vitest loads no .env), and a module-scope
 * read would capture whatever the environment held when the import graph was
 * first walked — `undefined`, for a test that sets the secrets in a hook.
 *
 * @throws {Error} a non-operational error if the secrets are absent or equal
 */
function verificationKey() {
  const accessSecret = process.env.JWT_SECRET;
  const refreshSecret = process.env.JWT_REFRESH_SECRET;

  if (!accessSecret || !refreshSecret) {
    throw new Error(
      'auth: both JWT_SECRET and JWT_REFRESH_SECRET must be set — ' +
        'refusing to verify a token against an absent or default key',
    );
  }

  if (accessSecret === refreshSecret) {
    throw new Error(
      'auth: JWT_SECRET and JWT_REFRESH_SECRET must differ — ' +
        'identical keys let a refresh token verify as an access token',
    );
  }

  return accessSecret;
}

/**
 * Verifies a token and returns its claims, or throws the 401.
 *
 * @param {string} token the raw token from the Authorization header
 * @returns {{sub: string, email: string}} the verified claims
 * @throws {AppError} 401 for every way a token can fail to be an access token
 */
function verifyAccessToken(token) {
  const secret = verificationKey();

  let claims;
  try {
    // The algorithm pin is load-bearing, not decoration: without it
    // jsonwebtoken trusts the token header's own `alg`, and a correct HS512 MAC
    // over the same secret verifies (measured, see constants.js).
    claims = jwt.verify(token, secret, { algorithms: [JWT_ALGORITHM] });
  } catch {
    // Every failure collapses to one answer — bad signature, expired,
    // malformed, wrong algorithm. Not logged: an expired access token is the
    // ordinary case fifteen minutes into any session, and logging it would bury
    // the entries that matter. The client cannot act on the distinction either;
    // its next move is the same for all of them.
    throw UnauthorizedError();
  }

  // A refresh token presented here has already failed on the signature, since
  // the two keys differ (measured: 'invalid signature'). This is the belt behind
  // that brace, and it is also what catches a token minted with no `type` claim
  // at all — measured: jwt.verify accepts one happily.
  if (claims.type !== TOKEN_TYPE.ACCESS) {
    throw UnauthorizedError();
  }

  // `sub` becomes a Redis key segment and a Prisma `where`; `email` becomes
  // req.user.email. A token missing either is one this application did not
  // mint — signAccessToken() always sets both — so the honest answer is that
  // the credential is invalid, rather than to carry an `undefined` identity
  // into a handler.
  if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') {
    throw UnauthorizedError();
  }

  if (!UUID.test(claims.sub)) {
    throw UnauthorizedError();
  }

  return claims;
}

/**
 * Whether a cached `user:state` record can be trusted to answer the question.
 *
 * All four checks are load-bearing; see the header for the measured way each
 * denial flag fails on a partial record. `deletedAt` is an ISO string or null
 * after the JSON round trip, never a Date.
 *
 * One caveat on `typeof state === 'object'`: it is currently redundant, and
 * deliberately kept. No value JSON.parse can produce reaches the three property
 * checks below without also being an object — a number, a string or a boolean
 * fails `typeof state.role === 'string'` on its own — so removing it changes no
 * outcome (verified by mutation: the mutant survives the whole suite). It stays
 * because the three field checks are about the SHAPE of a record and this one is
 * about it being a record at all, and because getJSON's contract is "whatever
 * was stored", which a future writer could widen.
 */
function isUsableState(state) {
  return (
    state !== null &&
    typeof state === 'object' &&
    typeof state.role === 'string' &&
    typeof state.isBanned === 'boolean' &&
    (state.deletedAt === null || typeof state.deletedAt === 'string')
  );
}

/**
 * The fast path: `user:state:<id>` from Redis, or null when it is unusable.
 *
 * @throws {AppError} 503 if Redis could not answer at all
 */
async function readCachedState(userId) {
  let state;
  try {
    // getJSON propagates a connection failure and swallows only a PARSE failure
    // into null (cache-keys.js:348) — precisely so that this call can tell an
    // outage apart from a corrupt value, and answer 503 for the first while
    // treating the second as a miss.
    state = await getJSON(keys.userState(userId));
  } catch (err) {
    log.error(
      { err, userId },
      '[auth] guard: user:state read failed — refusing the request',
    );
    throw ServiceUnavailableError();
  }

  return isUsableState(state) ? state : null;
}

/**
 * The fallthrough: the same three columns, from PostgreSQL.
 *
 * `where` is the id ALONE, deliberately unscoped by `deletedAt: null` — the
 * opposite of every other read in this codebase. A soft-deleted account must be
 * distinguishable from a nonexistent one here, because they get different
 * answers (403 and 401); scoping the query would flatten both into `!row` and
 * report a disabled account as an invalid token, contradicting apidoc §8.2:365.
 *
 * @throws {AppError} 401 if there is no such row, 503 if the read failed
 */
async function readAccountRow(userId) {
  let row;
  try {
    row = await prisma.user.findUnique({
      where: { id: userId },
      select: STATE_FIELDS,
    });
  } catch (err) {
    // Fail closed, same rule as the Redis path. An authorization decision that
    // could not be made is not an authorization.
    log.error(
      { err, userId },
      '[auth] guard: account read failed — refusing the request',
    );
    throw ServiceUnavailableError();
  }

  // Hard-deleted, or a token minted for an id that never existed. Both are
  // "this credential identifies nobody", which is a 401 and not a 403: there is
  // no account here whose access could have been withdrawn.
  if (!row) {
    log.warn({ userId }, '[auth] guard: token names an account that is gone');
    throw UnauthorizedError();
  }

  return row;
}

/**
 * Turns verified claims into the `req.user` the rest of the application reads.
 *
 * @param {{sub: string, email: string}} claims
 * @returns {Promise<{id: string, email: string, role: string}>}
 * @throws {AppError} 401, 403 or 503 per the matrix in the header
 */
async function resolveUser(claims) {
  const userId = claims.sub;

  const account =
    (await readCachedState(userId)) ?? (await readAccountRow(userId));

  if (account.isBanned || account.deletedAt !== null) {
    // Logged at warn: a banned account still holding a live token is worth
    // seeing, and it is rare enough not to be noise. One message for both
    // states, because apidoc gives them one row and one wording — the client
    // is told the account is disabled, not which mechanism disabled it.
    log.warn(
      {
        userId,
        isBanned: account.isBanned,
        softDeleted: account.deletedAt !== null,
      },
      '[auth] guard: refusing a valid token for a disabled account',
    );
    throw ForbiddenError(MESSAGES.AUTH.ACCOUNT_DISABLED);
  }

  // Exactly plan:351's three fields, frozen. A downstream handler that tries to
  // rewrite the caller's identity — `req.user.role = 'ADMIN'` — throws a
  // TypeError under ESM's strict mode rather than escalating quietly. Anything
  // that needs to carry more per-request state should hang it off `req`, or
  // extend this guard; it must not patch the identity the guard established.
  return Object.freeze({
    id: userId,
    email: claims.email,
    role: account.role,
  });
}

/**
 * The gate. Attaches `req.user` or refuses the request.
 *
 * @type {import('express').RequestHandler}
 */
export async function requireAuth(req, _res, next) {
  try {
    const token = bearerToken(req);

    if (token === null) {
      throw UnauthorizedError();
    }

    req.user = await resolveUser(verifyAccessToken(token));
  } catch (err) {
    return next(err);
  }

  // Outside the try, so a throw out of next() cannot be caught here and turned
  // into a second next() call on the same request. Corrected in 3.11: this used
  // to say "a synchronous throw from a later layer", which express 5.2.1 makes
  // impossible — each Layer wraps its own handler, so a downstream throw is
  // answered there. The guarantee is structural, for a direct caller.
  return next();
}

/**
 * The same resolution, with every refusal turned into anonymity.
 *
 * Never answers 401, 403 or 503 — see the header. `req.user` is null rather
 * than absent, so a handler reads `req.user?.id ?? null` and gets the same
 * answer whether the caller was anonymous or the middleware was not mounted.
 *
 * @type {import('express').RequestHandler}
 */
export async function optionalAuth(req, _res, next) {
  req.user = null;

  const token = bearerToken(req);

  if (token === null) {
    return next();
  }

  try {
    req.user = await resolveUser(verifyAccessToken(token));
  } catch (err) {
    // A misconfiguration or a bug is not the caller's fault and must not be
    // absorbed into "anonymous" — see the header.
    //
    // Of the two halves, only the first can fire today: everything resolveUser
    // throws is an operational AppError (401/403/503), and the one non-AppError
    // it can raise is verificationKey()'s plain Error. So `isOperational !== true`
    // is unreachable as written, and mutation testing confirms removing it kills
    // nothing. It is kept because the condition being tested is "is this a
    // refusal, or a failure?", and `AppError` already carries that distinction on
    // a flag — reading only half of it would be the bug, not the simplification,
    // the first time a deeper layer throws a non-operational AppError.
    if (!(err instanceof AppError) || err.isOperational !== true) {
      return next(err);
    }

    log.debug(
      { statusCode: err.statusCode },
      '[auth] optionalAuth: token not honoured — continuing anonymously',
    );
  }

  return next();
}

export default { optionalAuth, requireAuth };
