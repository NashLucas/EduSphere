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
// Task 2.1 owns the ORDER. One slot below is still marked TODO because the module
// that fills it is a later task: the /api/v1 router. It is already in its correct
// position, so that task adds a module and an import — it must not move a line.
// Tasks 2.4, 2.5 and 2.7 filled their slots exactly that way: the global rate
// limiter, the redacting request logger and /health's live dependency check now sit
// where their TODOs stood.
//
// The 404 and error handlers are wired here because this task's middleware order
// ends with them. Task 2.3 has landed, so they no longer hold inline envelopes:
// normalizeError maps any throw to a status and api-response.js builds the body,
// leaving these two functions to decide only what gets logged and whether a stack
// is allowed out. No module in this file writes an envelope literal — /health is
// the one route that deliberately answers outside the envelope, for the reason
// documented at its handler.
//
// NO IMPORT OF src/config/env.js, matching src/database/index.js and
// src/config/redis.js. That module calls process.exit(1) on a validation failure
// and Vitest does not load .env into process.env, so importing it here would let
// any suite that touches the app — every Supertest suite from Day 2 on — kill its
// own test worker. Boot-time validation belongs in src/server.js (task 2.8), which
// no test imports.
//
// /health's two dependencies ARE imported (task 2.7), and neither opens a socket at
// import time: the Prisma export is a lazy Proxy that constructs its client on first
// property access, and the ioredis client is configured lazyConnect. Importing this
// file therefore still costs no connections — only a request to /health opens them.
// One side effect does come along: src/database/index.js registers fallback
// process.once('SIGTERM'|'SIGINT') handlers when it is imported, so requiring app.js
// now installs those. They exist to close the pool if nothing else claims shutdown,
// and src/server.js (task 2.8) takes over from them through the claimShutdown()
// export that module already provides.
// ─────────────────────────────────────────────────────────────────────────────

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import prisma from './database/index.js';
import redis from './config/redis.js';
import { NotFoundError, normalizeError } from './utils/app-error.js';
import { error as sendErrorEnvelope } from './utils/api-response.js';
import { globalRateLimiter } from './middlewares/rate-limit.middleware.js';
import { httpLogger } from './middlewares/logging.middleware.js';

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

// Request logging (task 2.5). httpLogger attaches a per-request child logger at
// req.log, generates a UUID request id echoed as X-Request-Id, and redacts the
// credential-bearing fields — Authorization, Cookie, and the Set-Cookie on the
// way out — that a bare pinoHttp() would write verbatim. High in the stack on
// purpose: the rate limiter's 429s and the global error handler both log through
// the req.log it installs.
app.use(httpLogger);

// ── GET /health (TRD §1407 & AC-10, apidoc §8.1, task 2.7) ──────────────────
//
// See invariant 4: above the rate limiter, and above the body parsers it has no
// use for.
//
// FLAT, NOT ENVELOPED. This is the one route in the application that does not use
// the { status, message, data } envelope, and apidoc §8.1 says so explicitly —
// the Dockerfile HEALTHCHECK and orchestrator probes read these four keys
// directly, so wrapping them breaks every probe. Note that `status` here is the
// health verdict ("ok" / "error"), NOT the envelope's "success" / "error"; the two
// vocabularies collide on one word and mean different things.
//
// Both dependencies are pinged in PARALLEL, so the endpoint costs the slower of
// the two rather than their sum. It is a live check on both sides — a `SELECT 1`
// and a Redis PING, not a look at a connection-state flag — which is what
// swagger.json's field descriptions promise ("proven by a query / PING rather
// than by connection state").
//
// ── WHY EACH PING IS BOUNDED ────────────────────────────────────────────────
//
// The container probe is `wget --timeout=5s` (TRD:1858). Measured here, an
// unbounded ping can outlast it:
//
//   database, connection REFUSED   ~2.1s   PrismaClientInitializationError
//   database, host BLACK-HOLED      5.1s   OVER the 5s probe budget
//   redis, either failure mode     ~1.0s   self-bounded by commandTimeout: 1000
//
// ioredis bounds itself; Prisma does not. Against a host that drops packets
// instead of refusing them — a firewall change, a withdrawn route, an instance
// mid-failover — Prisma waits on its own connect timeout and the probe dies at
// the wget layer. That loses the only thing this endpoint adds over a TCP check:
// a wget timeout says "unhealthy", while the 503 body says WHICH dependency is
// down. So each ping carries its own deadline, comfortably inside the probe's,
// and a hung dependency is reported as disconnected rather than as silence.
// Measured with the bound in place: 2.5s worst case, 2ms warm.

/**
 * How long one dependency ping may take before it is reported as disconnected.
 *
 * 2.5s, and the exact value is chosen against a measurement rather than picked for
 * roundness. Two constraints squeeze it from both sides:
 *
 *   lower bound — a REFUSED connection (the stopped-container case, and much the
 *     most likely real outage) takes Prisma 2036-2177ms to report. A deadline at
 *     2000ms preempts that by a hair, so the race is a coin flip and the log line
 *     carried "database ping exceeded 2000ms" on some probes and Prisma's far more
 *     useful "Can't reach database server at `host:port`" on others (both observed
 *     in one run). Sitting above that range makes the informative message win
 *     deterministically, which matters because the response body cannot carry it.
 *   upper bound — half of the Dockerfile HEALTHCHECK's 5s, so the 503 body still
 *     reaches the probe that asked for it rather than dying at the wget layer.
 *
 * It is still ~65x the measured 38ms cold connect, so a healthy dependency is
 * nowhere near it, and a database that cannot answer `SELECT 1` inside 2.5s is
 * unhealthy by any definition worth probing for.
 *
 * Local rather than in config/constants.js on purpose. That module's own header
 * scopes it to values "retyped as literals across dozens of call sites"; this one
 * has a single reader and is meaningful only against the Dockerfile's --timeout, so
 * the reasoning above is worth more here than the indirection would be.
 */
const HEALTH_PING_TIMEOUT_MS = 2500;

/**
 * Runs one dependency ping under a deadline. Never rejects for longer than
 * HEALTH_PING_TIMEOUT_MS, whatever the underlying client does.
 *
 * Takes a THUNK rather than a promise. `pingWithTimeout('db', prisma.$queryRaw…)`
 * would evaluate the query expression before this function is entered, so anything
 * thrown while the client is being constructed would escape both this wrapper and
 * the Promise.allSettled below, reach globalErrorHandler, and answer an ENVELOPED
 * 500 — the one body shape apidoc §8.1 rules out for this route. Invoking the thunk
 * inside turns any such throw into a rejection this function owns. (Measured: today
 * neither an absent nor a malformed DATABASE_URL actually throws synchronously —
 * Prisma defers both to query time. The thunk closes the class, not an observed
 * case.)
 *
 * clearTimeout in `finally` is load-bearing, not tidiness: without it every healthy
 * probe leaves a live 2.5s timer behind — 120 an hour — and task 2.8's graceful
 * shutdown would wait on handles that only hold an already-settled race. Measured
 * with it: 0 active Timeout handles once the response is sent, and the abandoned
 * ping raises no unhandledRejection, because Promise.race has already attached
 * handlers to the loser.
 */
function pingWithTimeout(label, run) {
  let timer;

  return Promise.race([
    Promise.resolve().then(run),
    new Promise((_resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(`${label} ping exceeded ${HEALTH_PING_TIMEOUT_MS}ms`),
          ),
        HEALTH_PING_TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

app.get('/health', async (req, res) => {
  const [database, cache] = await Promise.allSettled([
    pingWithTimeout('database', () => prisma.$queryRaw`SELECT 1`),
    pingWithTimeout('redis', () => redis.ping()),
  ]);

  const healthy =
    database.status === 'fulfilled' && cache.status === 'fulfilled';

  // The reason goes to the log, never to the body. apidoc §8.1 fixes the response
  // to four keys, and Prisma's failure text names the database host and port
  // (measured: "Can't reach database server at `127.0.0.1:5432`") — not something
  // an unauthenticated endpoint should hand out. The operator who needs it reads it
  // here.
  //
  // .message rather than the Error: measured, pino's error serializer is registered
  // for the `err` key alone, so an Error under any other key serializes as `{}` —
  // a log line that fires the alert and carries nothing. Two independent failures
  // cannot share one `err` key, so each contributes its message. Undefined keys are
  // omitted by pino (measured), so a Redis-only outage logs no `database` field.
  //
  // This line is the detail, not the alarm: logging.middleware's customLogLevel
  // already stamps the request-completion line for any 5xx at level error, which is
  // precisely the "handler that writes a 5xx directly rather than throwing" case
  // that function was written for.
  if (!healthy) {
    (req.log?.error ?? console.error).call(
      req.log ?? console,
      {
        database: database.reason?.message,
        redis: cache.reason?.message,
      },
      '[health] dependency check failed',
    );
  }

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'error',
    database: database.status === 'fulfilled' ? 'connected' : 'disconnected',
    redis: cache.status === 'fulfilled' ? 'connected' : 'disconnected',
    // Whole seconds: apidoc §8.1's example is an integer (14250), and no probe has
    // a use for process.uptime()'s fractional microseconds.
    uptime: Math.floor(process.uptime()),
  });
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

// 100 req/15 min keyed on req.ip (task 2.4). It belongs exactly here: after
// `trust proxy` so req.ip is the real client, and after /health so the probe is
// never counted. The auth (5/15 min) and admin-destructive (10/15 min) tiers are
// exported from the same module and applied at their own routers, which do not
// exist yet — a limiter has to sit where its routes are.
app.use(globalRateLimiter);

// TODO: app.use('/api/v1', apiRouter) once the first router exists (2.x).

/**
 * 404 for anything unmatched.
 *
 * A terminal `app.use` rather than a wildcard route: Express 5 rewrote its path
 * matching, and the Express 4 idiom `app.get('*', …)` now throws at startup
 * ("Missing parameter name") because a bare `*` is no longer a valid pattern.
 *
 * The path is interpolated, so it cannot be a system_messages constant — the
 * method and URL are only known here. It is thrown rather than sent, so the one
 * error envelope lives in globalErrorHandler: Express 5 catches a synchronous
 * throw from a middleware and routes it there, a NotFoundError carries the 404,
 * and the handler formats it exactly like every other miss. `throw` also keeps the
 * signature to the one argument used, since this config warns on any unused param.
 */
function notFoundHandler(req) {
  throw NotFoundError(`Cannot ${req.method} ${req.originalUrl}`);
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
 * The construction of the envelope lives in api-response.js, and the mapping of a
 * raw throw to a status lives in normalizeError (task 2.3): this function only
 * decides what to log and whether the stack is allowed out. That split is why a
 * duplicate-key Prisma error answers 409 rather than 500 — `err.statusCode` is
 * undefined on a Prisma error, so normalizeError, not `|| 500`, supplies the code.
 */
function globalErrorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const { statusCode, message, errors, isOperational } = normalizeError(err);

  // A 500 is a bug in this process and has to reach the operator with its real
  // detail; a 4xx the client caused is already reported in the response. A
  // non-operational error at any status is also a bug worth the operator's eyes —
  // normalizeError sets that flag precisely for the Prisma/parse cases whose
  // mapped status is a 4xx but whose cause is ours to see.
  if (statusCode >= 500 || !isOperational) {
    (req.log?.error ?? console.error).call(
      req.log ?? console,
      { err, statusCode },
      '[app] request failed',
    );
  }

  sendErrorEnvelope(
    res,
    statusCode,
    message,
    errors,
    // Stack traces name internal paths and dependency versions, so they are gated
    // on development explicitly rather than on `NODE_ENV !== 'production'` — an
    // unset NODE_ENV must not leak them.
    NODE_ENV === 'development' ? err.stack : undefined,
  );
}

app.use(notFoundHandler);
app.use(globalErrorHandler);

export default app;
