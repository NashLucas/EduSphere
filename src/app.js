// ─────────────────────────────────────────────────────────────────────────────
// Express application factory — TRD §6, task 2.1.
//
// This file is a WIRING MANIFEST. Its content is the order of the middleware
// stack, and four positions in that order are correctness requirements rather
// than style. Reordering them produces a server that starts, serves traffic, and
// is wrong in a way no unit test notices:
//
// 1. `trust proxy` BEFORE anything that reads req.ip. Behind a load balancer or
//    ingress, req.ip is the proxy's address on every request unless Express is
//    told to read X-Forwarded-For. The global 100 req/15 min tier then applies to
//    the platform as a whole — request 101 from any user anywhere is rejected,
//    and the logs show one IP hammering the API. Locally there is no proxy, req.ip
//    is already the client, and every test passes (TRD §7, apidoc §4).
//
// 2. The webhook `express.raw()` mount BEFORE `express.json()`. Signature
//    verification runs over the exact bytes the provider signed. Once the JSON
//    parser has consumed the stream those bytes are gone, and re-serializing
//    req.body produces a different sequence — different key order, whitespace and
//    unicode escaping — so the HMAC never matches and every legitimate webhook is
//    rejected as a forgery. The `verify: (req, res, buf) => …` workaround is worse:
//    it gives every request in the application a second full copy of its body in
//    memory (TRD §6.11).
//
// 3. `cookie-parser` BEFORE any route that reads the refresh cookie. Without it
//    req.cookies is undefined and the refresh endpoint reads a missing token as an
//    absent session, so refresh fails with 401 for every user rather than erroring
//    somewhere a developer would look.
//
// 4. GET /health BEFORE the rate limiter. The Dockerfile HEALTHCHECK probes it
//    every 30 seconds (`wget --spider http://localhost:3000/health`), so a probe
//    that draws a 429 marks the container unhealthy and the runtime restarts it —
//    forever, under exactly the load that triggered the limit. Task 2.4 states the
//    requirement as "health probe bypassed"; mounting above the limiter is what
//    implements it.
//
// The body limit is 100kb, not 10mb. All large media moves through pre-signed
// direct-to-S3 uploads (Day 8) and never transits this parser; the one exception
// is the 5 MB avatar route, where multer applies its own limit downstream. A 10 MB
// JSON limit buys nothing and hands an unauthenticated caller a 10 MB allocation
// per request (TRD §7).
//
// ── What is a placeholder here, and what is finished ─────────────────────────
//
// Task 2.1 owns the ORDER. Four slots below are marked TODO because the modules
// that fill them are later tasks: the rate limiter (2.4), the pino options with
// credential redaction (2.5), the /api/v1 router, and /health's real body (2.7).
// Each slot is already in its correct position, so those tasks add a module and an
// import — they must not move a line.
//
// The 404 and error handlers are wired here because this task's middleware order
// ends with them, but they are deliberately minimal: task 2.3 replaces their
// bodies with AppError and the ApiResponse builders. What they must already get
// right is the envelope, because that is a published contract rather than an
// implementation detail — see the note above globalErrorHandler.
//
// NO IMPORT OF src/config/env.js, matching src/database/index.js and
// src/config/redis.js. That module calls process.exit(1) on a validation failure
// and Vitest does not load .env into process.env, so importing it here would let
// any suite that touches the app — every Supertest suite from Day 2 on — kill its
// own test worker. Boot-time validation belongs in src/server.js (task 2.8), which
// no test imports.
// ─────────────────────────────────────────────────────────────────────────────

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';

const NODE_ENV = process.env.NODE_ENV || 'development';

const app = express();

// See invariant 1. The value is 1 — trust exactly one proxy hop — not `true`,
// which trusts the whole X-Forwarded-For chain and lets a client spoof its own
// address by sending the header, defeating every per-IP limit downstream.
app.set('trust proxy', 1);

app.use(helmet());

// Read straight from process.env, for the reason in the header. `npm run dev`,
// `npm start` and the container all load .env, so this is populated at runtime;
// under Vitest it is undefined, and cors() then applies NO headers at all —
// measured, and it includes Access-Control-Allow-Credentials, not just the
// origin. That is the safe direction to fail: a browser blocks the cross-origin
// read rather than being handed '*'.
//
// A single origin, because that is what env.js validates (`z.string().url()`). If
// CORS_ORIGIN ever becomes the comma-separated list its .env comment describes,
// this needs to split it: cors() compares the string whole, so 'http://a,http://b'
// matches neither half — measured — and every browser client silently loses access
// while curl keeps working.
app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }));

// TODO(2.5): replace with pinoHttp(loggerOptions) — request IDs, response-time
// tracking, log-level by NODE_ENV, and redaction of req.body.password,
// req.headers.authorization and req.headers.cookie. Until then this logs request
// headers verbatim, Authorization included.
app.use(pinoHttp());

// See invariant 4: above the rate limiter, and above the body parsers it has no
// use for.
//
// TODO(2.7): replace the body with a live database ping (`SELECT 1` via
// $queryRaw) and a Redis PING, answering { status, database, redis, uptime } or
// 503 when either dependency is down, and update swagger.json's health schema to
// match. Until then this reports only that the process is listening — which is
// what the committed swagger stub already declares, so the two agree today.
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// See invariant 2. This mounts the raw parser, not the route — the webhook
// handler itself arrives with the email integration (Day 11). Mounting the parser
// now is what makes the ordering permanent instead of something a later task has
// to remember.
app.use(
  '/api/v1/webhooks',
  express.raw({ type: 'application/json', limit: '100kb' }),
);

app.use(express.json({ limit: '100kb' }));

// See invariant 3.
app.use(cookieParser());

// TODO(2.4): app.use(globalRateLimiter) — 100 req/15 min keyed on req.ip, with
// the auth (5/15 min) and admin-destructive (10/15 min) tiers applied at their
// own routers. It belongs exactly here: after trust proxy so req.ip is the real
// client, and after /health so the probe is not counted.

// TODO: app.use('/api/v1', apiRouter) once the first router exists (2.x).

/**
 * 404 for anything unmatched.
 *
 * A terminal `app.use` rather than a wildcard route: Express 5 rewrote its path
 * matching, and the Express 4 idiom `app.get('*', …)` now throws at startup
 * ("Missing parameter name") because a bare `*` is no longer a valid pattern.
 *
 * TODO(2.3): throw AppError.notFound(...) and let the error handler format it, so
 * the envelope is built in one place.
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    status: 'error',
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
}

/**
 * Terminal error handler.
 *
 * TAKES FOUR ARGUMENTS. Express identifies an error handler by arity alone, so
 * dropping the unused `next` silently demotes this to ordinary middleware that
 * never runs on the error path, and every failure becomes Express's default HTML
 * stack-trace page (plan:1021).
 *
 * `next` is not decoration: once headers are sent, writing a second body throws
 * ERR_HTTP_HEADERS_SENT inside the handler and the response never completes.
 * Delegating to Express's default handler is the only correct move there — it
 * destroys the socket instead.
 *
 * THE ENVELOPE IS THE PART THAT MATTERS TODAY. `status` is the string 'error',
 * never a boolean, and the payload key is `data` or `errors`, never a
 * resource-specific name (TRD §6). The scaffold this replaces emitted
 * `{ success: false, … }`, which no documented client can read. Task 2.3 moves
 * the construction into ApiResponse; the shape does not change when it does.
 */
function globalErrorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const statusCode = err.statusCode || 500;

  // A 500 is a bug in this process and has to reach the operator; a 4xx is a
  // client mistake the response already reports, and logging those at error level
  // trains people to ignore the level.
  if (statusCode >= 500) {
    console.error('[app] unhandled error:', err);
  }

  res.status(statusCode).json({
    status: 'error',
    message: err.message || 'Internal Server Error',
    // Stack traces name internal paths and dependency versions, so they are
    // gated on development explicitly rather than on `NODE_ENV !== 'production'`
    // — an unset NODE_ENV must not leak them.
    ...(NODE_ENV === 'development' && { stack: err.stack }),
  });
}

app.use(notFoundHandler);
app.use(globalErrorHandler);

export default app;
