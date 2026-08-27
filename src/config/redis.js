// ─────────────────────────────────────────────────────────────────────────────
// Redis client — TRD §7.1, task 1.7.
//
// This file holds the CLIENT ONLY: connection, reconnection strategy, and error
// logging. Every key shape, every TTL and all three helpers live in
// src/utils/cache-keys.js. Nothing in this file may build a key, and no other
// module may build one either (TRD §7.1: "All patterns are constructed through
// src/utils/cache-keys.js — never by inline string concatenation at call sites").
//
// Redis here is an AUTHENTICATION dependency, not merely a cache (TRD §7.1). The
// rule is fail-closed on security decisions, fail-open on convenience reads: a
// session lookup that cannot reach Redis must answer 503 rather than admit the
// request, while a cache miss on a course listing falls through to PostgreSQL.
// Enforcing that is Day 3's job, but it is only *possible* if a command fails
// promptly when Redis is down — which is what the options below buy.
//
// FIVE CHOICES HERE ARE DELIBERATE. Each was measured against redis:7-alpine
// with ioredis 5.11.1, not assumed:
//
// 1. enableOfflineQueue STAYS ON, with BOTH maxRetriesPerRequest and
//    commandTimeout bounding how long a command can wait. Turning the queue off
//    looks like the fail-fast option and is a trap: with it off, *every* command
//    issued before the socket reaches 'ready' is rejected outright with "Stream
//    isn't writeable" — measured, and not just the first command — so a cold
//    start answers 503 to real users.
//
//    Bounding the retries alone is not enough either, which is why commandTimeout
//    is here. Two retries costs ~320ms at the start of an outage but grows with
//    the backoff as the outage lengthens — measured at 941ms and 1128ms a few
//    seconds in, and it would reach ~2× the ceiling below. commandTimeout puts a
//    hard ~1s bound on any single command whatever the outage's age (measured:
//    1008ms), which is what lets a security read answer 503 promptly instead of
//    holding the request open. Healthy commands are untouched (measured: a 9ms
//    PING against a live instance).
//
// 2. retryStrategy NEVER GIVES UP. Returning null (or an Error) stops
//    reconnection permanently, and a process that has permanently stopped
//    reconnecting to Redis can never authenticate anyone again until it is
//    restarted. An outage must degrade to 503 and then heal by itself, so the
//    strategy always returns a delay.
//
// 3. NO IMPORT OF src/config/env.js. That module calls process.exit(1) when
//    validation fails, and Vitest does not load .env into process.env — measured
//    in task 1.6. Importing it here would let any test that transitively touches
//    Redis kill its own test worker. The previous version of this file did import
//    it; this is a deliberate reversal, matching src/database/index.js.
//
// 4. NO ioredis `keyPrefix` OPTION. It rewrites key arguments but does NOT
//    rewrite SCAN's MATCH pattern, so writes would land under the prefix while
//    deleteByPattern swept the unprefixed namespace. That is exactly the
//    silent-miss failure the cache:/catalog: prefix split produced (Day 0 row
//    0.12): eviction reports success and the stale entry serves its full TTL.
//    The namespace is explicit in cache-keys.js instead.
//
// 5. NO SIGNAL HANDLERS. src/database/index.js registers fallback SIGTERM/SIGINT
//    handlers because an open connection pool needs closing; this file must not,
//    because registering a listener REPLACES Node's default termination, and a
//    second uncoordinated handler would race the database's. An open ioredis
//    socket does not block `docker stop` on its own — an unhandled SIGTERM
//    terminates the process regardless of open handles. The entrypoint calls
//    disconnectRedis() in its own sequence (task 2.8).
// ─────────────────────────────────────────────────────────────────────────────

import Redis from 'ioredis';

// Read straight from process.env, for the reason in note 3 above.
const NODE_ENV = process.env.NODE_ENV || 'development';

// Tests assert on output; a connection banner in the middle of a reporter's
// output is noise. Errors and outage warnings are never suppressed.
const quiet = NODE_ENV === 'test';

// Backoff: 100ms, 200ms, 300ms … capped at 3s. The cap matters more than the
// slope — an unbounded backoff eventually reconnects minutes after Redis came
// back, which reads to operators as "Redis is up but the API is still broken".
const RETRY_STEP_MS = 100;
const RETRY_CEILING_MS = 3000;

// See note 1. Two retries bounds the early-outage case; the command timeout
// bounds every other case, including a long outage where the backoff has grown to
// the ceiling above.
const MAX_RETRIES_PER_REQUEST = 2;
const COMMAND_TIMEOUT_MS = 1000;

/**
 * Chooses the connection URL.
 *
 * NODE_ENV=test prefers REDIS_URL_TEST, which .env points at database index 1
 * (`redis://localhost:6379/1`). That keeps a test run's FLUSHDB and pattern
 * sweeps off the development keyspace, and it is what makes TRD §9.2's
 * "tests/setup.js … rebinds the clients" a no-op: the client is already bound to
 * the test instance by the time a suite imports it.
 *
 * The literal fallback exists so the connection log reads as a host rather than
 * `undefined` when REDIS_URL is unset. It is not a substitute for configuration:
 * src/config/env.js is where REDIS_URL's presence is enforced, and inside a
 * container localhost resolves to nothing, so a missing URL still fails loudly at
 * boot rather than quietly working.
 */
function resolveUrl() {
  if (NODE_ENV === 'test' && process.env.REDIS_URL_TEST) {
    return process.env.REDIS_URL_TEST;
  }
  return process.env.REDIS_URL || 'redis://localhost:6379';
}

const url = resolveUrl();

/**
 * Describes the target without leaking credentials.
 *
 * REDIS_URL may carry a password (`redis://:secret@host:6379/0`), so it must
 * never be logged whole. Returns host, port and database index only, and gives up
 * quietly rather than throwing out of a logging helper.
 */
function describeTarget() {
  try {
    const parsed = new URL(url);
    const index = parsed.pathname.replace('/', '');
    return index ? `${parsed.host} db${index}` : parsed.host;
  } catch {
    return 'configured redis';
  }
}

/**
 * Reconnection strategy — see note 2. Always returns a delay, never null.
 */
function retryStrategy(attempt) {
  return Math.min(attempt * RETRY_STEP_MS, RETRY_CEILING_MS);
}

// lazyConnect means constructing this opens no socket (measured: status is
// 'wait' until the first command or an explicit connect()). That is why this
// module needs no lazy-Proxy wrapper of the kind src/database/index.js uses —
// ioredis has a first-class option for the same property, so importing this file
// from a unit test that never issues a command costs nothing.
const redis = new Redis(url, {
  lazyConnect: true,
  enableOfflineQueue: true, // Explicit, and load-bearing — see note 1.
  maxRetriesPerRequest: MAX_RETRIES_PER_REQUEST,
  commandTimeout: COMMAND_TIMEOUT_MS,
  retryStrategy,
});

/**
 * Turns a connection error into something worth logging.
 *
 * Necessary because the most common one arrives with an EMPTY message: when a
 * hostname resolves to several addresses — `localhost` is both ::1 and 127.0.0.1
 * — Node reports the failure as an AggregateError whose `message` is '' and whose
 * real reasons sit in `.errors`. Logging `error.message` alone therefore produced
 * "[redis]  — retrying", a line that names no cause at all. Measured, then fixed.
 */
function describeError(error) {
  if (error.message) {
    return error.message;
  }
  if (Array.isArray(error.errors) && error.errors.length > 0) {
    return error.errors.map((inner) => inner.message).join('; ');
  }
  return error.code || error.constructor.name;
}

// ── Error logging ────────────────────────────────────────────────────────────
//
// ioredis emits 'error' on every failed reconnection attempt, not once per
// outage: measured at 8 events in 3 seconds against a dead port, which is ~230k
// identical lines a day for one unreachable instance. Unbounded, that buries the
// line that explains the outage under the noise of the retries, and it is the
// logging pattern that makes people stop reading logs.
//
// So: report the first error of an outage in full, count the rest, and report the
// recovery with the suppressed count. Nothing is silently dropped — the count is
// itself the signal for how long the outage lasted.

let outageReported = false;
let suppressedErrors = 0;
let shuttingDown = false;

// Set while connectRedis() is waiting, so the first connection is announced once
// rather than twice — it logs the line with the timing, this handler stays quiet.
// A connection opened lazily by the first command still gets announced here.
let announcingElsewhere = false;

redis.on('error', (error) => {
  if (outageReported) {
    suppressedErrors += 1;
    return;
  }
  outageReported = true;
  console.error(
    `[redis] ${describeError(error)} — retrying, commands fail meanwhile`,
  );
});

redis.on('ready', () => {
  if (outageReported) {
    console.warn(
      `[redis] reconnected to ${describeTarget()} (${suppressedErrors} further error${
        suppressedErrors === 1 ? '' : 's'
      } suppressed during the outage)`,
    );
  } else if (!quiet && !announcingElsewhere) {
    console.info(`[redis] ready — ${describeTarget()}`);
  }

  outageReported = false;
  suppressedErrors = 0;
});

// 'end' means the connection closed and ioredis will not reconnect. Expected
// during shutdown; anything else is worth a warning, because at that point every
// subsequent command rejects and nothing will heal it.
redis.on('end', () => {
  if (!shuttingDown) {
    console.warn('[redis] connection ended and will not reconnect');
  }
});

/**
 * Opens the connection explicitly and reports it.
 *
 * Not required for the client to work — the first command connects on its own —
 * but it makes an unreachable Redis fail at boot instead of surfacing as a 503 on
 * the first authenticated request. Errors propagate: the caller decides whether
 * an unreachable Redis is fatal.
 *
 * Two ioredis behaviours are worked around here, both measured:
 *
 *  - connect() REJECTS with "Redis is already connecting/connected" if anything
 *    has already triggered the connection, so the status is checked first rather
 *    than calling connect() blindly.
 *  - a rejected connect() leaves the retry loop RUNNING (status 'reconnecting').
 *    That is the right default for a dependency that may come up a second later —
 *    compose starting redis after api — but it means a caller that gives up must
 *    exit the process or call disconnectRedis(), or it leaves a retry loop
 *    spinning behind a boot that already failed.
 */
export async function connectRedis() {
  if (redis.status === 'ready') {
    return redis;
  }

  const startedAt = process.hrtime.bigint();
  announcingElsewhere = true;

  try {
    if (redis.status === 'wait') {
      await redis.connect();
    } else {
      // Something already started connecting; wait for the outcome instead.
      await new Promise((resolve, reject) => {
        const onReady = () => {
          redis.removeListener('end', onEnd);
          resolve();
        };
        const onEnd = () => {
          redis.removeListener('ready', onReady);
          reject(new Error('Redis connection ended before it became ready'));
        };
        redis.once('ready', onReady);
        redis.once('end', onEnd);
      });
    }
  } finally {
    announcingElsewhere = false;
  }

  const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
  if (!quiet) {
    console.info(
      `[redis] connected to ${describeTarget()} in ${ms.toFixed(0)}ms`,
    );
  }

  return redis;
}

// Memoized so a signal handler and an explicit shutdown sequence share one quit.
let disconnectPromise = null;

/**
 * Closes the connection gracefully.
 *
 * quit() sends QUIT and waits for the server to close the socket, so in-flight
 * commands finish; disconnect() would drop them. Measured to resolve 'OK' from
 * both 'wait' (never connected) and 'ready', so no status guard is needed — but
 * it is wrapped anyway, because a shutdown path must not throw on its way out.
 */
export function disconnectRedis() {
  if (!disconnectPromise) {
    shuttingDown = true;
    disconnectPromise = (async () => {
      try {
        await redis.quit();
      } catch {
        // Already closing or closed. Nothing left to release.
        redis.disconnect();
      }

      if (!quiet) {
        console.info('[redis] disconnected');
      }
    })();
  }

  return disconnectPromise;
}

export { redis };
export default redis;
