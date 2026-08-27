// ─────────────────────────────────────────────────────────────────────────────
// Structured request logging — TRD §3.4/§7, task 2.5.
//
// Exports two things:
//
//   logger            the base pino instance, for code that logs outside a
//                     request — startup, shutdown, the Day 3 email stub
//                     (plan:343), background jobs
//   httpLogger        the pino-http middleware app.js mounts, which attaches a
//                     per-request child logger at req.log
//
// One instance underneath both, because the redaction below is only a guarantee
// if every line in the process goes through it. A module that reaches for a
// second pino() gets none of it.
//
// ── REDACTION IS THE POINT OF THIS FILE ─────────────────────────────────────
//
// Before this landed, app.js mounted a bare pinoHttp(). Measured against that
// configuration, a single authenticated request wrote to the log:
//
//   req.headers.authorization  "Bearer <the caller's access token>"
//   req.headers.cookie         "refreshToken=<the caller's refresh token>"
//   res.headers['set-cookie']  "refreshToken=<a freshly issued refresh token>"
//
// Any of the three is a full account takeover for whoever can read the log, and
// the third is worse than the first two: the refresh token is valid for seven
// days (JWT_REFRESH_EXPIRES_IN), so a log line outlives the 15-minute access
// window by three orders of magnitude.
//
// The task text names three paths — req.body.password, req.headers.authorization,
// req.headers.cookie. The set below is wider, because two of those three are not
// where the measured leaks were:
//
//   res.headers["set-cookie"]  NOT named by task 2.5, and the most damaging leak
//                              of the three. pino-http's default res serializer
//                              emits { statusCode, headers }, and every login,
//                              register and refresh response carries the new
//                              refresh token in that header. plan:974 (task 16.6)
//                              requires "Cookie ... never reach a log line", which
//                              this is; the bracket form is required because the
//                              key is hyphenated.
//   passwordHash               plan:974 again. A service that logs a user row
//                              — `log.info({ user }, 'created')` — otherwise
//                              writes the bcrypt hash. The bare path covers a
//                              top-level field and `*.passwordHash` covers one
//                              level of nesting, which is the `{ user }` shape.
//   req.body.password          named by the task, and DORMANT: pino-http does not
//                              serialize req.body at all (measured — a login's
//                              password never reaches the log in the first
//                              place). It is kept because it costs nothing, it is
//                              what the task asked for, and it becomes live the
//                              moment anyone adds a body serializer. Measured
//                              that a dormant path neither throws nor invents the
//                              key it names.
//
// Redaction is a safety net, not permission to log secrets. Measured limit: the
// single-star wildcard matches ONE level, so `{ data: { user: { passwordHash }}}`
// at depth two is NOT covered. Do not rely on this list to sanitise an object you
// chose to log; the list exists for the fields that arrive without anyone
// choosing.
//
// JWT_SECRET and JWT_REFRESH_SECRET are also named by plan:974. They are not
// paths here because they are not request fields — they live in process.env and
// reach a log only if something logs the environment. No path can prevent that;
// not doing it is what prevents it.
//
// ── Level: quiet in tests, quiet-ish in production, verbose in development ────
//
// LOG_LEVEL wins when set, so an operator can turn on debug without a deploy.
// Otherwise the level follows NODE_ENV: silent under test, because Vitest sets
// NODE_ENV=test (measured) and a suite that prints a JSON line per request buries
// its own failures; debug in development; info everywhere else.
//
// Read from process.env directly rather than importing config/env.js, matching
// app.js, database/index.js and config/redis.js. That module calls
// process.exit(1) on a validation failure and Vitest loads no .env, so importing
// it here would let any suite that touches the app kill its own worker.
//
// That level is the FLOOR — which lines are emitted at all. The severity stamped on
// each request-completion line is a separate decision, and pino-http's default gets
// it wrong for this application; see resolveResponseLevel below.
//
// ── Request IDs ─────────────────────────────────────────────────────────────
//
// pino-http's default id is a per-process counter starting at 1 (measured), so
// two instances both call the first request of their life "1" and the id is
// useless for correlating anything across a restart or a replica. genReqId
// replaces it with a UUID, and honours an inbound X-Request-Id so a trace that
// starts at a gateway keeps one id end to end.
//
// The id is echoed back in the X-Request-Id response header. That is what makes
// plan:897 (task 14.9) possible — a 500 gives the client a generic message, and
// this header is the only thing tying the report "I got an error" to the log line
// holding the stack. Setting a header inside genReqId is safe because pino-http
// calls it before the handler runs, long before anything is sent.
//
// responseTime comes free with pino-http and is not configured here; TRD §123
// aggregates that field for the p95 latency target, so it must not be serialized
// away.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';

import pino from 'pino';
import pinoHttp from 'pino-http';

const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * The level, in precedence order: explicit LOG_LEVEL, then NODE_ENV's default.
 *
 * 'silent' under test is deliberate — see the header. It is a real pino level,
 * not a sentinel: it suppresses every line rather than filtering by severity.
 */
function resolveLevel() {
  if (process.env.LOG_LEVEL) {
    return process.env.LOG_LEVEL;
  }
  if (NODE_ENV === 'test') {
    return 'silent';
  }
  return NODE_ENV === 'development' ? 'debug' : 'info';
}

/**
 * The redaction list. See the header for why each entry is here and why the
 * list is wider than task 2.5's three paths.
 *
 * `censor` is an explicit string rather than pino's default '[Redacted]' so the
 * value is this file's contract and a pino upgrade cannot quietly change what a
 * redacted field looks like to a log parser.
 */
const REDACT_PATHS = Object.freeze([
  // Named by task 2.5.
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  // Measured leaks / plan:974 (task 16.6).
  'res.headers["set-cookie"]',
  'passwordHash',
  '*.passwordHash',
]);

export const logger = pino({
  level: resolveLevel(),
  redact: { paths: [...REDACT_PATHS], censor: '[Redacted]' },
  // ISO timestamps rather than pino's epoch milliseconds: these lines are read by
  // a human during an incident at least as often as by a parser.
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    // pino writes `level: 30`; log platforms and humans both expect the word.
    level: (label) => ({ level: label }),
  },
});

/**
 * The level of the request-completion line.
 *
 * pino-http does NOT do this itself. Read from its source: the level comes from
 * `customLogLevel ? customLogLevel(...) : useLevel`, and useLevel defaults to
 * 'info' — so without this function a 500 completes at level info, carrying a
 * synthesised `err` and the message "request errored" but no error severity. Every
 * operator filter and alert rule is written on level, so the server's own failures
 * would be invisible to the one query that looks for them.
 *
 * globalErrorHandler does log 5xx at error itself, which covers most of it — but
 * not all: it returns early when res.headersSent, delegating to Express's default
 * handler without logging (app.js documents that path), and any future handler that
 * writes a 5xx directly rather than throwing never reaches it. This makes the
 * status code alone sufficient, whatever route produced it.
 *
 * 4xx deliberately stays at info. A client error is the client's, it is already
 * reported in the response body, and promoting a 404 sweep or a 429 storm to warn
 * fills the level an operator watches with traffic they cannot act on individually.
 *
 * `err` is pino-http's transport-level failure (a socket error on the response),
 * which never has a status code — it belongs at error regardless.
 */
function resolveResponseLevel(req, res, err) {
  if (err || res.err || res.statusCode >= 500) {
    return 'error';
  }
  return 'info';
}

/**
 * Per-request id: an inbound X-Request-Id when present, else a fresh UUID.
 * Echoed to the client so an error report can be tied to a log line (plan:897).
 *
 * The inbound header is trusted only as a correlation hint. It is never used for
 * authorization or as a database key, so a client sending a duplicate or a
 * nonsense value can confuse its own trace and nothing else.
 */
function genReqId(req, res) {
  const inbound = req.headers['x-request-id'];
  const id =
    typeof inbound === 'string' && inbound.length > 0
      ? inbound
      : crypto.randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}

/**
 * The pino-http middleware. app.js mounts this high in the stack so that every
 * later middleware — including the rate limiter's 429s and the global error
 * handler — has req.log available and is covered by a request log line.
 */
export const httpLogger = pinoHttp({
  logger,
  genReqId,
  customLogLevel: resolveResponseLevel,
});

export default { logger, httpLogger };
