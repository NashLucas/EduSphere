// ─────────────────────────────────────────────────────────────────────────────
// Prisma Client singleton — TRD §3.4, task 1.6.
//
// One client per process, constructed on first use, with connection logging and
// a graceful disconnect on SIGTERM.
//
// THREE THINGS HERE ARE DELIBERATE AND EASY TO "TIDY" INTO BUGS:
//
// 1. NO IMPORT OF src/config/env.js. That module calls `process.exit(1)` when
//    validation fails, and Vitest does not load `.env` into `process.env` —
//    measured: under `vitest run`, NODE_ENV is 'test' and both DATABASE_URL and
//    DATABASE_URL_TEST are undefined. Importing env.js here would therefore make
//    any test that transitively touches the database layer kill its own test
//    worker. Prisma resolves DATABASE_URL itself from the `datasource` block in
//    schema.prisma, so this module never needs to read it.
//
// 2. THE SIGNAL HANDLERS CALL process.exit. Registering a SIGTERM listener
//    REPLACES Node's default behaviour of terminating, so a handler that only
//    disconnects would leave `docker stop` hanging until the runtime SIGKILLs
//    the container — the same class of failure as npm-as-PID-1 swallowing the
//    signal (Day 0 preflight row 5).
//
// 3. THE HANDLERS ARE A FALLBACK, NOT THE SHUTDOWN SEQUENCE. They exist for
//    processes whose only resource is the database. An entrypoint that also has
//    an HTTP server to drain or a Redis client to quit must call
//    `claimShutdown()` and order the teardown itself, because disconnecting the
//    pool while requests are still in flight fails those requests. Task 2.8 owns
//    that sequence, including its 10-second drain timeout.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from '@prisma/client';

// Read straight from process.env, for the reason in note 1 above. NODE_ENV and
// LOG_LEVEL are the only two settings this module has an opinion about, and both
// have safe fallbacks here: unset means "development" and "info", matching the
// defaults env.js applies on the validated path.
const NODE_ENV = process.env.NODE_ENV || 'development';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// Tests assert on output; a connection banner in the middle of a reporter's
// output is noise. Warnings and errors are never suppressed.
const quiet = NODE_ENV === 'test';

// Reused if this module somehow gets evaluated twice — mixed ESM/CJS resolution,
// or a Vitest module reset — which would otherwise mean two clients and two
// connection pools. It does nothing for `npm run dev`: `node --watch` restarts
// the whole process, so there is no surviving globalThis to hit.
const globalForPrisma = globalThis;

/**
 * Builds the client and subscribes to its log stream.
 *
 * `emit: 'event'` rather than 'stdout' so these lines go through the same
 * console the rest of the app uses, and so they can be redirected to `pino`
 * wholesale when the structured logger lands in task 2.5 — that is the only
 * change this file should need.
 */
function createClient() {
  const client = new PrismaClient({
    log: [
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'info' },
      { emit: 'event', level: 'query' },
    ],
  });

  client.$on('error', (event) => console.error('[db] error:', event.message));
  client.$on('warn', (event) => console.warn('[db] warn:', event.message));

  if (!quiet) {
    client.$on('info', (event) => console.info('[db]', event.message));
  }

  // Every statement, with timing. Gated on LOG_LEVEL rather than NODE_ENV
  // because it is far too loud for ordinary development — one line per query,
  // including Prisma's own internal reads.
  if (LOG_LEVEL === 'debug') {
    client.$on('query', (event) =>
      console.info(`[db] query (${event.duration}ms):`, event.query),
    );
  }

  return client;
}

function getClient() {
  if (!globalForPrisma.__eduspherePrisma) {
    globalForPrisma.__eduspherePrisma = createClient();
  }
  return globalForPrisma.__eduspherePrisma;
}

/**
 * The exported client.
 *
 * A Proxy so that importing this module costs nothing: the client is built on
 * the first property access, not at import. That keeps the module safe to import
 * from a unit test that never touches the database, and it means a misconfigured
 * DATABASE_URL surfaces where the query is, not at some unrelated import.
 *
 * Methods are bound to the real client. Returning them unbound would call them
 * with `this` set to the Proxy, which breaks on Prisma's private class fields.
 * Verified through delegates, $queryRaw, both $transaction forms, $on and
 * $disconnect.
 */
const prisma = new Proxy(
  {},
  {
    get(_target, property) {
      // Promise-unwrapping machinery probes `.then` on anything it is handed.
      // Answering without constructing a client keeps a stray `await prisma`
      // from opening a connection pool as a side effect.
      if (property === 'then' && !globalForPrisma.__eduspherePrisma) {
        return undefined;
      }

      const client = getClient();
      const value = client[property];
      return typeof value === 'function' ? value.bind(client) : value;
    },
  },
);

/**
 * Describes the target database without leaking the password.
 *
 * DATABASE_URL carries credentials, so it must never be logged whole. Returns
 * host and database name only, and gives up quietly rather than throwing out of
 * a logging helper if the URL is absent or unparseable.
 */
function describeTarget() {
  try {
    const url = new URL(process.env.DATABASE_URL);
    return `${url.host}${url.pathname}`;
  } catch {
    return 'configured datasource';
  }
}

/**
 * Opens the connection explicitly and reports it.
 *
 * Prisma connects lazily on first query, so this is not required for the client
 * to work — it exists so that an unreachable database fails at boot, loudly and
 * with a clear message, instead of surfacing as a 500 on the first request that
 * happens to need data. Errors propagate: the caller decides whether an
 * unreachable database is fatal.
 */
export async function connectDatabase() {
  const startedAt = process.hrtime.bigint();
  await getClient().$connect();
  const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;

  if (!quiet) {
    console.info(`[db] connected to ${describeTarget()} in ${ms.toFixed(0)}ms`);
  }

  return prisma;
}

// Memoized so concurrent or repeated calls share one disconnect. Both a signal
// handler and an explicit shutdown sequence can reach this, and $disconnect on
// an already-closed client is not something to rely on being harmless.
let disconnectPromise = null;

/**
 * Closes the connection pool. Idempotent, and safe to call when the client was
 * never used — it will not construct one just to tear it down.
 */
export function disconnectDatabase() {
  if (!disconnectPromise) {
    disconnectPromise = (async () => {
      const client = globalForPrisma.__eduspherePrisma;
      if (!client) return;

      await client.$disconnect();
      globalForPrisma.__eduspherePrisma = null;

      if (!quiet) {
        console.info('[db] disconnected');
      }
    })();
  }

  return disconnectPromise;
}

async function handleSignal(signal) {
  if (!quiet) {
    console.info(`[db] ${signal} received — closing the connection pool`);
  }

  try {
    await disconnectDatabase();
  } catch (error) {
    console.error('[db] disconnect failed during shutdown:', error);
    process.exit(1);
  }

  // See note 2 in the header: a SIGTERM listener replaces Node's default
  // termination, so this has to exit or the signal is effectively ignored.
  process.exit(0);
}

const onSigterm = () => handleSignal('SIGTERM');
const onSigint = () => handleSignal('SIGINT');

process.once('SIGTERM', onSigterm);
process.once('SIGINT', onSigint);

/**
 * Hands ownership of shutdown to the caller by removing the fallback handlers.
 *
 * An entrypoint with other resources to release — an HTTP server mid-request, a
 * Redis client — must call this and then invoke `disconnectDatabase()` at the
 * right point in its own sequence. Without it, both handlers run and the pool
 * can close underneath in-flight queries. See note 3 in the header.
 */
export function claimShutdown() {
  process.removeListener('SIGTERM', onSigterm);
  process.removeListener('SIGINT', onSigint);
}

export default prisma;
