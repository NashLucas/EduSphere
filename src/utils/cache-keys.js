// ─────────────────────────────────────────────────────────────────────────────
// Redis key namespace — TRD §7.1, task 1.7.
//
// This module owns the ENTIRE key namespace. Every other module imports its keys
// from here and no module anywhere concatenates a key literal (TRD §7.1: "All
// patterns are constructed through src/utils/cache-keys.js — never by inline
// string concatenation at call sites"). src/config/redis.js holds the client and
// nothing else.
//
// It has to land before the auth module for a structural reason, not a stylistic
// one: sessions, the requireAuth fast path and cache invalidation all read their
// key shapes from here, and retrofitting a namespace after three modules have
// hardcoded string literals is a cross-module refactor
// (IMPLEMENTATION_PLAN.md:194).
//
// ── Why the builders hash their tokens ───────────────────────────────────────
//
// emailVerify() and passwordReset() store sha256(token), never the raw token
// (§7.1). The raw token is a bearer credential: it is enough on its own to verify
// an email address or reset a password. Anyone who can read the keyspace — an
// RDB snapshot, a backup, `KEYS *` from a debug shell, a memory dump — would
// otherwise hold a working credential for every pending reset. Hashed, a leaked
// keyspace yields digests that cannot be replayed, because the lookup path hashes
// the presented token and compares digests.
//
// ── Where the helpers live ───────────────────────────────────────────────────
//
// setWithTTL, getJSON and deleteByPattern are here rather than in redis.js. The
// specification says this twice and disagrees with itself once: task 1.7 and
// IMPLEMENTATION_PLAN.md:1026 both state that "src/config/redis.js holds the
// client only", and TRD §3.4 puts the "pattern-eviction helper" in this file —
// while the same file tree one line earlier describes redis.js as "Redis client
// instance and helper methods". The narrower, twice-stated rule wins: the client
// file stays a client, and the helpers sit next to the key builders they are
// always called with. The TRD's redis.js comment is a loose description worth
// tightening; nothing behavioural depends on which file exports them.
//
// ── What this module deliberately does NOT do ────────────────────────────────
//
// Single-use enforcement for the verify/reset tokens (§7.1 marks both
// "Single-use") belongs to the auth service that consumes them, and it needs one
// atomic operation rather than a read followed by a delete: two concurrent
// requests carrying the same token both pass a GET-then-UNLINK check. Redis 6.2+
// has GETDEL for exactly this. Day 3 owns that; this module only names the key.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'crypto';
import redis from '../config/redis.js';

/**
 * Time-to-live for every key that has one, in seconds — one entry per row of the
 * §7.1 table, with the pattern each belongs to.
 *
 * These live here because a TTL is part of a key's contract, not an argument the
 * call site invents. A `user:state` key written with the wrong TTL, or with none,
 * is a correctness bug that no test looking at key *names* would catch.
 */
export const TTL = Object.freeze({
  session: 7 * 24 * 60 * 60, // session:<jti>             — 7 days
  sessionIndex: null, // session:index:<userId>    — no expiry, by design
  userState: 15 * 60, // user:state:<userId>       — 15 minutes
  emailVerify: 24 * 60 * 60, // verify:email:<sha256>     — 24 hours
  passwordReset: 15 * 60, // reset:pw:<sha256>         — 15 minutes
  courseList: 5 * 60, // cache:courses:<queryHash> — 5 minutes
  courseDetail: 10 * 60, // cache:course:<slug>       — 10 minutes
});

// `ratelimit:<scope>:<ip>` has no entry above: its window is owned by
// express-rate-limit's Redis store, which sets its own expiry (task 2.4).

// A key segment: uuids, slugs and resource names, and nothing that could break
// out of its position in the namespace.
//
// Rejecting ':' is not cosmetic. It is what stops a caller-supplied value from
// forging a different key shape — a jti of "index:<victimId>" would otherwise
// make session() emit exactly what sessionIndex() emits. Rejecting the glob
// characters keeps a stored key from being swept by a pattern that was never
// meant to match it.
const SEGMENT = /^[A-Za-z0-9._-]+$/;

// IPv6 addresses contain colons ('::1', '::ffff:127.0.0.1'), so req.ip needs a
// looser rule than SEGMENT. Glob characters are still excluded, and the address
// is always the final segment, so a colon in it cannot forge another shape.
const IP_SEGMENT = /^[0-9A-Fa-f:.]+$/;

/**
 * Validates one key segment.
 *
 * The reason this exists at all: `session(undefined)` would otherwise produce the
 * perfectly valid key "session:undefined", which every caller with a missing
 * variable then shares. One user's session record becomes every user's, and the
 * bug presents as a mysterious cross-account authentication, not as an error.
 * Failing loudly at the point of construction is the whole point.
 */
function segment(value, label, pattern = SEGMENT) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new TypeError(
      `cache-keys: ${label} must be a non-empty string matching ${pattern} — ` +
        `received ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * Hashes a single-use token. No charset validation is needed or wanted: the
 * digest is hex regardless of what went in, so an odd token cannot corrupt the
 * namespace — but an absent one must still fail loudly rather than hash the
 * string "undefined" into a key that looks legitimate.
 */
function hashToken(token, label) {
  if (typeof token !== 'string' || token.length === 0) {
    throw new TypeError(
      `cache-keys: ${label} must be a non-empty string — received ` +
        `${JSON.stringify(token)}`,
    );
  }
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Hashes a query-parameter object into a stable cache discriminator.
 *
 * Keys are sorted so that `?page=1&limit=20` and `?limit=20&page=1` produce the
 * same digest — without sorting, JSON.stringify preserves insertion order and two
 * requests for the identical listing miss each other's cache entry. undefined and
 * null are dropped so an absent optional filter hashes the same as one the client
 * never sent.
 *
 * Only top-level keys are sorted; a nested object still hashes order-dependently.
 * That is a hit-rate limitation, never a correctness one — sha256 means two
 * different parameter sets cannot collide onto one entry, so the worst case is a
 * miss that falls through to PostgreSQL. Listing queries are flat by nature
 * (page, limit, subject, search, sort), so the recursion is not worth its cost.
 */
function queryHash(params) {
  const normalized = {};
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value !== undefined && value !== null) {
      normalized[key] = value;
    }
  }
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

// ── Key builders ─────────────────────────────────────────────────────────────

/** `session:<jti>` — String, 7 days. Absence means the session was revoked. */
export function session(jti) {
  return `session:${segment(jti, 'jti')}`;
}

/**
 * `session:index:<userId>` — Set, no expiry. Every live jti for one user.
 *
 * This is what makes "revoke all sessions" O(1) instead of a keyspace sweep, and
 * it is why deleteByPattern() below refuses `session:*`: SCAN walks the entire
 * keyspace regardless of MATCH, so revoking by pattern costs a full scan per ban
 * and per password reset (§7.1).
 */
export function sessionIndex(userId) {
  return `session:index:${segment(userId, 'userId')}`;
}

/** `user:state:<userId>` — String, 15 minutes. The requireAuth fast path. */
export function userState(userId) {
  return `user:state:${segment(userId, 'userId')}`;
}

/** `verify:email:<sha256(token)>` — String, 24 hours, single-use. */
export function emailVerify(token) {
  return `verify:email:${hashToken(token, 'token')}`;
}

/** `reset:pw:<sha256(token)>` — String, 15 minutes, single-use. */
export function passwordReset(token) {
  return `reset:pw:${hashToken(token, 'token')}`;
}

/** The exact shape passwordReset() emits: the literal prefix and a hex digest. */
const PASSWORD_RESET_KEY = /^reset:pw:[0-9a-f]{64}$/;

/**
 * `reset:pw:user:<userId>` — String, 15 minutes. The reset token key currently
 * valid for one user, so that issuing a new token can delete the previous one.
 *
 * THE ONE KEY SHAPE HERE THAT §7.1's TABLE DOES NOT LIST, added for TRD:1477 —
 * "issuing a new token for the same purpose invalidates the previous one". That
 * sentence is unimplementable from the table alone: the token key is derived from
 * the token's digest, so a second issue has no way back to the first one's key
 * from the userId it holds. Either a reverse pointer exists or a superseded token
 * stays live for its full 15 minutes, which is the gap TRD:1477 closes.
 *
 * It shares TTL.passwordReset rather than owning a TTL, deliberately: a pointer
 * that outlived the token it names would send the next issue to UNLINK a key that
 * had already expired, and one that died sooner would fail to supersede a token
 * still live. The same number is the only correct one.
 *
 * Nesting under `reset:pw:` is safe rather than merely tidy — a sha256 digest is
 * 64 characters of [0-9a-f] and cannot contain a colon, so `user:<uuid>` can
 * never collide with a token key (measured), while staying inside the `reset:`
 * namespace root that assertSweepable() and NAMESPACE_ROOTS already know about.
 */
export function passwordResetPointer(userId) {
  return `reset:pw:user:${segment(userId, 'userId')}`;
}

/**
 * Whether a value read back out of Redis is a password-reset token key.
 *
 * The pointer above stores a KEY NAME, which is then handed to UNLINK — the one
 * place in this codebase where a stored value decides what gets deleted. This
 * check is what keeps that from being a primitive for deleting anything else:
 * only the shape passwordReset() itself emits is accepted, so a pointer holding
 * `session:index:<victim>` — or its own key name, which would make a reset
 * delete its own pointer — is refused rather than followed.
 */
export function isPasswordResetKey(value) {
  return typeof value === 'string' && PASSWORD_RESET_KEY.test(value);
}

/**
 * `cache:<resource>:<discriminator>` — the two catalog shapes in §7.1.
 *
 *   cache('courses', { page: 1, limit: 20 })  →  cache:courses:<queryHash>
 *   cache('course', 'intro-to-python')        →  cache:course:<slug>
 *
 * An object discriminator is hashed; a string or number is used as-is. The
 * discriminator is required: `cache:courses` with nothing after it is not one of
 * the shapes §7.1 declares, and — worse — it would not be matched by
 * `cache:courses:*`, so it would survive every invalidation sweep and serve stale
 * data forever rather than for a TTL.
 *
 * The prefix is `cache:`, never `catalog:`. The specification used both; `cache:`
 * won because §7.1 owns the namespace (Day 0 row 0.12). They are not synonyms to
 * Redis: writes under one prefix and sweeps of the other means a taken-down
 * course keeps being served while the invalidation reports success.
 */
export function cache(resource, params) {
  const name = segment(resource, 'resource');

  if (params === undefined || params === null) {
    throw new TypeError(
      `cache-keys: cache('${name}', …) requires a discriminator — a params ` +
        'object to hash, or a slug string',
    );
  }

  if (typeof params === 'object') {
    return `cache:${name}:${queryHash(params)}`;
  }

  return `cache:${name}:${segment(String(params), 'params')}`;
}

/** `ratelimit:<scope>:<ip>` — String, window owned by express-rate-limit. */
export function rateLimit(scope, ip) {
  return `ratelimit:${segment(scope, 'scope')}:${segment(ip, 'ip', IP_SEGMENT)}`;
}

/**
 * The prefix express-rate-limit's Redis store must be configured with, so that
 * its generated keys land inside this namespace instead of under its own default
 * of `rl:` (task 2.4). The store appends the request key itself.
 */
export function rateLimitPrefix(scope) {
  return `ratelimit:${segment(scope, 'scope')}:`;
}

/**
 * Every builder under one name.
 *
 * `keys.session(jti)` reads unambiguously inside an auth service that also has
 * local variables called `session`; a bare imported `session()` does not, and
 * shadowing it is a silent, confusing bug. Both import styles work — the named
 * exports above are the contract, this is the readable way to reach them.
 */
export const keys = Object.freeze({
  session,
  sessionIndex,
  userState,
  emailVerify,
  passwordReset,
  passwordResetPointer,
  cache,
  rateLimit,
  rateLimitPrefix,
});

// ── Helpers ──────────────────────────────────────────────────────────────────

// SCAN's COUNT is a hint for work per call, not a limit on keys returned. 100
// keeps each round trip short so a sweep never blocks Redis's single thread for
// long, which is the reason SCAN exists and KEYS is prohibited in a request path.
const SCAN_COUNT = 100;

// A runaway guard, not a size limit. At COUNT 100 this allows a sweep of roughly
// ten million keys before giving up, which no legitimate call will approach; it
// exists so a cursor that never returns to '0' cannot spin forever inside a
// request. It throws rather than returning, because a sweep that silently stopped
// early would report success over keys it never deleted.
const MAX_SCAN_ITERATIONS = 100_000;

// The roots of the namespace — the §7.1 table, in the order it lists them.
const NAMESPACE_ROOTS = [
  'session:',
  'user:',
  'verify:',
  'reset:',
  'cache:',
  'ratelimit:',
];

/**
 * Writes a JSON value with a mandatory TTL.
 *
 * The TTL is mandatory, and re-writing a key always re-applies it, because a bare
 * SET drops the expiry: measured — `SET k v EX 900` then a plain `SET k v2` leaves
 * TTL at -1, an immortal key. For `user:state:<id>` that means a ban that should
 * lapse in 15 minutes instead pins the account's cached state forever
 * (IMPLEMENTATION_PLAN.md:856).
 *
 * The value is stored as a JSON String, never a hash. HGETALL returns every field
 * as a string, so a boolean false comes back as the string 'false' — which is
 * truthy, and turns `if (state.isBanned)` into an unconditional ban
 * (IMPLEMENTATION_PLAN.md:364). JSON round-trips the type.
 */
export async function setWithTTL(key, value, ttlSeconds) {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new RangeError(
      'cache-keys: setWithTTL requires a positive integer TTL in seconds — ' +
        `received ${JSON.stringify(ttlSeconds)}. Keys with no expiry (the ` +
        'session index) are Sets written with SADD, not this helper.',
    );
  }

  if (value === undefined) {
    throw new TypeError(
      'cache-keys: setWithTTL cannot store undefined — JSON.stringify yields no ' +
        'string, and the literal "undefined" would be written instead',
    );
  }

  return redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
}

/**
 * Reads and parses a JSON value. Returns null when the key is absent.
 *
 * The error handling here is precise on purpose, because the two failure modes
 * must not be treated alike:
 *
 *  - A CONNECTION failure propagates. A caller making a security decision has to
 *    see it, so requireAuth can answer 503 instead of falling through; swallowing
 *    it into `null` would turn an unreachable Redis into a cache miss and admit
 *    exactly the banned users the check exists to exclude (§7.1, plan:379).
 *
 *  - A PARSE failure is reported and treated as a miss. Both policies stay safe:
 *    a miss on user:state falls through to PostgreSQL and re-derives the truth, a
 *    miss on a catalog cache falls through and serves the request. Throwing
 *    instead would make one corrupt value a poison pill that 500s every request
 *    touching that key until its TTL expires.
 */
export async function getJSON(key) {
  const raw = await redis.get(key);

  if (raw === null) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    console.warn(
      `[cache-keys] unparseable value at ${key} — treating as a miss`,
    );
    return null;
  }
}

/**
 * Asserts a pattern is safe to sweep.
 *
 * Two rules, both of which encode a rule the specification already states:
 *
 *  1. It must start inside the namespace. Without this, `deleteByPattern('*')` is
 *     one typo away from unlinking every live session, every pending password
 *     reset and the whole cache in a single call.
 *
 *  2. At least two literal segments must precede any glob. That is what refuses
 *     `session:*` — session revocation goes through the index set, never a
 *     pattern sweep (§7.1), because SCAN walks the entire keyspace no matter how
 *     narrow MATCH is, so a per-ban sweep costs a full scan every time. It still
 *     allows the documented `cache:courses:*` and `user:state:*`.
 */
function assertSweepable(pattern) {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    throw new TypeError(
      'cache-keys: deleteByPattern needs a pattern string — received ' +
        `${JSON.stringify(pattern)}`,
    );
  }

  if (!NAMESPACE_ROOTS.some((root) => pattern.startsWith(root))) {
    throw new RangeError(
      `cache-keys: refusing to sweep '${pattern}' — a pattern must begin with ` +
        `one of ${NAMESPACE_ROOTS.join(', ')}`,
    );
  }

  const literal = pattern.split(/[*?[\]]/)[0];
  const segments = literal.split(':').filter(Boolean);
  if (segments.length < 2) {
    throw new RangeError(
      `cache-keys: refusing to sweep '${pattern}' — too broad. At least two ` +
        'literal segments must precede the glob (cache:courses:*, not cache:*).',
    );
  }
}

/**
 * Deletes every key matching a pattern, with SCAN + UNLINK.
 *
 * Never DEL with a glob: DEL treats the pattern as a literal key name. Measured —
 * with two matching keys present, `DEL cache:courses:*` returns 0 and deletes
 * nothing, while reporting success to a caller that checks only for an absence of
 * errors. The stale entry then serves its full TTL after a publish that believes
 * it invalidated the cache (§7.1, TRD §5.3, plan:1026).
 *
 * Never KEYS either: it is prohibited in request-path code because it blocks
 * Redis's single thread for the length of the whole keyspace. SCAN is incremental
 * and UNLINK reclaims memory on a background thread.
 *
 * Returns the number of keys deleted, which is what an invalidation actually
 * needs to log — "evicted 0" after a publish is the signal that the write path
 * and the sweep disagree about the prefix.
 */
export async function deleteByPattern(pattern) {
  assertSweepable(pattern);

  let cursor = '0';
  let deleted = 0;
  let iterations = 0;

  do {
    const [next, batch] = await redis.scan(
      cursor,
      'MATCH',
      pattern,
      'COUNT',
      SCAN_COUNT,
    );
    cursor = next;

    if (batch.length > 0) {
      deleted += await redis.unlink(...batch);
    }

    iterations += 1;
    if (iterations > MAX_SCAN_ITERATIONS) {
      throw new Error(
        `cache-keys: deleteByPattern('${pattern}') exceeded ` +
          `${MAX_SCAN_ITERATIONS} SCAN iterations after deleting ${deleted} ` +
          'keys — aborting rather than reporting a sweep that did not finish',
      );
    }
  } while (cursor !== '0');

  return deleted;
}
