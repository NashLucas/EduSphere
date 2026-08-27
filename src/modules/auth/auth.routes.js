// ─────────────────────────────────────────────────────────────────────────────
// Auth router — apidoc §8.2, TRD §6.1, task 3.9.
//
// Mounted at /api/v1/auth by src/routes/v1.js. Every line below is one of three
// things: a middleware chain, the Origin guard TRD:1673 requires, or a
// swagger-jsdoc annotation. There is no request handling here — that is
// auth.controller.js — and no business logic anywhere in the file.
//
// ── THE CHAIN, AND WHY IT IS IN THIS ORDER ───────────────────────────────────
//
//     authRateLimiter → requireSameOrigin → validate({ body }) → handler
//
// The limiter is FIRST so that everything it is supposed to bound is actually
// counted. Put the Origin guard or the validator ahead of it and a caller gets a
// free, unmetered rejection path: an attacker sending deliberately malformed
// bodies, or a deliberately wrong Origin, would never consume a token from the
// 5/15-min bucket and could probe this router without limit.
//
// The validator is LAST of the three because it is the only one that does work
// proportional to the request. A 100kb body that fails on its first key should
// already have been refused by the two cheap checks above it.
//
// TRD §3.2's pipeline is `validate` → `requireAuth` → `requireRole` → controller;
// none of these six routes has an auth guard, and the two that do are discussed
// below.
//
// ── EVERY PUBLIC ROUTE IS ON authRateLimiter, INCLUDING refresh ──────────────
//
// A documented disagreement, resolved in favour of apidoc and left visible here.
//
// TRD:1460 gives `POST /auth/refresh` the "Standard" tier — the global 100/15 min.
// apidoc §4 line 140 enumerates the 5/15-min tier member by member and names
// `refresh` in the list: "register, login, refresh, forgot-password,
// reset-password, verify-email". apidoc §8.2's own entry for the route then omits
// a Rate Limit line altogether.
//
// apidoc §4's explicit enumeration wins, for two reasons beyond apidoc being the
// endpoint contract. It is the more specific statement — a per-endpoint list
// against a one-word table cell — and it is already what shipped: RATE_LIMITS.AUTH
// in src/config/constants.js (task 2.2) carries that same six-name list in its
// comment, and rate-limit.middleware.js (task 2.4) was built to it. Following
// TRD:1460 here would leave the constant's comment describing a tier the router
// does not implement.
//
// What it costs is real and worth stating: express-rate-limit gives one
// `rateLimit()` instance one store, so all six routes share ONE per-IP bucket of
// five. A user who logs in and then rotates a token three times has spent four of
// them. The window is 15 minutes and an access token also lives 15 minutes, so an
// ordinary session needs ~1 refresh per window and fits; a client that refreshes
// eagerly on every page load does not. Behind a corporate NAT the whole office
// shares that bucket, which is a pre-existing property of keying on `req.ip`
// (task 2.4 disclosed it, along with MemoryStore not being shared between
// instances).
//
// ── ALL EIGHT ROUTES ARE NOW MOUNTED (task 3.10) ─────────────────────────────
//
// TRD:1459 and TRD:1464 guard `POST /auth/logout` and `GET /auth/me` as
// Authenticated. That guard is `requireAuth`, which plan:351 gave to task 3.10,
// and until it existed src/middlewares/auth.middleware.js was a zero-byte file —
// so the two registrations sat here commented out at their final position rather
// than mounted without a guard.
//
// Task 3.10 filled that file, so both are live below and the tripwire test that
// asserted they were unreachable has been deleted. The reasoning for the
// deferral is kept because it is the reasoning for the ORDER they are mounted in:
// `GET /auth/me` reads `req.user.id`, which nothing but requireAuth sets, and
// `POST /auth/logout` compares its `userId` argument against the refresh
// cookie's `sub` so that one caller cannot end another's session — with
// `req.user` undefined that comparison fails for everyone and the route would
// answer "Logged out successfully" over a live session. Neither handler may ever
// be reachable without the guard ahead of it.
//
// ── THE COOKIE'S Secure FLAG DEPENDS ON NODE_ENV BEING SET ───────────────────
//
// REFRESH_COOKIE.options.secure is `process.env.NODE_ENV !== 'development'`,
// evaluated once when auth.service.js loads. Measured while writing this file:
// importing @prisma/client SETS process.env.NODE_ENV to 'development' when it is
// unset, and auth.service.js imports the Prisma client above the constant — so on
// a host with NODE_ENV unset the refresh cookie ships WITHOUT Secure, which is the
// opposite of what that constant's polarity was chosen for. Every supported way of
// starting this application sets the variable (the Dockerfile's
// `ENV NODE_ENV=production`, and .env for `npm run dev` / `npm start`), so this is
// lost defence in depth rather than a live exposure — but it is invisible in the
// unit tests, which mock Prisma and therefore never see the mutation.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';

import { MESSAGES } from '../../config/system_messages.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { logger } from '../../middlewares/logging.middleware.js';
import { authRateLimiter } from '../../middlewares/rate-limit.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { UnauthorizedError } from '../../utils/app-error.js';
import {
  forgotPasswordHandler,
  loginHandler,
  logoutHandler,
  meHandler,
  refreshHandler,
  registerHandler,
  resetPasswordHandler,
  verifyEmailHandler,
} from './auth.controller.js';
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from './auth.schema.js';

/**
 * Normalises anything URL-shaped to its `scheme://host:port`, or null if it is not
 * an http(s) URL.
 *
 * Comparing raw header text would be wrong in both directions. `CORS_ORIGIN` is
 * validated as `z.string().url()`, which accepts a trailing slash, so
 * 'http://localhost:5173/' in .env would never equal the 'http://localhost:5173' a
 * browser sends — measured, and the failure is a 401 on every refresh in an
 * environment that looks correctly configured. A `Referer` is a full URL with a
 * path and query, so it never equals an origin at all.
 *
 * ── WHY THE SCHEME IS CHECKED AND NOT JUST THE PARSE ─────────────────────────
 *
 * `new URL()` succeeds on far more than URLs. Measured: `new URL('localhost:5173')`
 * does not throw — it parses as the scheme `localhost:` with the path `5173` — and
 * its `.origin` is the STRING 'null', because origin is only defined for the
 * schemes the URL standard calls special. `new URL('file://').origin` is that same
 * string. Accepting those would mean a `CORS_ORIGIN` of 'localhost:5173' (which
 * zod's .url() also accepts, since it is backed by the same parser) silently became
 * the origin every request is compared against.
 *
 * Requiring http or https is what collapses all of that into one honest answer.
 * The only origins a browser can present to these two routes are http(s) ones and
 * the literal `null` of an opaque origin, so nothing legitimate is excluded.
 *
 * Returning null for everything unusable is also what keeps `Origin: null` a
 * mismatch rather than a special case, and it does so without the collision that
 * comparing `.origin` strings would have had: `new URL('null')` throws (measured),
 * so an opaque origin yields the value null, while a mis-set CORS_ORIGIN yields the
 * string 'null' — and even if both sides were unusable, the caller below never
 * compares two nulls.
 */
function originOf(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return url.protocol === 'http:' || url.protocol === 'https:'
    ? url.origin
    : null;
}

/** So an unconfigured CORS_ORIGIN warns once per process, not once per request. */
let unconfiguredWarned = false;

/**
 * The second half of the CSRF defence TRD:1673 specifies, for the two routes that
 * read the refresh cookie.
 *
 * ── WHY THESE TWO ROUTES AND NO OTHERS ───────────────────────────────────────
 *
 * Every other mutating endpoint authenticates from the `Authorization` header,
 * which a browser never attaches on its own, so there is nothing for a cross-site
 * page to ride. `POST /auth/refresh` and `POST /auth/logout` are the only routes
 * whose credential is a cookie — i.e. the only ones a browser will authenticate
 * for a page the user did not visit. Mounting this on a header-authenticated route
 * would add a way for a non-browser client to fail, and defend nothing.
 *
 * ── THE THREE OUTCOMES ───────────────────────────────────────────────────────
 *
 * Origin present → must match CORS_ORIGIN. `Origin` is set by the browser and not
 * writable from script, which is what makes it worth checking; it is preferred
 * over `Referer` when both are present because a page can suppress `Referer` with
 * a referrer policy and cannot suppress `Origin` on a POST.
 *
 * Neither header → allowed. This is the deliberate hole and it is narrower than it
 * looks: per the Fetch standard a browser sends `Origin` on every request whose
 * method is not GET or HEAD, and both of these routes are POST — so a request
 * arriving with neither header is not a browser, and a non-browser client carries
 * no ambient cookie for an attacker to borrow. Rejecting it would break curl,
 * Postman and every server-to-server caller for no gain.
 *
 * The residue is a browser old enough to omit `Origin` on a form POST, which is
 * also a browser old enough to ignore `SameSite=Strict` — measured to matter:
 * express.json() leaves `req.body` undefined for a form-encoded POST, and
 * refreshSchema maps a missing body to {}, so such a request does reach the
 * handler. What it achieves is bounded: no CORS grant means the attacker's page
 * cannot read the rotated token, so the reachable outcome is that the victim's
 * session is rotated or ended — a nuisance, not a takeover. `Sec-Fetch-Site:
 * cross-site` would close it and is not what TRD:1673 specifies; it is noted here
 * as available hardening rather than implemented.
 *
 * Mismatch → 401 with SESSION_INVALID, the same answer as an absent, expired or
 * revoked cookie. Not 403: apidoc §8.2 lists no 403 for either route, and one
 * message for every rejection is the same property SESSION_INVALID was authored
 * for — a cross-site caller learns nothing about whether the cookie it borrowed
 * was ever a real session.
 *
 * ── CORS_ORIGIN MISSING OR UNUSABLE ─────────────────────────────────────────
 *
 * Warns once and allows. env.js requires the variable at boot, so this branch is
 * unreachable in any process that ran env.js and is reached by every Vitest run,
 * which loads no .env. Failing closed instead would mean a missing variable
 * silently ends every session on the platform — a self-inflicted outage on the
 * security-irrelevant configuration path, where SameSite=Strict is still in force.
 *
 * The same branch catches a variable that is set to something that is not an
 * http(s) origin, for the same reason and one more: such a value has already broken
 * the `cors()` middleware in app.js, so a browser client is failing its preflight
 * long before it reaches this guard. A 401 here would be the second symptom of a
 * misconfiguration, and a much more confusing one than the warning this logs.
 */
export function requireSameOrigin(req, res, next) {
  const expected = originOf(process.env.CORS_ORIGIN ?? '');

  if (expected === null) {
    if (!unconfiguredWarned) {
      unconfiguredWarned = true;
      (req.log ?? logger).warn(
        { corsOrigin: process.env.CORS_ORIGIN ?? null },
        '[auth] CORS_ORIGIN is unset or is not an http(s) origin — the ' +
          'Origin/Referer check on /auth/refresh and /auth/logout is inactive ' +
          '(TRD:1673). SameSite=Strict still applies.',
      );
    }
    return next();
  }

  const origin = req.get('origin');
  const referer = req.get('referer');

  // Not a browser — see the header. Checked for presence before parsing, so that
  // "sent no headers" and "sent a header this cannot use" stay different answers:
  // an empty `Origin:` reads as the second and is refused (measured — req.get
  // returns '' for it, not undefined), because a browser does not send one.
  if (origin === undefined && referer === undefined) {
    return next();
  }

  if (originOf(origin ?? referer) !== expected) {
    (req.log ?? logger).warn(
      { origin: origin ?? null, referer: referer ?? null, expected },
      '[auth] refused a cookie-bearing request from a foreign origin (TRD:1673)',
    );
    return next(UnauthorizedError(MESSAGES.AUTH.SESSION_INVALID));
  }

  return next();
}

const router = Router();

/**
 * @openapi
 * components:
 *   schemas:
 *     AuthUser:
 *       type: object
 *       description: The `data.user` shape of apidoc §8.2. Never carries passwordHash — it is not selected from PostgreSQL at all outside login().
 *       required: [id, fullName, email, role, isEmailVerified]
 *       properties:
 *         id: { type: string, format: uuid, example: c7a6e118-2894-4d2b-a5d2-f1d1840e6c01 }
 *         fullName: { type: string, example: Alex Morgan }
 *         email: { type: string, format: email, example: alex@example.com }
 *         role: { type: string, enum: [STUDENT, INSTRUCTOR, ADMIN], example: STUDENT }
 *         isEmailVerified: { type: boolean, example: false }
 *     AuthProfile:
 *       description: AuthUser plus the columns an account may read about itself (GET /auth/me). isBanned and deletedAt are omitted — the auth guard has already refused every caller for whom either is set.
 *       allOf:
 *         - $ref: '#/components/schemas/AuthUser'
 *         - type: object
 *           properties:
 *             avatarUrl: { type: string, nullable: true, example: null }
 *             bio: { type: string, nullable: true, example: Software developer and learner }
 *             createdAt: { type: string, format: date-time, example: '2026-08-25T09:14:02.518Z' }
 *     AuthSession:
 *       type: object
 *       description: What register and login return. The 7-day refresh token is NOT here — it is delivered as an HttpOnly cookie so that script cannot read it (TRD §7.1).
 *       required: [user, accessToken]
 *       properties:
 *         user: { $ref: '#/components/schemas/AuthUser' }
 *         accessToken:
 *           type: string
 *           description: Bearer token, 15-minute lifetime, signed with JWT_SECRET.
 *           example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 */

/**
 * @openapi
 * /auth/register:
 *   post:
 *     summary: Register a student or instructor account
 *     description: |
 *       Creates the account, emails a verification token with a 24-hour TTL, and
 *       returns a 15-minute access token. Opens no session: there is no refresh
 *       cookie on this response, so a new account signs in to obtain one.
 *
 *       `role` accepts STUDENT and INSTRUCTOR only — ADMIN is refused by the
 *       schema, so self-registration cannot mint an administrator.
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName, email, password]
 *             properties:
 *               fullName: { type: string, minLength: 2, maxLength: 100, example: Alex Morgan }
 *               email: { type: string, format: email, maxLength: 254, example: alex@example.com }
 *               password:
 *                 type: string
 *                 description: At least 8 characters with uppercase, lowercase and a digit; at most 72 bytes.
 *                 example: SecurePassword123
 *               role: { type: string, enum: [STUDENT, INSTRUCTOR], default: STUDENT }
 *     responses:
 *       201:
 *         description: Account created.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 message: { type: string, example: Account registered successfully }
 *                 data: { $ref: '#/components/schemas/AuthSession' }
 *       409:
 *         description: Email address already registered. Deliberately generic — it does not distinguish a duplicate from any other conflict.
 *       422:
 *         description: Schema validation failed; `errors[]` carries one entry per field.
 *       429:
 *         description: More than 5 requests in 15 minutes from this IP.
 *       503:
 *         description: Redis unreachable, so the verification token could not be stored. The account is rolled back and no user is created.
 */
router.post(
  '/register',
  authRateLimiter,
  validate({ body: registerSchema }),
  registerHandler,
);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Authenticate credentials and open a session
 *     description: |
 *       Returns an access token in the body and sets the 7-day refresh token as
 *       `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`.
 *
 *       An unverified address may sign in and browse; verification gates only
 *       enrollment, course creation and quiz submission (TRD §6.1).
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email, example: alex@example.com }
 *               password: { type: string, example: SecurePassword123 }
 *     responses:
 *       200:
 *         description: Authenticated. The refresh token is in the Set-Cookie header, not the body.
 *         headers:
 *           Set-Cookie:
 *             description: refreshToken=...; Max-Age=604800; Path=/api/v1/auth; HttpOnly; Secure; SameSite=Strict
 *             schema: { type: string }
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 message: { type: string, example: Logged in successfully }
 *                 data: { $ref: '#/components/schemas/AuthSession' }
 *       401:
 *         description: Unknown address or wrong password — one message for both, so this endpoint is not an account oracle.
 *       403:
 *         description: Credentials valid but the account is banned or soft-deleted.
 *       422:
 *         description: Schema validation failed.
 *       429:
 *         description: More than 5 requests in 15 minutes from this IP.
 *       503:
 *         description: Redis unreachable, so the session could not be recorded. No tokens are issued.
 */
router.post(
  '/login',
  authRateLimiter,
  validate({ body: loginSchema }),
  loginHandler,
);

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     summary: Rotate the refresh cookie and issue a fresh access token
 *     description: |
 *       Reads the refresh token from the `HttpOnly` cookie — never from the body,
 *       which must be empty — verifies its `session:<jti>` key still exists,
 *       unlinks it, and issues a new pair.
 *
 *       Additionally requires that `Origin`, or `Referer` when `Origin` is absent,
 *       match `CORS_ORIGIN` (TRD §7.1 CSRF Defense). A request carrying neither
 *       header is not a browser and is allowed through.
 *     tags: [Authentication]
 *     security: []
 *     parameters:
 *       - in: cookie
 *         name: refreshToken
 *         required: true
 *         schema: { type: string }
 *         description: Sent automatically by the browser; not readable from script.
 *     responses:
 *       200:
 *         description: Rotated. The previous refresh token is revoked and cannot be replayed.
 *         headers:
 *           Set-Cookie:
 *             description: The rotated refresh token, same attributes as login.
 *             schema: { type: string }
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 message: { type: string, example: Session refreshed }
 *                 data:
 *                   type: object
 *                   properties:
 *                     accessToken: { type: string, example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... }
 *       401:
 *         description: Cookie absent, malformed, expired, revoked, of the wrong token class, from an account since banned or soft-deleted, or presented from a foreign origin. One message for all of them.
 *       422:
 *         description: A request body was sent. This endpoint takes none.
 *       429:
 *         description: More than 5 requests in 15 minutes from this IP (apidoc §4).
 *       503:
 *         description: Redis unreachable. Fails closed — a session that cannot be verified is not honoured.
 */
router.post(
  '/refresh',
  authRateLimiter,
  requireSameOrigin,
  validate({ body: refreshSchema }),
  refreshHandler,
);

/**
 * @openapi
 * /auth/verify-email:
 *   post:
 *     summary: Consume an email verification token
 *     description: |
 *       Idempotent: a token that arrives after the flag is already true earns the
 *       same 200. Only the SHA-256 of the token is stored, so a Redis dump yields
 *       no usable tokens.
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token:
 *                 type: string
 *                 description: The raw token from the emailed link — 64 lowercase hex characters.
 *                 example: 4f9c8d2e6712c91b3b2990a8e1b12f4a4f9c8d2e6712c91b3b2990a8e1b12f4a
 *     responses:
 *       200:
 *         description: Email address marked verified.
 *       400:
 *         description: Token unknown, already consumed, or expired.
 *       422:
 *         description: The token is not the right shape to have been issued by this application.
 *       429:
 *         description: More than 5 requests in 15 minutes from this IP.
 *       503:
 *         description: Redis unreachable — verification fails closed rather than proceeding unverified.
 */
router.post(
  '/verify-email',
  authRateLimiter,
  validate({ body: verifyEmailSchema }),
  verifyEmailHandler,
);

/**
 * @openapi
 * /auth/forgot-password:
 *   post:
 *     summary: Request a password reset link
 *     description: |
 *       Returns an identical 200 whether or not an account exists for the address:
 *       this endpoint is deliberately not an account-enumeration oracle (TRD §6.1).
 *       The token has a 15-minute TTL and invalidates any previous one.
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email, example: alex@example.com }
 *     responses:
 *       200:
 *         description: Accepted. Byte-identical for a known and an unknown address.
 *       422:
 *         description: Schema validation failed.
 *       429:
 *         description: More than 5 requests in 15 minutes from this IP.
 *       503:
 *         description: Redis unreachable, so no token could be stored.
 */
router.post(
  '/forgot-password',
  authRateLimiter,
  validate({ body: forgotPasswordSchema }),
  forgotPasswordHandler,
);

/**
 * @openapi
 * /auth/reset-password:
 *   post:
 *     summary: Set a new password using a reset token
 *     description: |
 *       The token is consumed before the new password is accepted, so it is
 *       single-use even if the update then fails. Revokes every session the
 *       account had — a reset must log out an attacker already holding a refresh
 *       token (TRD §6.1) — which is why the response tells the caller to sign in
 *       again.
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, newPassword]
 *             properties:
 *               token: { type: string, example: a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4 }
 *               newPassword: { type: string, example: BrandNewPassword2026 }
 *     responses:
 *       200:
 *         description: Password hash updated and all sessions revoked.
 *       400:
 *         description: Token unknown, already consumed, or expired.
 *       422:
 *         description: Schema validation failed — including a new password that does not meet the policy.
 *       429:
 *         description: More than 5 requests in 15 minutes from this IP.
 *       503:
 *         description: Redis unreachable — the reset fails closed.
 */
router.post(
  '/reset-password',
  authRateLimiter,
  validate({ body: resetPasswordSchema }),
  resetPasswordHandler,
);

// ── The two Authenticated routes — task 3.10 ─────────────────────────────────
//
// requireAuth ahead of both, for the reason in the header. On /auth/logout it
// runs BEFORE the origin guard, so that a request with no credential is refused
// by the cheaper of the two checks either way and the 401 does not depend on
// which header the caller omitted.

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     summary: Revoke the current refresh session
 *     description: |
 *       Unlinks `session:<jti>` and removes that jti from
 *       `session:index:<userId>`, then clears the cookie with the same
 *       Path=/api/v1/auth it was set with. Requires an Origin/Referer match
 *       (TRD §7.1). Idempotent: logging out twice is a 200 both times.
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Session revoked, or there was none to revoke.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 message: { type: string, example: Logged out successfully }
 *                 data: { type: object, nullable: true, example: null }
 *       401:
 *         description: No access token, or a foreign origin.
 *       403:
 *         description: The account is banned or soft-deleted.
 *       503:
 *         description: The authorization state could not be read.
 */
router.post('/logout', requireAuth, requireSameOrigin, logoutHandler);

/**
 * @openapi
 * /auth/me:
 *   get:
 *     summary: Read the authenticated account's own profile
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: The caller's profile.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 message: { type: string, example: Operation completed successfully }
 *                 data:
 *                   type: object
 *                   properties:
 *                     user: { $ref: '#/components/schemas/AuthProfile' }
 *       401:
 *         description: Missing, invalid or expired access token.
 *       403:
 *         description: The account is banned or soft-deleted.
 *       404:
 *         description: The account was deleted while the access token was still valid.
 *       503:
 *         description: The authorization state could not be read.
 */
router.get('/me', requireAuth, meHandler);

export default router;
