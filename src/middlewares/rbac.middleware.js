// ─────────────────────────────────────────────────────────────────────────────
// requireRole / requireVerifiedEmail — plan:352, TRD:179, apidoc §3.
//
// The second half of the pipeline TRD:179 lays out:
//
//     validate(schema) → requireAuth → requireRole([...]) → controller
//
// requireAuth (task 3.10) answers "who is this, and may they hold a session at
// all". These two answer "may this caller do THIS", and both run strictly after
// it: they read the identity it established and never re-derive one.
//
// ── requireRole IS SET MEMBERSHIP, NOT A HIERARCHY ───────────────────────────
//
// plan:352 is literal — "accepts an array of allowed roles → compares against
// `req.user.role` → 403 if unauthorized" — so the array is the whole truth. An
// ADMIN is not admitted to `requireRole([INSTRUCTOR])` unless ADMIN is in the
// array, and an INSTRUCTOR is not admitted to `requireRole([STUDENT])`.
//
// That reading is worth defending, because apidoc §3 can be misread as a ladder:
// it gives an INSTRUCTOR "all STUDENT permissions" and lets an ADMIN "bypass all
// ownership checks". Neither sentence is about this guard. Every route table in
// TRD §6 already spells its allowed roles out in full — "Instructor (Owner) /
// Admin", never "Instructor" with an implied admin — so the ladder is expressed
// route by route, in the arrays those tables dictate. Building it in here as
// well would silently widen every route that names a single role: `POST
// /enrollments` is Student alone (TRD:1550), and an implicit ladder would let an
// admin enrol themselves and an instructor take a student's seat. The ADMIN
// bypass apidoc §3 does describe is an OWNERSHIP bypass; it belongs to the
// ownership helper TRD §6.5 defines, which resolves through `Instructor.id`, and
// it has nothing to say about which roles may reach a route.
//
// ── THE ARRAY IS CHECKED WHEN THE ROUTE IS REGISTERED, NOT WHEN IT IS CALLED ──
//
// `requireRole(['ADMNI'])` is a typo no happy-path test can catch: the route
// simply refuses everyone, forever, with an entirely plausible 403. So the
// factory rejects anything that is not a non-empty array of real UserRole
// values, and it throws while the router module is being imported — the server
// fails to boot, loudly, instead of serving a permanently locked route.
//
// The roles are copied into a Set the caller cannot reach. That copy is the
// point: `const r = ['ADMIN']; requireRole(r); r.push('STUDENT')` cannot widen a
// guard that has already been built. Freezing the Set would be theatre —
// Object.freeze does not stop Set.prototype.add, because a Set's members live in
// an internal slot and not in properties (measured).
//
// ── WHERE requireVerifiedEmail READS THE FLAG, AND WHY NOT FROM req.user ─────
//
// `req.user` is exactly `{ id, email, role }` (plan:351), and requireAuth's
// STATE_FIELDS comment records why `isEmailVerified` is deliberately not part of
// the read behind it: that read decides whether an account may hold a session,
// and the flag is not part of that question. Adding a fourth column there, and a
// fourth clause to the cached-record validity check, would make every
// authenticated request in the application pay for a flag that gates three
// routes.
//
// So this guard reads it itself, from the place task 3.8 writes it — plan:349:
// "rewrite `user:state:<id>` so the new flag is visible to requireVerifiedEmail
// immediately rather than after the 15-minute TTL" — and falls through to
// PostgreSQL for one column on a miss. `keys.userState` and `getJSON` are shared
// with requireAuth, so the key and the parse policy cannot drift between the two
// guards; what is local here is one typeof check and a one-column select.
//
// A Redis failure is 503, never "unverified" and never "verified" — the
// fail-closed rule plan:379 states for security reads. A gate that could not
// read its flag has not decided anything, and must not pretend it has.
//
// ── A MISSING req.user IS A 500, NOT A 401 ───────────────────────────────────
//
// Both guards run after requireAuth by contract. If either finds no `req.user`,
// the pipeline was assembled wrong: requireAuth is missing, or optionalAuth
// stands where requireAuth belongs. A 401 there would be fail-closed but mute —
// it reports a deployment fault as an ordinary client error, on a route that is
// simultaneously unguarded in one direction and unusable in the other. A
// non-operational throw is fail-closed AND diagnostic: globalErrorHandler turns
// it into a 500 and logs it as the bug it is, and optionalAuth propagates it
// rather than absorbing it into anonymity.
//
// ── NOT MOUNTED YET, AND WHAT IS WATCHING THAT ───────────────────────────────
//
// plan:352 names exactly three surfaces for requireVerifiedEmail — `POST
// /enrollments`, `POST /courses`, and every quiz submission — and all three
// belong to Day 4-6 modules that are still empty files. Review creation is
// deliberately NOT one of them: TRD:1590 guards `POST /courses/:courseId/reviews`
// on enrollment, which is the stronger condition and is checked in the reviews
// service, not here.
//
// So nothing mounts either guard today. rbac.middleware.test.js ends with a
// tripwire asserting all three surfaces are still absent: the task that adds any
// of them fails that test, and the fix is to mount the guard listed above and
// delete the tripwire. It is the same mechanism task 3.9 used to hand
// /auth/logout and /auth/me to 3.10.
// ─────────────────────────────────────────────────────────────────────────────

import { UserRole } from '../config/constants.js';
import { MESSAGES } from '../config/system_messages.js';
import prisma from '../database/index.js';
import {
  ForbiddenError,
  ServiceUnavailableError,
  UnauthorizedError,
} from '../utils/app-error.js';
import { getJSON, keys } from '../utils/cache-keys.js';
import { logger } from './logging.middleware.js';

const log = logger.child({ module: 'rbac-guard' });

/** The three persisted roles, as apidoc §3 and the Prisma enum define them. */
const ROLES = Object.freeze(Object.values(UserRole));

/**
 * The identity requireAuth established, or a loud failure if it never ran.
 *
 * `== null` catches both shapes that mean "not authenticated here": absent,
 * which is an unmounted requireAuth, and null, which is optionalAuth's
 * anonymous caller. Neither is a client error — see the header.
 *
 * @throws {Error} a non-operational error naming the guard that was misplaced
 */
function callerOf(req, guard) {
  if (req.user == null) {
    throw new Error(
      `rbac: ${guard} ran with no req.user — mount requireAuth ahead of it ` +
        '(TRD:179 — validate, requireAuth, requireRole, controller)',
    );
  }

  return req.user;
}

/**
 * `requireRole([...])` → middleware that admits only those roles.
 *
 * @param {string[]} allowed one or more UserRole values
 * @returns {import('express').RequestHandler}
 * @throws {Error} at registration time if `allowed` is not a non-empty array of
 *   real roles — the server must not boot with a route no one can reach
 */
export function requireRole(allowed) {
  if (!Array.isArray(allowed) || allowed.length === 0) {
    throw new Error(
      'rbac: requireRole needs a non-empty array of roles, received ' +
        `${JSON.stringify(allowed) ?? typeof allowed}`,
    );
  }

  const unknown = allowed.filter((role) => !ROLES.includes(role));

  if (unknown.length > 0) {
    throw new Error(
      `rbac: requireRole received unknown ${JSON.stringify(unknown)} — ` +
        `the roles are ${ROLES.join(', ')}`,
    );
  }

  // A copy, so the caller's array cannot widen this guard later. Set for the
  // membership test the plan describes; the header records why it is not frozen.
  const permitted = new Set(allowed);

  return function roleGate(req, _res, next) {
    let role;
    try {
      role = callerOf(req, 'requireRole').role;
    } catch (err) {
      return next(err);
    }

    if (!permitted.has(role)) {
      // warn, not error: a student reaching an instructor route is a normal
      // client mistake, but a burst of them on one account is worth seeing.
      log.warn(
        { userId: req.user.id, role, permitted: [...permitted] },
        '[rbac] refusing a caller whose role is not permitted here',
      );
      return next(ForbiddenError());
    }

    return next();
  };
}

/**
 * Whether this account's address is verified — Redis first, PostgreSQL on a miss.
 *
 * @param {string} userId
 * @returns {Promise<boolean>}
 * @throws {AppError} 503 if a store could not answer, 401 if the account is gone
 */
async function isAddressVerified(userId) {
  let state;
  try {
    // getJSON swallows only a PARSE failure into null and propagates a
    // connection failure (cache-keys.js:348), which is what lets the catch below
    // mean "outage" and the typeof check below mean "unusable record".
    state = await getJSON(keys.userState(userId));
  } catch (err) {
    log.error(
      { err, userId },
      '[rbac] user:state read failed — refusing the gated action',
    );
    throw ServiceUnavailableError();
  }

  // `typeof === 'boolean'` and not a truthiness test, for the reason plan:364
  // spells out: were this record ever written as a Redis hash, the flag would
  // come back as the string 'false', which is truthy, and every unverified
  // account on the platform would walk through this gate.
  if (typeof state?.isEmailVerified === 'boolean') {
    return state.isEmailVerified;
  }

  let row;
  try {
    row = await prisma.user.findUnique({
      where: { id: userId },
      select: { isEmailVerified: true },
    });
  } catch (err) {
    log.error(
      { err, userId },
      '[rbac] isEmailVerified read failed — refusing the gated action',
    );
    throw ServiceUnavailableError();
  }

  // requireAuth already refused a token naming no row, so reaching this means
  // the account was hard-deleted between its read and this one. 401 rather than
  // 403, matching readAccountRow: a credential that identifies nobody has no
  // access to have been withdrawn, and "verify your email" would be a nonsense
  // answer for an account that no longer exists.
  if (!row) {
    log.warn({ userId }, '[rbac] the account vanished between two reads');
    throw UnauthorizedError();
  }

  return row.isEmailVerified;
}

/**
 * The gate on the three surfaces TRD:1482 names. 403 until the address is verified.
 *
 * @type {import('express').RequestHandler}
 */
export async function requireVerifiedEmail(req, _res, next) {
  try {
    const user = callerOf(req, 'requireVerifiedEmail');

    if (!(await isAddressVerified(user.id))) {
      log.warn(
        { userId: user.id },
        '[rbac] refusing a gated action for an unverified address',
      );
      throw ForbiddenError(MESSAGES.AUTH.EMAIL_NOT_VERIFIED);
    }
  } catch (err) {
    return next(err);
  }

  // Outside the try, so that a throw out of next() cannot land in the catch above
  // and be answered with a SECOND next(err) on one request. Measured on express
  // 5.2.1: no downstream LAYER can trigger that, because each Layer wraps its own
  // handler in a try/catch and a throw there is answered where it happened. The
  // guarantee is therefore structural — it holds for a direct caller, which is
  // how rbac.middleware.test.js pins it, and for whatever calls this next.
  return next();
}

export default { requireRole, requireVerifiedEmail };
