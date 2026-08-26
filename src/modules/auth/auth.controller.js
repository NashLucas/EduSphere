// ─────────────────────────────────────────────────────────────────────────────
// Auth controllers — apidoc §8.2, TRD §6.1, task 3.9.
//
// Eight handlers, one per endpoint. Each one does the same four things in the same
// order and nothing else: pull what the request carries, call one service function,
// write any cookie the response needs, and hand the result to an api-response
// builder. That shape is the point — TRD §3.2 puts every decision in the service
// and every query behind it, so a controller that grows a branch is a controller
// that has taken something the service should own.
//
// ── WHAT A CONTROLLER IS FOR HERE ────────────────────────────────────────────
//
// Exactly the three things a service is forbidden to touch:
//
// 1. `req` → arguments. The services take plain values and never an Express
//    object, so login() and refresh() are handed `req.ip` and
//    `req.get('user-agent')` and logout() is handed `req.cookies[...]`. The
//    service comments say so at each call site.
// 2. `res` → cookies. REFRESH_COOKIE is the service's frozen constant, but only a
//    controller has a `res` to put it on. Set on login and refresh, cleared on
//    logout, and nowhere else.
// 3. `res` → envelope. Through success()/created() only, never res.json()
//    (plan:1020).
//
// ── NO try/catch, AND NO asyncHandler WRAPPER ────────────────────────────────
//
// Express 5 forwards a rejected promise from an async handler to the error
// middleware on its own — measured against express 5.2.1 rather than assumed: an
// async handler that throws an object carrying `statusCode: 418` reaches the 4-arg
// handler and answers 418. The Express 4 idiom of wrapping every handler in
// `asyncHandler(fn)` is dead weight on 5, and `try { } catch (err) { next(err) }`
// in eight handlers is eight chances to swallow one.
//
// So every AppError a service throws travels untouched to globalErrorHandler in
// app.js, which is the single place a status code becomes an error envelope. A
// controller here catches nothing, which also means none of them can accidentally
// downgrade a 503 into a 500.
//
// ── WHY THESE ARE NAMED WITH A `Handler` SUFFIX ──────────────────────────────
//
// `login`, `refresh` and `logout` are already service export names, and this file
// imports all three. Aliasing at the import (`login as loginService`) reads as
// though the service were the odd one out; a namespace import
// (`import * as authService`) would prefix every call site with a word that says
// nothing a reader of a controller file does not already know. Naming the handlers
// for what they are leaves the service functions their own names.
//
// ── THE TWO HANDLERS NOTHING CALLS YET ───────────────────────────────────────
//
// logoutHandler and meHandler are complete and unmounted. TRD:1459 and TRD:1464
// guard both routes as Authenticated, `requireAuth` is task 3.10, and
// src/middlewares/auth.middleware.js is an empty file — so auth.routes.js leaves
// those two registrations marked in place instead of mounting them. The reason
// they are written HERE anyway rather than deferred with the mount is that both
// depend on `req.user`, and a handler is the only place that dependency is
// visible: writing them now is what makes 3.10 a two-line change to the router
// instead of a second pass over this file. See auth.routes.js for the full note.
// ─────────────────────────────────────────────────────────────────────────────

import { MESSAGES } from '../../config/system_messages.js';
import { created, success } from '../../utils/api-response.js';
import {
  REFRESH_COOKIE,
  forgotPassword,
  getProfile,
  login,
  logout,
  refresh,
  register,
  resetPassword,
  signAccessToken,
  verifyEmail,
} from './auth.service.js';

/**
 * What the server observed about the request, as login() and refresh() want it.
 *
 * `req.ip` is trustworthy only because app.js sets `trust proxy` to 1 (task 2.1);
 * without it this records the load balancer's address on every session.
 *
 * The user agent is coerced to null rather than left undefined, because the
 * session record's shape must not vary with whether a header was sent — a JSON
 * value of `undefined` disappears on serialization, so the field would be absent
 * for some sessions and present for others in the same keyspace.
 */
const provenance = (req) => ({
  ip: req.ip,
  userAgent: req.get('user-agent') ?? null,
});

/**
 * `POST /auth/register` → 201 — apidoc §8.2.
 *
 * The one handler that calls two service functions, and the reason is recorded in
 * auth.service.js's header: plan:344 has register() return the user, while apidoc
 * §8.2's 201 body is `{ user, accessToken }`. Composing the two here is what that
 * note asks for.
 *
 * No cookie and no session. apidoc gives this response an access token and says
 * nothing about a refresh cookie, where login's entry spells one out — so a fresh
 * account holds a 15-minute credential and logs in to get a renewable one.
 */
export async function registerHandler(req, res) {
  const user = await register(req.body);

  return created(
    res,
    { user, accessToken: signAccessToken(user) },
    MESSAGES.AUTH.REGISTERED,
  );
}

/**
 * `POST /auth/login` → 200 + refresh cookie — apidoc §8.2.
 *
 * The refresh token is the only part of the pair that does NOT go in the body.
 * That is the whole of TRD:1669's design: an HttpOnly cookie is unreadable to
 * script, so an XSS on the frontend can steal the 15-minute access token out of
 * memory and cannot steal the 7-day renewal.
 */
export async function loginHandler(req, res) {
  const { user, accessToken, refreshToken } = await login(
    req.body,
    provenance(req),
  );

  res.cookie(REFRESH_COOKIE.name, refreshToken, REFRESH_COOKIE.options);

  return success(res, { user, accessToken }, MESSAGES.AUTH.LOGGED_IN);
}

/**
 * `POST /auth/refresh` → 200 + rotated cookie — apidoc §8.2.
 *
 * `req.cookies?.` rather than `req.cookies.`: cookie-parser is mounted in app.js
 * (invariant 3) so this is normally an object, but the optional chain is what
 * keeps a router mounted without it a 401 instead of a TypeError → 500. A missing
 * token and a missing parser then answer the same thing, which is the honest
 * answer to both.
 *
 * `data` carries the access token alone — no `user`. apidoc §8.2 pins that shape,
 * and refresh() returns no user object to put there.
 */
export async function refreshHandler(req, res) {
  const { accessToken, refreshToken } = await refresh(
    req.cookies?.[REFRESH_COOKIE.name],
    provenance(req),
  );

  res.cookie(REFRESH_COOKIE.name, refreshToken, REFRESH_COOKIE.options);

  return success(res, { accessToken }, MESSAGES.AUTH.SESSION_REFRESHED);
}

/**
 * `POST /auth/logout` → 200 — apidoc §8.2. NOT MOUNTED YET (see the header).
 *
 * `data: null`, which is what apidoc prints for this route and not the `{}` the
 * builders default to — measured: passing null explicitly serializes as null,
 * because the default only applies to `undefined`.
 *
 * clearCookie is given REFRESH_COOKIE.options WHOLE, and both halves of that
 * matter. Its own default Path is '/', which does not match the
 * `Path=/api/v1/auth` the cookie was set with, and a cookie is identified by name
 * plus path plus domain — so the default clears nothing and leaves a live refresh
 * token in the browser. The options object also carries `maxAge`, which express
 * deletes before deriving `expires`; if it ever stopped, this call would set a
 * cookie expiring seven days from now. Both are pinned in
 * tests/auth.service.test.js against the real express.
 *
 * The `{ revoked }` result is discarded, as the service's JSDoc says it will be:
 * apidoc gives this route one 200 and no way to say "there was nothing to log out
 * of". The service logs that distinction instead.
 */
export async function logoutHandler(req, res) {
  await logout(req.cookies?.[REFRESH_COOKIE.name], { userId: req.user.id });

  res.clearCookie(REFRESH_COOKIE.name, REFRESH_COOKIE.options);

  return success(res, null, MESSAGES.AUTH.LOGGED_OUT);
}

/**
 * `POST /auth/verify-email` → 200 — apidoc §8.2.
 *
 * `data: {}`. verifyEmail() returns nothing, deliberately: apidoc specifies no
 * payload, and the row it read carries `role` and `isBanned`, which have no
 * business in the response of an unauthenticated route.
 */
export async function verifyEmailHandler(req, res) {
  await verifyEmail(req.body);

  return success(res, {}, MESSAGES.AUTH.EMAIL_VERIFIED);
}

/**
 * `POST /auth/forgot-password` → 200 — apidoc §8.2.
 *
 * Byte-identical whether or not the address exists (TRD:1480). Nothing here
 * branches, and there is nothing in `data` to branch on: the status code, the
 * message and the empty payload are fixed at the call site, so the enumeration
 * resistance forgotPassword() is built for cannot be undone by this handler.
 */
export async function forgotPasswordHandler(req, res) {
  await forgotPassword(req.body);

  return success(res, {}, MESSAGES.AUTH.PASSWORD_RESET_SENT);
}

/**
 * `POST /auth/reset-password` → 200 — apidoc §8.2.
 *
 * No cookie is cleared. resetPassword() revokes every session server-side
 * (TRD:1476), so the browser may still hold a refresh cookie whose `session:<jti>`
 * key is gone — which refresh() answers 401 to, and which the message the user
 * reads already tells them to expect. Clearing it here would only help the one
 * browser that happened to send the request, and this route is reached from an
 * emailed link that is as likely to open somewhere else.
 */
export async function resetPasswordHandler(req, res) {
  await resetPassword(req.body);

  return success(res, {}, MESSAGES.AUTH.PASSWORD_RESET);
}

/**
 * `GET /auth/me` → 200 — apidoc §8.2. NOT MOUNTED YET (see the header).
 *
 * `data.user`, matching register's and login's payloads, so one client-side reader
 * handles the user object on all three. apidoc calls this "full user profile
 * object" and does not say whether it is `data` itself or nested; the nesting is
 * chosen for that consistency.
 *
 * The query is getProfile()'s, not this handler's — TRD §3.2: controllers execute
 * no database queries. `req.user.id` is the token's `sub` as requireAuth (3.10)
 * will attach it, so this reads the account that proved identity and never a
 * client-supplied id.
 */
export async function meHandler(req, res) {
  const user = await getProfile(req.user.id);

  return success(res, { user });
}

export default {
  registerHandler,
  loginHandler,
  refreshHandler,
  logoutHandler,
  verifyEmailHandler,
  forgotPasswordHandler,
  resetPasswordHandler,
  meHandler,
};
