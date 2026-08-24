// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting — TRD §7, apidoc §4, task 2.4.
//
// Three tiers, one per class of endpoint, each reading its numbers from
// RATE_LIMITS in config/constants.js so the policy is stated once (task 2.2):
//
//   globalRateLimiter  100 req / 15 min — every API request
//   authRateLimiter      5 req / 15 min — register, login, refresh,
//                                         forgot-password, reset-password,
//                                         verify-email
//   adminRateLimiter    10 req / 15 min — the destructive admin actions:
//                                         unpublish, republish, soft-delete,
//                                         restore, ban, unban, role change
//
// Only the global tier is mounted by app.js. The other two are exported for the
// routers that own those endpoints — auth arrives on Day 3, the admin routes on
// Day 10 — because a limiter must be applied where its routes are, and those
// routers do not exist yet. Defining all three here now is what keeps the numbers
// in one file instead of scattered across the routers that eventually consume
// them.
//
// ── The health probe is bypassed by ORDER, not by a skip in this file ────────
//
// apidoc §4 requires GET /health to be exempt. app.js mounts it ABOVE this
// middleware (its invariant 4), so a probe never reaches the limiter and there is
// nothing here to skip. A `skip: (req) => req.path === '/health'` would be a
// second statement of the same rule that can never fire, and a reader finding it
// would reasonably conclude this limiter does see /health. The ordering is the
// mechanism; app.js documents the stakes — a 429'd probe marks the container
// unhealthy and the runtime restarts it, forever, under exactly the load that
// produced the 429.
//
// ── Keying: the DEFAULT keyGenerator, deliberately not overridden ────────────
//
// plan:284 requires the key to be req.ip. v7.5.1's default keyGenerator returns
// exactly req.ip, and wraps it in three validations that supplying our own would
// discard (read from the installed dist, not from the changelog):
//
//   ip                  — throws on an undefined or non-IP req.ip, which is what
//                         a prematurely destroyed connection and a proxy
//                         misconfiguration both look like
//   trustProxy          — errors when `trust proxy` is `true`, because trusting
//                         the whole X-Forwarded-For chain lets a client spoof its
//                         own address and defeat every per-IP limit. app.js sets
//                         1 for that reason, and this validation is what holds
//                         the line if someone later "simplifies" it to true
//   xForwardedForHeader — flags an XFF header arriving while trust proxy is unset
//
// Those three are the difference between a limiter that fails loudly on a
// misconfigured deploy and one that silently buckets the entire platform into a
// single counter. A hand-written `keyGenerator: (req) => req.ip` produces a
// byte-identical key and forfeits all of them, so it is not written.
//
// plan:284 also permits an authenticated tier to "additionally partition by
// req.user.id so a shared NAT egress is not one bucket". That is measured to
// work, and is still not done here, for two reasons. req.user does not exist
// until the auth middleware lands (Day 3), so the partition would key every
// request on `undefined` until then — one shared bucket, the opposite of the
// intent. And v7.5.1 does not export the `ipKeyGenerator` helper that makes the
// IP fallback branch IPv6-safe (verified absent from the dist: it is a v8
// addition), so the fallback would hand raw IPv6 addresses to a store that
// treats each address as its own bucket. The router that mounts adminRateLimiter
// can layer the partition once req.user is guaranteed present; req.ip remains
// "the base key the spec defines".
//
// ── The 429 body is built by the global error handler, not here ──────────────
//
// The handler hands a TooManyRequestsError to next() rather than writing a
// response. Express routes it to globalErrorHandler, already the single place an
// error envelope is constructed (task 2.3), so a rate-limit 429 carries the same
// { status: "error", message } shape as every other failure and this file holds
// no envelope literal that could drift from it. Measured: Retry-After survives
// the detour, because standardHeaders sets the header before the handler runs and
// next() does not clear it.
//
// standardHeaders / legacyHeaders emit the RateLimit-* draft family and suppress
// the X-RateLimit-* one, so a client reads a single documented set.
//
// ── The store is IN-MEMORY, and that is a disclosed gap ─────────────────────
//
// This uses express-rate-limit's default MemoryStore, so every counter lives in
// this process's heap. Measured consequence: two instances of this app do not
// share a bucket — the same IP draws the full allowance from each — so N replicas
// serve N × the documented limit.
//
// TRD §1695 anticipates the other design. It lists `ratelimit:<scope>:<ip>` as
// "Managed by express-rate-limit's Redis store", and cache-keys.js already ships
// rateLimitPrefix() built for precisely that store's `prefix` option, tagged for
// this task. That store is not wired here because `rate-limit-redis` is neither
// installed nor declared in package.json, and adding a dependency is a change to
// the manifest rather than to this middleware. docker-compose declares one api
// service with no replica directive, so the limits are accurate as deployed
// today; the gap opens the moment a second instance starts.
//
// The swap is a single option on the factory below —
// `store: new RedisStore({ sendCommand, prefix: rateLimitPrefix(scope) })` —
// and until it happens, rateLimitPrefix() has no consumer.
// ─────────────────────────────────────────────────────────────────────────────

import { rateLimit } from 'express-rate-limit';

import { RATE_LIMITS } from '../config/constants.js';
import { TooManyRequestsError } from '../utils/app-error.js';

/**
 * What every tier does once a bucket is exhausted.
 *
 * `next` is the third positional parameter express-rate-limit calls this with, so
 * `req` and `res` must be named to reach it. Both are genuinely unused, which is
 * fine under no-unused-vars: its default `args: 'after-used'` reports only
 * parameters that follow the last used one.
 */
const rejectOverLimit = (req, res, next) => next(TooManyRequestsError());

/**
 * Builds one tier from a RATE_LIMITS entry.
 *
 * `max` is the name constants.js uses and the one apidoc §4 states the policy in.
 * v7 renamed the option to `limit` and kept `max` as a silent alias, so the
 * canonical name is what gets passed.
 *
 * @param {{windowMs: number, max: number}} tier
 * @returns {import('express').RequestHandler}
 */
function makeLimiter({ windowMs, max }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rejectOverLimit,
    // No keyGenerator and no store: both defaults are deliberate. See the header.
  });
}

/** 100 req / 15 min, every API request. Mounted by app.js. */
export const globalRateLimiter = makeLimiter(RATE_LIMITS.GLOBAL);

/**
 * 5 req / 15 min, the credential endpoints (apidoc §4). Applied by the auth
 * router (Day 3) — these callers are unauthenticated by definition, so req.ip is
 * the only key available to them.
 */
export const authRateLimiter = makeLimiter(RATE_LIMITS.AUTH);

/**
 * 10 req / 15 min, destructive admin actions (apidoc §4). Applied by the admin
 * routers (Day 10), downstream of requireAuth.
 */
export const adminRateLimiter = makeLimiter(RATE_LIMITS.ADMIN);

export default { globalRateLimiter, authRateLimiter, adminRateLimiter };
