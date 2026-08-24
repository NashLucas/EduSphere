// ─────────────────────────────────────────────────────────────────────────────
// Process entrypoint — TRD §3.4 (":209 — server bootstrap, DB connection, Redis
// init, graceful shutdown"), TRD §10.1/§10.2, task 2.8.
//
// The container runs this file directly — `CMD ["node", "src/server.js"]`, with no
// npm wrapper — so this process is PID 1 and SIGTERM arrives HERE instead of being
// swallowed by a process that does not forward it (Dockerfile:71-73, plan:75).
// Every decision below follows from that.
//
// ── BOOT ORDER IS THE CONTRACT ───────────────────────────────────────────────
//
//   1. validate configuration     ./config/env.js, imported first
//   2. claim shutdown             take the signal handlers off the db singleton
//   3. connect both dependencies  PostgreSQL and Redis, in parallel
//   4. bind the listener          only after 1-3 have all succeeded
//
// Step 1 before step 4 is a TRD requirement rather than a preference:
// "Configuration Is Validated at Boot, Not at First Use … calls process.exit(1) on
// failure, before the HTTP listener binds. A missing JWT_REFRESH_SECRET must kill
// the process at startup rather than surface as a 500 on the first token refresh
// hours into a deployment" (TRD §10.2).
//
// THIS IS THE ONLY MODULE IN THE APPLICATION THAT IMPORTS env.js. app.js,
// database/index.js, config/redis.js and logging.middleware.js all read
// process.env directly, and each documents the same reason: env.js calls
// process.exit(1), Vitest loads no .env, so an import anywhere in the app's graph
// would let a test suite kill its own worker. Nothing imports this file — that is
// precisely what makes it the safe home for that behaviour, and it is why the
// import sits at the top of the list instead of in alphabetical order.
//
// Step 4 last means the port stays closed while the dependencies connect, so a
// probe arriving during boot is refused rather than answered by a server that
// cannot serve a query. The Dockerfile HEALTHCHECK's `--start-period=15s` exists
// for exactly that window.
//
// ── WHAT server.close() ACTUALLY WAITS FOR ───────────────────────────────────
//
// The drain is only meaningful if its behaviour is known rather than assumed.
// Measured on this Node (v22.20.0, matching the node:22-alpine base image):
//
//   close() with nothing connected                       0ms
//   close() with an ALREADY-IDLE keep-alive socket       1ms   discarded, no wait
//   close() with a 600ms request in flight             520ms   request completes 200
//   a NEW connection after close()                   refused   ECONNREFUSED
//   a SECOND close()                       ERR_SERVER_NOT_RUNNING
//   default server.keepAliveTimeout                   5000ms
//
// Row 2 is why `closeIdleConnections()` is not needed BEFORE the drain: close()
// already discards sockets that are idle when it runs. There is one case it does
// not cover, and it is the case that matters most — a socket whose REQUEST WAS IN
// FLIGHT becomes idle only once its response is written, and then sits out the full
// keepAliveTimeout before the drain can complete. Measured against a request
// answered at 318ms:
//
//   close() alone                       drain ended at 6319ms   6s of pure idling
//   server.keepAliveTimeout = 1 first   drain ended at 1336ms
//   closeIdleConnections() SWEPT        drain ended at  319ms   1ms after the response
//
// All three still delivered the response, so the sweep shortens the drain without
// cutting anything off. That is why shutdown() below sweeps for as long as the drain
// lasts: it applies the policy close() already applies once — a keep-alive socket
// that goes quiet during shutdown is not held open waiting for a request this
// process has no intention of serving — instead of spending five idle seconds of a
// ten-second budget. Verified against the real server: 6.4s before, 3ms after.
//
// ── THE ORDER OF TEARDOWN ────────────────────────────────────────────────────
//
// The HTTP server closes FIRST, and the connection pool and Redis client only
// after it has drained. Reversing that fails every in-flight request at the moment
// its query or session read is issued — a shutdown that looks graceful in the logs
// and returns 500s to real users. src/database/index.js note 3 says the same thing
// from the other side, and names this task as the owner of the sequence.
//
// Its fallback process.once('SIGTERM'|'SIGINT') handlers must therefore go, because
// they call process.exit() as soon as the pool is closed — which, left in place,
// would exit the process mid-drain. claimShutdown() removes them (verified: the
// SIGTERM/SIGINT listener count goes 1 -> 0, and importing app.js adds no second
// pair). config/redis.js registers no handlers at all, by design.
// ─────────────────────────────────────────────────────────────────────────────

import http from 'node:http';

// First in the list on purpose — see BOOT ORDER above. Importing this module is
// what turns a bad environment into an exit(1), and `env` below is its validated,
// defaulted output rather than raw process.env.
import { env } from './config/env.js';

import app from './app.js';
import { logger } from './middlewares/logging.middleware.js';
import {
  claimShutdown,
  connectDatabase,
  disconnectDatabase,
} from './database/index.js';
import { connectRedis, disconnectRedis } from './config/redis.js';

/**
 * How long in-flight requests get to finish once the listener stops accepting.
 *
 * 10 seconds, which is task 2.8's figure. Worth knowing what it races:
 * docker-compose.yml sets no `stop_grace_period`, so `docker stop` uses Docker's
 * own 10-second default before SIGKILL. This timer and that SIGKILL therefore
 * expire at about the same instant, which makes the force-exit below a last-resort
 * tidy rather than a margin — and means raising this value alone buys nothing,
 * because the runtime kills the process first. Raise `stop_grace_period` with it.
 *
 * Idle shutdowns do not pay it: the drain measured 0-1ms with no request in
 * flight, which also keeps `node --watch` restarts (the compose dev command)
 * prompt.
 */
const DRAIN_TIMEOUT_MS = 10_000;

/**
 * Turns env.PORT into a number, or fails the boot.
 *
 * env.js declares `PORT: z.string()`, so this arrives as '3000' — and z.string()
 * accepts any string at all. Measured what http.Server#listen does with each shape,
 * because two of them fail in ways that name no port:
 *
 *   listen(3000) / listen('3000')   both bind TCP 3000 — the string is fine
 *   listen('abc') / listen('3000abc')  treated as a named PIPE, not a port:
 *                                   "EACCES: permission denied abc"
 *   listen(0)                       binds a RANDOM ephemeral port, silently — in a
 *                                   container with EXPOSE 3000 and a probe on 3000
 *                                   that is a live service marked unhealthy forever
 *   listen(NaN | -1 | 70000)        ERR_SOCKET_BAD_PORT, thrown synchronously
 *
 * So the string is coerced and range-checked here, and one clear line replaces all
 * four failures. `PORT=` (set but empty) never reaches this: env.js drops blank
 * values so the '3000' default applies instead — measured ERR_SOCKET_BAD_PORT for
 * listen(''), which that interlock is what prevents.
 */
function resolvePort(raw) {
  const port = Number(raw);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    logger.error(
      { PORT: raw },
      '[boot] PORT must be an integer TCP port between 1 and 65535',
    );
    process.exit(1);
  }

  return port;
}

const PORT = resolvePort(env.PORT);

// http.createServer(app) rather than app.listen(): identical server, but the
// reference exists before anything binds, so the shutdown path below can close a
// server that never started listening.
const server = http.createServer(app);

// Before any signal can arrive. See "THE ORDER OF TEARDOWN".
claimShutdown();

/**
 * Binds the listener, rejecting instead of crashing on a bind failure.
 *
 * server.listen() reports failures through the 'error' EVENT, so without this the
 * common local mistake — a stale process still holding the port — surfaces as an
 * unhandled 'error' event and a raw stack trace. Racing 'listening' against 'error'
 * with each listener removing the other mirrors what connectRedis() does for
 * ready-vs-end, and leaves no listener attached to fire later.
 */
function listen(port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });
}

/** Stops accepting connections and waits for in-flight requests to finish. */
function closeServer() {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      // A signal can arrive before the listener ever bound — during dependency
      // connection, or on the failed-boot path below. close() reports that as
      // ERR_SERVER_NOT_RUNNING (measured), which is the expected state here and
      // not a failure worth an exit code.
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

let shuttingDown = false;

/**
 * The one teardown sequence: drain HTTP, release both dependencies, exit.
 *
 * Reached from SIGTERM, SIGINT, a crash handler, and a failed boot. It always ends
 * in an explicit process.exit, which is not optional: registering a SIGTERM
 * listener REPLACES Node's default termination, so a handler that merely cleans up
 * leaves `docker stop` waiting for the grace period to expire and the container to
 * be SIGKILLed — the same failure as npm-as-PID-1 (src/database/index.js note 2,
 * plan:75).
 *
 * `process.on` with a flag rather than `process.once`: a second signal is logged
 * and ignored, so an orchestrator that sends SIGTERM twice cannot abort a drain
 * that is legitimately in progress. Nothing can hang as a result — DRAIN_TIMEOUT_MS
 * bounds the whole sequence.
 *
 * The two disconnects run under allSettled, not Promise.all, so a database that
 * fails to close cannot skip the Redis quit and leave its retry loop spinning;
 * both are released and both failures are reported. Each is memoized in its own
 * module, so arriving here twice is harmless.
 */
async function shutdown(reason, exitCode = 0) {
  if (shuttingDown) {
    logger.warn({ reason }, '[shutdown] already in progress — ignoring');
    return;
  }
  shuttingDown = true;

  logger.info(
    { reason, drainTimeoutMs: DRAIN_TIMEOUT_MS },
    '[shutdown] draining',
  );

  const forceExit = setTimeout(() => {
    logger.error(
      { reason },
      `[shutdown] drain exceeded ${DRAIN_TIMEOUT_MS}ms — forcing exit`,
    );
    process.exit(1);
  }, DRAIN_TIMEOUT_MS);

  // Discards keep-alive sockets as they fall idle, for as long as the drain runs.
  // close() sweeps once, at the start, which misses the socket whose response is
  // written a moment later — see "WHAT server.close() ACTUALLY WAITS FOR". 50ms is
  // fine-grained enough that the measured tail was 1ms and cheap enough to ignore:
  // it walks the open connections, and a draining server has almost none.
  const sweepIdle = setInterval(() => server.closeIdleConnections(), 50);

  let code = exitCode;

  try {
    await closeServer();

    const [database, cache] = await Promise.allSettled([
      disconnectDatabase(),
      disconnectRedis(),
    ]);

    for (const [name, result] of [
      ['database', database],
      ['redis', cache],
    ]) {
      if (result.status === 'rejected') {
        logger.error(
          { err: result.reason },
          `[shutdown] ${name} did not close cleanly`,
        );
        code = 1;
      }
    }
  } catch (error) {
    logger.error({ err: error }, '[shutdown] the HTTP server would not close');
    code = 1;
  }

  clearInterval(sweepIdle);
  clearTimeout(forceExit);
  logger.info({ code }, '[shutdown] complete');
  process.exit(code);
}

/**
 * Connects both dependencies, then binds.
 *
 * allSettled rather than Promise.all so that when BOTH are down the operator is
 * told about both at once, instead of fixing PostgreSQL and rediscovering Redis on
 * the next boot — the same reasoning the /health handler uses. Boot happens once,
 * so the wasted attempt against a doomed dependency costs nothing.
 *
 * An unreachable dependency is FATAL here, for both of them. TRD §7.1 makes Redis
 * "an AUTHENTICATION dependency, not merely a cache", so a process that cannot
 * reach it cannot authenticate anyone; connectDatabase() and connectRedis() both
 * document that they propagate errors so this caller can make exactly that
 * decision. Measured, neither hangs: a refused PostgreSQL rejects in ~2.1s and a
 * refused Redis in ~83ms. The Redis rejection also leaves its never-give-up retry
 * loop running (status 'reconnecting'), which is why a failed boot goes through
 * shutdown() rather than straight to exit — config/redis.js warns about precisely
 * that, and the compose stack gates the api on both services being healthy anyway.
 */
async function boot() {
  const [database, cache] = await Promise.allSettled([
    connectDatabase(),
    connectRedis(),
  ]);

  const failed = [
    ['database', database],
    ['redis', cache],
  ].filter(([, result]) => result.status === 'rejected');

  if (failed.length > 0) {
    for (const [name, result] of failed) {
      logger.error({ err: result.reason }, `[boot] ${name} is unreachable`);
    }
    logger.error(
      { failed: failed.map(([name]) => name) },
      '[boot] aborting before the listener binds',
    );
    await shutdown('failed boot', 1);
    return;
  }

  try {
    await listen(PORT);
  } catch (error) {
    logger.error(
      { err: error, port: PORT },
      '[boot] could not bind the listener',
    );
    await shutdown('failed boot', 1);
    return;
  }

  // server.address().port, not PORT: the bound port is the fact, the requested one
  // is the intention. env.NODE_ENV, not process.env.NODE_ENV, so an unset value
  // reads as the validated default instead of the word "undefined". No pid here —
  // pino stamps pid and hostname on every line already (verified in the output).
  logger.info(
    { port: server.address().port, env: env.NODE_ENV },
    '[boot] listening',
  );
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// plan:1021 (Cross-Cutting Concerns): "Unhandled rejections and uncaught
// exceptions trigger graceful shutdown." Both exit non-zero so an orchestrator
// restarts the process rather than treating the crash as a clean stop.
//
// For an uncaught exception this is best-effort by nature — the process is in an
// undefined state and its own teardown may not work. That is what the drain
// timeout is for: the shutdown is attempted, and bounded.
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, '[process] unhandled rejection');
  shutdown('unhandledRejection', 1);
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, '[process] uncaught exception');
  shutdown('uncaughtException', 1);
});

boot().catch((error) => {
  logger.error({ err: error }, '[boot] unexpected failure');
  shutdown('failed boot', 1);
});
