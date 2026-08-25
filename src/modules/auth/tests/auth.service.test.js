// ─────────────────────────────────────────────────────────────────────────────
// Auth service unit tests — plan:179 and plan:1032 ("service-layer unit tests
// are written in the module's tests/ folder the same day the service lands").
// Task 3.3 is the first service to land, so this is the first such file; 3.4 adds
// the login() blocks below register()'s, 3.5 the refresh() blocks below those, 3.6
// the logout() blocks below those, and 3.7 the two password-recovery blocks below
// those again.
//
// These are UNIT tests: PostgreSQL and the Redis write are mocked, so the suite
// runs with no Docker and no .env. That boundary is deliberate rather than
// convenient — plan:179 reserves cross-module integration for Day 15, and
// src/config/env.js exits the process unless DATABASE_URL_TEST and
// REDIS_URL_TEST are set under NODE_ENV=test, which nothing configures yet.
//
// What is NOT mocked matters as much as what is. `keys.emailVerify` and `TTL`
// come from the real src/utils/cache-keys.js, so the assertion that only a
// SHA-256 digest is stored exercises the real hashing rather than a stub that
// agrees with the test. bcryptjs is mocked because a real hash is ~290 ms and
// the unit-level claim is "the cost factor from TRD §7 is what gets passed",
// not "bcrypt works".
//
// jsonwebtoken is likewise REAL, and for a stronger reason than convenience.
// plan:384's deliverable is that "a refresh token presented as a Bearer token
// fails signature verification" — a property of two distinct keys that a mocked
// sign/verify pair cannot demonstrate at all, because the mock would decide the
// answer. Signing for real and then verifying under the wrong key is the actual
// claim. The two test secrets below are set on process.env rather than read from
// a file: login() resolves them at call time precisely so this works.
//
// The $transaction mock models rollback rather than merely forwarding the
// callback: rows written through `tx` are staged and DISCARDED if the callback
// throws, and it tracks whether a transaction is open so a test can assert
// WHERE a write happened rather than only what it wrote. Without the first,
// "a Redis outage creates no user" would assert against a mock that never had
// the chance to disagree; without the second, moving the token write below the
// commit stays green. Both claims were also verified against live containers
// with Redis stopped, and every assertion here was checked by mutating the
// service until it failed.
//
// Two guards in refresh() survive mutation on purpose, and the code says so where
// they are written: the `!token` check duplicates jwt.verify's own "jwt must be
// provided", and the `typeof payload.jti` check duplicates keys.session()'s
// rejection of a non-string. Both are explicitness, not behaviour, so no test here
// can distinguish their presence — which is the honest reason there isn't one.
//
// The final block is the one exception to the mocking boundary above: it stands up
// a two-line express app to assert that REFRESH_COOKIE.options can be handed to
// res.clearCookie whole. That is a claim about express rather than about this
// service, and it is pinned here because logout()'s header depends on it, because
// both ways it can break are SILENT, and because 3.9 — which will own the real
// assertion — does not exist yet.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash, randomUUID } from 'node:crypto';

import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BCRYPT_ROUNDS, TOKEN, UserRole } from '../../../config/constants.js';
import { MESSAGES } from '../../../config/system_messages.js';
import { TTL } from '../../../utils/cache-keys.js';

// Distinct, and >= 32 characters so they satisfy the same shape env.js enforces.
const ACCESS_SECRET = 'test-access-secret-at-least-32-chars-long';
const REFRESH_SECRET = 'test-refresh-secret-at-least-32-chars-long';

process.env.JWT_SECRET = ACCESS_SECRET;
process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;

// ── mocks ────────────────────────────────────────────────────────────────────

/** Rows the current transaction has written but not yet committed. */
let staged = [];
/** Rows that survived a commit — the mock's stand-in for the users table. */
let committed = [];

const create = vi.fn(async ({ data, select }) => {
  const row = {
    id: '11111111-2222-3333-4444-555555555555',
    isEmailVerified: false,
    ...data,
  };
  staged.push(row);
  // Honour `select` exactly, so a field the service forgets to exclude shows up
  // here as a real extra key rather than being invisible to the test.
  return Object.fromEntries(
    Object.keys(select).map((field) => [field, row[field]]),
  );
});

const findUnique = vi.fn(async () => null);

// 3.7. Rejects by default with the error a live PostgreSQL raises for an id that
// is not there — measured: P2025, not a null return — so a resetPassword test has
// to arm the account it claims to be updating.
const update = vi.fn(async () => {
  const err = new Error(
    'An operation failed because it depends on one or more records that were required but not found.',
  );
  err.code = 'P2025';
  throw err;
});

/**
 * How many transactions are open right now — 1 while the callback is running.
 *
 * This is what lets a test distinguish "written inside the transaction" from
 * "written after the commit", which is otherwise invisible on the happy path.
 */
let txDepth = 0;

const prismaMock = {
  user: { findUnique, create, update },
  async $transaction(callback) {
    staged = [];
    txDepth += 1;
    try {
      const result = await callback({ user: { create } });
      committed.push(...staged);
      return result;
    } finally {
      txDepth -= 1;
      staged = [];
    }
  },
};

vi.mock('../../../database/index.js', () => ({ default: prismaMock }));

// The fake hash is DERIVED from the password rather than built by interpolating
// it, so that "the plaintext never reaches the insert" is a real assertion. A
// stub like `hash-of-${pw}` would embed the password and fail that check on the
// mock's own output while the production path was perfectly correct.
//
// `compare` inverts exactly that derivation, which is what makes it useful rather
// than circular: it recomputes the digest and rebuilds the string, so it is TRUE
// only for a hash this mock itself produced at the same cost. login()'s decoy is
// a real bcrypt hash, so it correctly compares FALSE against every password —
// the mock cannot accidentally admit the no-such-user path.
vi.mock('bcryptjs', async () => {
  const { createHash } = await import('node:crypto');
  const body = (pw) =>
    createHash('sha256').update(String(pw)).digest('base64url').slice(0, 31);
  return {
    default: {
      hash: vi.fn(async (pw, rounds) => `$2a$${rounds}$${body(pw)}`),
      compare: vi.fn(async (pw, hash) => {
        const rounds = String(hash).split('$')[2];
        return String(hash) === `$2a$${rounds}$${body(pw)}`;
      }),
    },
  };
});

// SADD, GET, GETDEL, UNLINK, SREM, EXISTS and SMEMBERS are the Redis commands
// this module issues directly; everything else goes through cache-keys.js, whose
// setWithTTL is mocked below. Importing the real client would be harmless
// (lazyConnect opens no socket) but would leave the index write, the rotation
// gate, the logout revocation, 3.7's reset sweep and 3.8's verify read
// unobservable.
//
// `get`, `getdel`, `unlink`, `exists` and `smembers` all default to the ABSENT
// answer — null, null, 0, 0 and [] — so a test that forgets to arm a live session
// or a live verification token fails as an unauthenticated or invalid one, or
// reports `revoked: false`, rather than passing on a mock's convenient truthiness.
//
// `get` is separate from `getdel` rather than aliased to it, and that separation is
// load-bearing: verifyEmail() is the one path that reads its token WITHOUT
// consuming it, so a shared mock would make the GET-then-UNLINK asymmetry the
// service is built around impossible to observe here.
vi.mock('../../../config/redis.js', () => {
  const client = {
    sadd: vi.fn(async () => 1),
    get: vi.fn(async () => null),
    getdel: vi.fn(async () => null),
    unlink: vi.fn(async () => 0),
    srem: vi.fn(async () => 1),
    exists: vi.fn(async () => 0),
    smembers: vi.fn(async () => []),
  };
  return { redis: client, default: client };
});

vi.mock('../../../utils/cache-keys.js', async (importOriginal) => ({
  ...(await importOriginal()),
  setWithTTL: vi.fn(async () => 'OK'),
}));

vi.mock('../../../integrations/email/index.js', () => ({
  sendVerificationEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));

vi.mock('../../../middlewares/logging.middleware.js', () => {
  const child = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  return { logger: { child: () => child, ...child } };
});

const bcrypt = (await import('bcryptjs')).default;
const { redis } = await import('../../../config/redis.js');
const { setWithTTL } = await import('../../../utils/cache-keys.js');
const { sendVerificationEmail, sendPasswordResetEmail } =
  await import('../../../integrations/email/index.js');
const { logger } = await import('../../../middlewares/logging.middleware.js');
const {
  register,
  generateToken,
  login,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  verifyEmail,
  REFRESH_COOKIE,
} = await import('../auth.service.js');

const VALID = Object.freeze({
  fullName: 'Ada Lovelace',
  email: 'ada@example.com',
  password: 'SecurePassword123',
});

/** The order the three session writes happened in, for the ordering assertion. */
let writeOrder = [];

beforeEach(() => {
  vi.clearAllMocks();
  staged = [];
  committed = [];
  txDepth = 0;
  writeOrder = [];
  findUnique.mockResolvedValue(null);
  process.env.JWT_SECRET = ACCESS_SECRET;
  process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;

  redis.sadd.mockImplementation(async (key) => {
    writeOrder.push(key);
    return 1;
  });
  setWithTTL.mockImplementation(async (key) => {
    writeOrder.push(key);
    return 'OK';
  });
  // Labelled, because SREM and SADD name the SAME key — an unlabelled push would
  // make the index appear twice in writeOrder with no way to tell which was
  // which. login() issues no SREM, so its writeOrder assertions are unaffected.
  redis.srem.mockImplementation(async (key) => {
    writeOrder.push(`SREM ${key}`);
    return 1;
  });
  // Labelled for the same reason, and defaulting to 0 — nothing removed — so a
  // logout test has to say so explicitly to claim a session was revoked.
  //
  // Variadic since 3.7: resetPassword UNLINKs every session key in one command,
  // and a single-parameter mock would record the first and silently drop the rest,
  // which is exactly the bug the ordering assertions exist to catch.
  redis.unlink.mockImplementation(async (...args) => {
    writeOrder.push(`UNLINK ${args.join(' ')}`);
    return 0;
  });
  // Absent by default: a refresh test that forgets to arm a session fails as an
  // unauthenticated one rather than passing on a mock's convenient truthiness.
  redis.getdel.mockResolvedValue(null);
  // 3.8, and absent for the same reason: a verifyEmail test that forgets to arm
  // the token fails as an unknown one. Reset here as well as in the factory
  // because a verify test that overrides it with mockResolvedValue would otherwise
  // leak that value into every later test in the file.
  redis.get.mockResolvedValue(null);
  // 3.7. Empty index, absent key — the answers a live Redis gives for an account
  // that never logged in (measured: SMEMBERS on a missing key returns a real []).
  redis.smembers.mockResolvedValue([]);
  redis.exists.mockResolvedValue(0);
  update.mockImplementation(async () => {
    const err = new Error('Record to update not found.');
    err.code = 'P2025';
    throw err;
  });
});

// ── generateToken ────────────────────────────────────────────────────────────

describe('generateToken', () => {
  it('produces TOKEN.LENGTH lowercase hex characters', () => {
    const token = generateToken();
    expect(token).toMatch(new RegExp(`^[0-9a-f]{${TOKEN.LENGTH}}$`));
  });

  it('does not repeat across 500 draws', () => {
    // Not a randomness test — a guard against someone swapping randomBytes for
    // a timestamp or a counter, which would still be 64 hex characters.
    const draws = new Set(Array.from({ length: 500 }, generateToken));
    expect(draws.size).toBe(500);
  });
});

// ── the happy path ───────────────────────────────────────────────────────────

describe('register — the created account', () => {
  it('returns exactly apidoc §8.2 data.user, with no passwordHash', async () => {
    const user = await register({ ...VALID });

    expect(Object.keys(user).sort()).toEqual([
      'email',
      'fullName',
      'id',
      'isEmailVerified',
      'role',
    ]);
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('never asks the database for passwordHash at all', async () => {
    // Stronger than deleting the field afterwards: a value that was never
    // fetched cannot leak from an object nobody remembered to strip.
    await register({ ...VALID });
    expect(create.mock.calls[0][0].select.passwordHash).toBeUndefined();
  });

  it('lowercases and trims the email everywhere it is used', async () => {
    await register({ ...VALID, email: '  ADA@Example.COM  ' });

    // Both call sites, because `email @unique` is case-sensitive in PostgreSQL:
    // normalising only the lookup would let a second row be created, and
    // normalising only the insert would make the pre-check miss it.
    expect(findUnique.mock.calls[0][0].where.email).toBe('ada@example.com');
    expect(create.mock.calls[0][0].data.email).toBe('ada@example.com');
  });

  it('defaults an omitted role to STUDENT', async () => {
    const user = await register({ ...VALID });
    expect(user.role).toBe(UserRole.STUDENT);
    expect(create.mock.calls[0][0].data.role).toBe(UserRole.STUDENT);
  });

  it('hashes with the TRD §7 cost factor', async () => {
    await register({ ...VALID });
    expect(bcrypt.hash).toHaveBeenCalledWith(VALID.password, BCRYPT_ROUNDS);
    expect(BCRYPT_ROUNDS).toBe(12);
  });

  it('stores the hash and not the password', async () => {
    await register({ ...VALID });
    const { data } = create.mock.calls[0][0];
    expect(data.passwordHash).toBe(await bcrypt.hash(VALID.password, 12));
    expect(JSON.stringify(data)).not.toContain(VALID.password);
  });
});

// ── the verification token (TRD:1474) ────────────────────────────────────────

describe('register — the verification token', () => {
  it('stores only the SHA-256 digest, keyed to the new user, for 24h', async () => {
    const user = await register({ ...VALID });

    expect(setWithTTL).toHaveBeenCalledTimes(1);
    const [key, value, ttl] = setWithTTL.mock.calls[0];

    expect(key).toMatch(/^verify:email:[0-9a-f]{64}$/);
    expect(value).toBe(user.id);
    expect(ttl).toBe(TTL.emailVerify);
    expect(ttl).toBe(86400);
  });

  it('emails the RAW token while persisting only its digest', async () => {
    // The whole invariant in one assertion: whatever went into the email must
    // hash to the key that was stored, and must not BE the key that was stored.
    await register({ ...VALID });

    const { token } = sendVerificationEmail.mock.calls[0][0];
    const [key] = setWithTTL.mock.calls[0];
    const digest = createHash('sha256').update(token, 'utf8').digest('hex');

    expect(token).toMatch(new RegExp(`^[0-9a-f]{${TOKEN.LENGTH}}$`));
    expect(key).toBe(`verify:email:${digest}`);
    expect(key).not.toContain(token);
  });

  it('writes the token INSIDE the transaction, not after the commit', async () => {
    // What this pins is PLACEMENT, and placement is nearly invisible on the
    // happy path — which is why it is asserted through the open transaction
    // rather than through the value written.
    //
    // `value === committed[0].id` does NOT pin it: after a successful commit
    // the returned user carries the same id, so that assertion passes whether
    // the write sits inside the callback or below it. Confirmed by mutation —
    // moving the write after the commit left that assertion green and only the
    // rollback test red.
    //
    // The placement is the whole design: if the write moves out, a Redis
    // failure stops rolling the user back and the account is permanently
    // unverifiable, because there is no resend-verification endpoint.
    let depthAtWrite = null;
    setWithTTL.mockImplementationOnce(async () => {
      depthAtWrite = txDepth;
      return 'OK';
    });

    const user = await register({ ...VALID });

    expect(depthAtWrite).toBe(1);
    expect(setWithTTL.mock.calls[0][1]).toBe(user.id);
  });

  it('dispatches the email after the commit, exactly once', async () => {
    await register({ ...VALID });
    expect(committed).toHaveLength(1);
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(sendVerificationEmail.mock.calls[0][0]).toMatchObject({
      to: VALID.email,
      fullName: VALID.fullName,
    });
  });
});

// ── conflicts ────────────────────────────────────────────────────────────────

describe('register — a taken address', () => {
  it('throws a GENERIC 409 that does not name the email (TRD:1480)', async () => {
    findUnique.mockResolvedValue({ id: 'someone-else' });

    const err = await register({ ...VALID }).catch((e) => e);

    expect(err.statusCode).toBe(409);
    expect(err.isOperational).toBe(true);
    expect(err.message).toBe(MESSAGES.COMMON.CONFLICT);
    expect(err.message).not.toMatch(/email|regist/i);
  });

  it('skips bcrypt and writes nothing', async () => {
    findUnique.mockResolvedValue({ id: 'someone-else' });

    await register({ ...VALID }).catch(() => {});

    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(setWithTTL).not.toHaveBeenCalled();
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('converts the unique-index violation to the same 409', async () => {
    // The pre-check is racy by construction: two concurrent registrations of
    // one address both pass it. This catch is the actual guarantee, so it must
    // be indistinguishable from the pre-check's answer.
    create.mockRejectedValueOnce(
      Object.assign(new Error('unique'), {
        code: 'P2002',
      }),
    );

    const err = await register({ ...VALID }).catch((e) => e);

    expect(err.statusCode).toBe(409);
    expect(err.message).toBe(MESSAGES.COMMON.CONFLICT);
    expect(committed).toHaveLength(0);
  });
});

// ── a Redis outage ───────────────────────────────────────────────────────────

describe('register — when the token cannot be stored', () => {
  beforeEach(() => {
    setWithTTL.mockRejectedValue(new Error('ECONNREFUSED'));
  });

  it('answers 503, not 500', async () => {
    const err = await register({ ...VALID }).catch((e) => e);

    expect(err.statusCode).toBe(503);
    expect(err.isOperational).toBe(true);
    expect(err.message).toBe(MESSAGES.COMMON.SERVICE_UNAVAILABLE);
  });

  it('ROLLS THE USER BACK rather than committing an unverifiable account', async () => {
    await register({ ...VALID }).catch(() => {});
    expect(committed).toHaveLength(0);
  });

  it('sends no verification email for an account that does not exist', async () => {
    await register({ ...VALID }).catch(() => {});
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('logs the underlying cause, which the 503 cannot carry', async () => {
    await register({ ...VALID }).catch(() => {});

    expect(logger.child().error).toHaveBeenCalledTimes(1);
    const [context] = logger.child().error.mock.calls[0];
    expect(context.err).toBeInstanceOf(Error);
    expect(context.userId).toBeDefined();
  });
});

// ── the role allow-list ──────────────────────────────────────────────────────

describe('register — privileged roles', () => {
  it('refuses ADMIN and writes nothing', async () => {
    const err = await register({ ...VALID, role: UserRole.ADMIN }).catch(
      (e) => e,
    );

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/ADMIN/);
    expect(create).not.toHaveBeenCalled();
    expect(bcrypt.hash).not.toHaveBeenCalled();
  });

  it('refuses ADMIN as a NON-operational error, so the message is withheld', async () => {
    // No client can reach this — registerSchema enumerates STUDENT and
    // INSTRUCTOR — so it is a bug in a call site, and the handler's generic 500
    // plus the logged detail is the correct pair of answers.
    const err = await register({ ...VALID, role: UserRole.ADMIN }).catch(
      (e) => e,
    );
    expect(err.isOperational).toBeUndefined();
    expect(err.statusCode).toBeUndefined();
  });

  it('rejects an unrecognised role rather than trusting it', async () => {
    // The guard is an allow-list, not `role !== 'ADMIN'` (plan:342), so a role
    // added to the enum later is refused until someone opts it in.
    const err = await register({ ...VALID, role: 'SUPERUSER' }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(create).not.toHaveBeenCalled();
  });

  it('allows INSTRUCTOR', async () => {
    const user = await register({ ...VALID, role: UserRole.INSTRUCTOR });
    expect(user.role).toBe(UserRole.INSTRUCTOR);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// login() — task 3.4
// ═════════════════════════════════════════════════════════════════════════════

const CREDS = Object.freeze({
  email: 'ada@example.com',
  password: 'SecurePassword123',
});

// Produced by the mock above, so `compare` recognises it. Hashed once at module
// load, before any test, so it does not show up in a call count.
const STORED_HASH = await bcrypt.hash(CREDS.password, BCRYPT_ROUNDS);

/** A healthy account, shaped as LOGIN_USER_FIELDS selects it. */
const ACCOUNT = Object.freeze({
  id: '11111111-2222-3333-4444-555555555555',
  fullName: 'Ada Lovelace',
  email: 'ada@example.com',
  role: UserRole.STUDENT,
  isEmailVerified: false,
  passwordHash: STORED_HASH,
  isBanned: false,
  deletedAt: null,
});

function givenAccount(overrides = {}) {
  findUnique.mockResolvedValue({ ...ACCOUNT, ...overrides });
}

// ── bad credentials ──────────────────────────────────────────────────────────

describe('login — bad credentials', () => {
  it('answers 401 for an address with no account', async () => {
    const err = await login({ ...CREDS }).catch((e) => e);

    expect(err.statusCode).toBe(401);
    expect(err.isOperational).toBe(true);
    expect(err.message).toBe(MESSAGES.AUTH.INVALID_CREDENTIALS);
  });

  it('answers a BYTE-IDENTICAL 401 for a wrong password', async () => {
    // The whole point of the shared constant. Two different failures that
    // produce two different strings are an account oracle in slow motion.
    const unknown = await login({ ...CREDS }).catch((e) => e);

    givenAccount();
    const wrongPassword = await login({
      ...CREDS,
      password: 'WrongPassword123',
    }).catch((e) => e);

    expect(unknown.statusCode).toBe(wrongPassword.statusCode);
    expect(unknown.message).toBe(wrongPassword.message);
  });

  it('still runs a FULL-COST comparison when no user matched', async () => {
    // The timing half of the same guarantee, and the one an implementation
    // loses for free by returning early on `!user`. Measured on real bcrypt:
    // no comparison is ~0.0 ms against 373 ms for a real one, a gap legible in
    // a single request. This is that early return, pinned.
    await login({ ...CREDS }).catch(() => {});

    expect(bcrypt.compare).toHaveBeenCalledTimes(1);
    const [submitted, against] = bcrypt.compare.mock.calls[0];

    expect(submitted).toBe(CREDS.password);
    // A genuine bcrypt hash at the SAME cost as a stored one: $2a$12$ then 53
    // characters of bcrypt's base64 alphabet. A cheaper decoy, or a made-up
    // string, reopens the gap while looking like it closed it.
    expect(against).toMatch(/^\$2a\$12\$[./A-Za-z0-9]{53}$/);
    expect(against).toHaveLength(60);
    expect(against).not.toBe(STORED_HASH);
  });

  it('opens no session for either failure', async () => {
    await login({ ...CREDS }).catch(() => {});
    givenAccount();
    await login({ ...CREDS, password: 'WrongPassword123' }).catch(() => {});

    expect(redis.sadd).not.toHaveBeenCalled();
    expect(setWithTTL).not.toHaveBeenCalled();
  });
});

// ── a denied account (apidoc §8.2's 403) ─────────────────────────────────────

describe('login — a denied account', () => {
  it('answers 403 rather than 401 for a banned account', async () => {
    // apidoc §8.2: "the caller proved identity; the account is denied".
    givenAccount({ isBanned: true });

    const err = await login({ ...CREDS }).catch((e) => e);

    expect(err.statusCode).toBe(403);
    expect(err.isOperational).toBe(true);
    expect(err.message).toBe(MESSAGES.AUTH.ACCOUNT_DISABLED);
  });

  it('answers the same 403 for a soft-deleted account', async () => {
    // Normally unreachable — TRD:1497 rewrites the address on deletion, so the
    // lookup misses and the answer is the 401. This is the check that catches a
    // deletion path which forgot the rewrite.
    givenAccount({ deletedAt: new Date('2026-01-01T00:00:00.000Z') });

    const err = await login({ ...CREDS }).catch((e) => e);

    expect(err.statusCode).toBe(403);
    expect(err.message).toBe(MESSAGES.AUTH.ACCOUNT_DISABLED);
  });

  it('checks the PASSWORD first, so no stranger can discover a ban', async () => {
    // plan:345's ordering, and the reason it is an ordering. Hoisting the ban
    // check above the comparison would answer 403 to anyone who merely guessed
    // the address — telling them both that the account exists and that it is
    // banned, from a form that is supposed to reveal neither.
    givenAccount({ isBanned: true });

    const err = await login({
      ...CREDS,
      password: 'WrongPassword123',
    }).catch((e) => e);

    expect(err.statusCode).toBe(401);
    expect(err.message).toBe(MESSAGES.AUTH.INVALID_CREDENTIALS);
  });

  it('opens no session', async () => {
    givenAccount({ isBanned: true });

    await login({ ...CREDS }).catch(() => {});

    expect(redis.sadd).not.toHaveBeenCalled();
    expect(setWithTTL).not.toHaveBeenCalled();
  });

  it('ADMITS an unverified account (TRD:1482)', async () => {
    // Not an oversight and not a TODO: "an unverified user may log in and
    // browse". The refusal belongs to requireVerifiedEmail on three routes
    // (task 3.11). Adding an isEmailVerified check here would lock every new
    // account out of the platform between registering and clicking the link.
    givenAccount({ isEmailVerified: false });

    const { user, accessToken } = await login({ ...CREDS });

    expect(user.isEmailVerified).toBe(false);
    expect(accessToken).toBeTypeOf('string');
  });
});

// ── the token pair (TRD:1669, plan:384) ──────────────────────────────────────

describe('login — the token pair', () => {
  beforeEach(() => {
    givenAccount();
  });

  it('signs the two classes with DIFFERENT keys', async () => {
    const { accessToken, refreshToken } = await login({ ...CREDS });

    expect(jwt.verify(accessToken, ACCESS_SECRET)).toBeTruthy();
    expect(jwt.verify(refreshToken, REFRESH_SECRET)).toBeTruthy();

    // plan:384's deliverable, stated as the failure it must be: a refresh token
    // presented in the Authorization header fails signature verification. This
    // is why jsonwebtoken is not mocked — a stub would just agree.
    expect(() => jwt.verify(refreshToken, ACCESS_SECRET)).toThrow(
      /invalid signature/,
    );
    expect(() => jwt.verify(accessToken, REFRESH_SECRET)).toThrow(
      /invalid signature/,
    );
  });

  it('carries everything req.user needs, so 3.10 queries nothing', async () => {
    const claims = jwt.verify(
      (await login({ ...CREDS })).accessToken,
      ACCESS_SECRET,
    );

    expect(claims.sub).toBe(ACCOUNT.id);
    expect(claims.email).toBe(ACCOUNT.email);
    expect(claims.role).toBe(UserRole.STUDENT);
    expect(claims.type).toBe('access');
  });

  it('keeps the refresh payload minimal — nothing that can go stale', async () => {
    // 7 days is long enough for a role change or an email change to land, and a
    // stale claim that outlives the truth is how a demoted instructor keeps
    // authoring. 3.5 re-reads both from the session record instead.
    const claims = jwt.verify(
      (await login({ ...CREDS })).refreshToken,
      REFRESH_SECRET,
    );

    expect(Object.keys(claims).sort()).toEqual([
      'exp',
      'iat',
      'jti',
      'sub',
      'type',
    ]);
    expect(claims.type).toBe('refresh');
  });

  it('uses the TRD §7 lifetimes — 15 minutes and 7 days', async () => {
    const { accessToken, refreshToken } = await login({ ...CREDS });
    const access = jwt.verify(accessToken, ACCESS_SECRET);
    const refresh = jwt.verify(refreshToken, REFRESH_SECRET);

    expect(access.exp - access.iat).toBe(15 * 60);
    expect(refresh.exp - refresh.iat).toBe(7 * 24 * 60 * 60);
    // And the refresh lifetime matches the session key that actually bounds it
    // — a longer JWT would stay signed while session:<jti> expired under it.
    expect(refresh.exp - refresh.iat).toBe(TTL.session);
  });

  it('gives each token its OWN jti (plan:345)', async () => {
    const { accessToken, refreshToken } = await login({ ...CREDS });
    const access = jwt.verify(accessToken, ACCESS_SECRET);
    const refresh = jwt.verify(refreshToken, REFRESH_SECRET);

    expect(access.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(refresh.jti).toMatch(/^[0-9a-f-]{36}$/);
    // Shared jtis would make a leaked access token name the session key that
    // lets its holder mint replacements.
    expect(access.jti).not.toBe(refresh.jti);
  });

  it('refuses to sign when a secret is absent', async () => {
    delete process.env.JWT_REFRESH_SECRET;

    const err = await login({ ...CREDS }).catch((e) => e);

    expect(err.message).toMatch(/JWT_REFRESH_SECRET/);
    // Non-operational, like register()'s role guard: no client can cause it, so
    // the handler's generic 500 plus the logged detail is the right answer.
    expect(err.statusCode).toBeUndefined();
    expect(redis.sadd).not.toHaveBeenCalled();
  });

  it('refuses to sign when the two secrets are the SAME', async () => {
    // env.js rejects this at boot, but env.js is not in this module's import
    // graph, so it cannot be assumed to have run. One key for both classes
    // means a refresh token verifies as an access token.
    process.env.JWT_REFRESH_SECRET = ACCESS_SECRET;

    const err = await login({ ...CREDS }).catch((e) => e);

    expect(err.message).toMatch(/identical/);
    expect(err.statusCode).toBeUndefined();
    expect(redis.sadd).not.toHaveBeenCalled();
  });
});

// ── the session records (plan:354-361) ───────────────────────────────────────

describe('login — the session records', () => {
  beforeEach(() => {
    givenAccount();
  });

  it('keys the session on the REFRESH jti, never the access one', async () => {
    const { accessToken, refreshToken } = await login({ ...CREDS });
    const access = jwt.verify(accessToken, ACCESS_SECRET);
    const refresh = jwt.verify(refreshToken, REFRESH_SECRET);

    // TRD §7.1 calls session:<jti> the "active refresh-token record", and 3.5
    // looks it up using the jti out of the cookie's token. Keying it on the
    // access jti looks identical here and makes every refresh fail.
    const [sessionKey] = setWithTTL.mock.calls[0];

    expect(sessionKey).toBe(`session:${refresh.jti}`);
    expect(sessionKey).not.toContain(access.jti);
  });

  it('SADDs that same jti into the per-user index', async () => {
    const { refreshToken } = await login({ ...CREDS });
    const { jti } = jwt.verify(refreshToken, REFRESH_SECRET);

    // SADD rather than setWithTTL: TTL.sessionIndex is null by design, and that
    // helper throws a RangeError saying exactly this.
    expect(redis.sadd).toHaveBeenCalledWith(`session:index:${ACCOUNT.id}`, jti);
    expect(TTL.sessionIndex).toBeNull();
  });

  it('INDEXES BEFORE it writes the session it indexes', async () => {
    // Ordering is the security property here (plan:367, plan:373). A session
    // key absent from the index is one that "revoke all sessions" walks past,
    // so it stays refreshable for its full 7 days through the ban that was
    // supposed to kill it. The opposite partial failure leaves a dead index
    // member, which plan:367 and TRD:1723 both declare inert. Swapping the two
    // lines is invisible on the happy path, which is why this exists.
    await login({ ...CREDS });

    expect(writeOrder).toHaveLength(3);
    expect(writeOrder[0]).toBe(`session:index:${ACCOUNT.id}`);
    expect(writeOrder[1]).toMatch(/^session:[0-9a-f-]{36}$/);
    expect(writeOrder[2]).toBe(`user:state:${ACCOUNT.id}`);
  });

  it('writes plan:356 shape at TTL.session', async () => {
    await login({ ...CREDS }, { ip: '203.0.113.7', userAgent: 'curl/8.5.0' });
    const [, record, ttl] = setWithTTL.mock.calls[0];

    expect(record).toEqual({
      userId: ACCOUNT.id,
      role: UserRole.STUDENT,
      issuedAt: expect.any(String),
      ip: '203.0.113.7',
      userAgent: 'curl/8.5.0',
    });
    // Round-trips, so 3.5 and Day 13's session listing can parse it.
    expect(new Date(record.issuedAt).toISOString()).toBe(record.issuedAt);
    expect(ttl).toBe(TTL.session);
    expect(ttl).toBe(604800);
  });

  it('stores absent provenance as null, so the shape never varies', async () => {
    // JSON.stringify DROPS undefined-valued keys, so `ip: undefined` would
    // write a record with no `ip` field at all — and a reader would see a
    // different shape depending on whether a proxy happened to set a header.
    await login({ ...CREDS });
    const [, record] = setWithTTL.mock.calls[0];

    expect(record.ip).toBeNull();
    expect(record.userAgent).toBeNull();
    expect(JSON.parse(JSON.stringify(record))).toHaveProperty('ip', null);
  });

  it('writes plan:358 user:state at TTL.userState with REAL booleans', async () => {
    await login({ ...CREDS });
    const [key, record, ttl] = setWithTTL.mock.calls[1];

    expect(key).toBe(`user:state:${ACCOUNT.id}`);
    expect(record).toEqual({
      role: UserRole.STUDENT,
      isBanned: false,
      isEmailVerified: false,
      deletedAt: null,
    });
    // plan:364: a Redis hash returns `false` as the STRING 'false', which is
    // truthy, so `if (state.isBanned)` on hash output rejects every user alive.
    // toBe rather than toBeFalsy pins the type, which is the whole point.
    expect(record.isBanned).toBe(false);
    expect(record.isEmailVerified).toBe(false);
    expect(record.deletedAt).toBeNull();
    expect(ttl).toBe(TTL.userState);
    expect(ttl).toBe(900);
  });

  it('ties the user:state TTL to the access-token lifetime (plan:370)', async () => {
    const { accessToken } = await login({ ...CREDS });
    const access = jwt.verify(accessToken, ACCESS_SECRET);
    const [, , ttl] = setWithTTL.mock.calls[1];

    // Not a coincidence for someone to tidy up later: this TTL is what bounds
    // how long a banned user keeps working, and plan:388 requires that bound be
    // one user:state TTL rather than one access-token TTL.
    expect(ttl).toBe(access.exp - access.iat);
  });
});

// ── a Redis outage on the session write ──────────────────────────────────────

describe('login — when the session cannot be recorded', () => {
  beforeEach(() => {
    givenAccount();
  });

  it('answers 503 and issues NO tokens', async () => {
    // Handing back the pair anyway would give the client a working 15-minute
    // access token whose refresh path is already dead, so the outage surfaces
    // 15 minutes later as an unexplained logout. 3.5 makes the same choice.
    setWithTTL.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await login({ ...CREDS }).catch((e) => e);

    expect(result).toBeInstanceOf(Error);
    expect(result.statusCode).toBe(503);
    expect(result.isOperational).toBe(true);
    expect(result.message).toBe(MESSAGES.COMMON.SERVICE_UNAVAILABLE);
    expect(result.accessToken).toBeUndefined();
  });

  it('fails closed when the INDEX write is the one that fails', async () => {
    redis.sadd.mockRejectedValue(new Error('ECONNREFUSED'));

    const err = await login({ ...CREDS }).catch((e) => e);

    expect(err.statusCode).toBe(503);
    expect(setWithTTL).not.toHaveBeenCalled();
  });

  it('logs the cause the 503 cannot carry', async () => {
    setWithTTL.mockRejectedValue(new Error('ECONNREFUSED'));

    await login({ ...CREDS }).catch(() => {});

    expect(logger.child().error).toHaveBeenCalledTimes(1);
    const [context] = logger.child().error.mock.calls[0];
    expect(context.err).toBeInstanceOf(Error);
    expect(context.userId).toBe(ACCOUNT.id);
  });
});

// ── what comes back ──────────────────────────────────────────────────────────

describe('login — the returned user', () => {
  beforeEach(() => {
    givenAccount();
  });

  it('returns exactly apidoc §8.2 data.user, and none of the three private columns', async () => {
    const { user } = await login({ ...CREDS });

    expect(Object.keys(user).sort()).toEqual([
      'email',
      'fullName',
      'id',
      'isEmailVerified',
      'role',
    ]);
    expect(user).not.toHaveProperty('passwordHash');
    expect(user).not.toHaveProperty('isBanned');
    expect(user).not.toHaveProperty('deletedAt');
    expect(JSON.stringify(user)).not.toContain(STORED_HASH);
  });

  it('lowercases and trims the email before the lookup', async () => {
    // `email @unique` is case-sensitive in PostgreSQL, so without this a
    // correct password typed with a capitalised address answers 401.
    await login({ ...CREDS, email: '  ADA@Example.COM  ' });

    expect(findUnique.mock.calls[0][0].where.email).toBe('ada@example.com');
  });

  it('selects passwordHash — the one place this module must', async () => {
    // Not tautology: `row?.passwordHash ?? DECOY_HASH` means a select that
    // drops this column compares every password against the decoy and locks
    // every account out with a 401, silently. toPublicUser() is what stops the
    // value travelling any further, asserted above.
    await login({ ...CREDS });

    expect(findUnique.mock.calls[0][0].select.passwordHash).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// refresh() — task 3.5
// ═════════════════════════════════════════════════════════════════════════════
//
// The one thing to know before reading these: `redis.getdel` is the whole
// authorization gate, and its default is null. So "arming a session" means
// telling the mock a value came back, and the rejection tests mostly need to arm
// nothing at all.
//
// The record the mock returns is realistic but deliberately never trusted by the
// service — which is itself asserted below, by arming a record whose `role`
// disagrees with the database and checking which one reaches the token.

/** ACCOUNT as ACCOUNT_FIELDS selects it: no passwordHash, refresh needs none. */
const ACCOUNT_ROW = Object.freeze({
  id: ACCOUNT.id,
  fullName: ACCOUNT.fullName,
  email: ACCOUNT.email,
  role: ACCOUNT.role,
  isEmailVerified: ACCOUNT.isEmailVerified,
  isBanned: ACCOUNT.isBanned,
  deletedAt: ACCOUNT.deletedAt,
});

const INDEX_KEY = `session:index:${ACCOUNT.id}`;

/** A refresh token signed the way login() signs one. */
function signRefresh({ sub = ACCOUNT.id, jti = randomUUID(), ...rest } = {}) {
  return jwt.sign({ sub, type: 'refresh', ...rest }, REFRESH_SECRET, {
    expiresIn: '7d',
    jwtid: jti,
  });
}

/**
 * Arms a live session: a valid cookie, a value for GETDEL to return, and a row
 * for the re-read. `record` overrides what Redis holds, `row` what Postgres does
 * — the two are separate arguments precisely so a test can make them disagree.
 */
function givenSession({ record, row = ACCOUNT_ROW, jti = randomUUID() } = {}) {
  const token = signRefresh({ sub: row.id, jti });
  redis.getdel.mockResolvedValue(
    JSON.stringify({
      userId: row.id,
      role: row.role,
      issuedAt: '2026-08-01T00:00:00.000Z',
      ip: '198.51.100.9',
      userAgent: 'old-agent/1.0',
      ...record,
    }),
  );
  findUnique.mockResolvedValue(row);
  return { token, jti };
}

// ── every rejection, and the fact that they are indistinguishable ────────────

describe('refresh — a token it will not accept', () => {
  it('answers 401 when the cookie is absent, touching neither store', async () => {
    const err = await refresh(undefined).catch((e) => e);

    expect(err.statusCode).toBe(401);
    expect(err.isOperational).toBe(true);
    expect(err.message).toBe(MESSAGES.AUTH.SESSION_INVALID);
    // The guard is before jwt.verify for a reason; nothing downstream ran.
    expect(redis.getdel).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('answers 401 for an empty-string cookie', async () => {
    const err = await refresh('').catch((e) => e);

    expect(err.statusCode).toBe(401);
    expect(redis.getdel).not.toHaveBeenCalled();
  });

  it('answers 401 for a token signed with the WRONG key (plan:391)', async () => {
    // The access secret. This is the property the two distinct keys exist for,
    // and it fails on the signature before any claim is read.
    const foreign = jwt.sign(
      { sub: ACCOUNT.id, type: 'refresh' },
      ACCESS_SECRET,
      {
        expiresIn: '7d',
        jwtid: randomUUID(),
      },
    );

    const err = await refresh(foreign).catch((e) => e);

    expect(err.statusCode).toBe(401);
    expect(redis.getdel).not.toHaveBeenCalled();
  });

  it('answers 401 for a REAL access token from login() (plan:384)', async () => {
    // End to end rather than hand-rolled: whatever login() actually mints must
    // not be redeemable here, which is the deliverable in the plan's own words.
    givenAccount();
    const { accessToken } = await login({ ...CREDS });
    vi.clearAllMocks();

    const err = await refresh(accessToken).catch((e) => e);

    expect(err.statusCode).toBe(401);
    expect(redis.getdel).not.toHaveBeenCalled();
  });

  it('answers 401 for an expired refresh token', async () => {
    const stale = jwt.sign(
      { sub: ACCOUNT.id, type: 'refresh' },
      REFRESH_SECRET,
      {
        expiresIn: '-1s',
        jwtid: randomUUID(),
      },
    );

    const err = await refresh(stale).catch((e) => e);

    expect(err.statusCode).toBe(401);
    expect(err.message).toBe(MESSAGES.AUTH.SESSION_INVALID);
  });

  it('answers 401 for a malformed token', async () => {
    const err = await refresh('not-a-jwt').catch((e) => e);

    expect(err.statusCode).toBe(401);
  });

  it('rejects HS512 signed with the right secret — the algorithms pin', async () => {
    // Measured: without `algorithms: ['HS256']` on verify, jsonwebtoken trusts
    // the header's `alg` and this token VERIFIES. The pin is what refuses it.
    const substituted = jwt.sign(
      { sub: ACCOUNT.id, type: 'refresh' },
      REFRESH_SECRET,
      { expiresIn: '7d', jwtid: randomUUID(), algorithm: 'HS512' },
    );

    const err = await refresh(substituted).catch((e) => e);

    expect(err.statusCode).toBe(401);
    expect(redis.getdel).not.toHaveBeenCalled();
  });

  it('rejects a correctly-signed token whose type is not refresh', async () => {
    // Belt and braces behind the key separation: right key, wrong purpose.
    const wrongType = jwt.sign(
      { sub: ACCOUNT.id, type: 'access' },
      REFRESH_SECRET,
      { expiresIn: '7d', jwtid: randomUUID() },
    );

    const err = await refresh(wrongType).catch((e) => e);

    expect(err.statusCode).toBe(401);
    expect(redis.getdel).not.toHaveBeenCalled();
  });

  it('rejects a token carrying no jti at all', async () => {
    // Verifies perfectly well and yields `jti === undefined` (measured), which
    // is how "session:undefined" gets shared by every caller with the bug.
    const noJti = jwt.sign(
      { sub: ACCOUNT.id, type: 'refresh' },
      REFRESH_SECRET,
      {
        expiresIn: '7d',
      },
    );

    const err = await refresh(noJti).catch((e) => e);

    expect(err.statusCode).toBe(401);
    expect(redis.getdel).not.toHaveBeenCalled();
  });

  it('rejects a non-string sub before it can reach Prisma', async () => {
    // Not the same guard as the jti one: an object or a number here would be
    // passed to findUnique as `where: { id: <that> }`, and Prisma's argument
    // error would be caught by the re-read's catch and answered 503 — an outage
    // report for a forged token, after the session had already been consumed.
    const numericSub = jwt.sign({ sub: 7, type: 'refresh' }, REFRESH_SECRET, {
      expiresIn: '7d',
      jwtid: randomUUID(),
    });

    const err = await refresh(numericSub).catch((e) => e);

    expect(err.statusCode).toBe(401);
    expect(redis.getdel).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects a jti that would forge another key shape, as a 401 not a 503', async () => {
    // cache-keys.js:75's reason for rejecting ':' — a jti of `index:<userId>`
    // makes session() emit exactly what sessionIndex() emits, so a GETDEL would
    // delete the victim's whole session index. Reachable only by someone who can
    // sign with the refresh key, but the classification still matters: keys.session()
    // throws, and if that throw happened inside the Redis try/catch it would be
    // logged as an outage and answered 503 — telling a forger to retry.
    const forged = signRefresh({ jti: `index:${ACCOUNT.id}` });

    const err = await refresh(forged).catch((e) => e);

    expect(err.statusCode).toBe(401);
    expect(err.message).toBe(MESSAGES.AUTH.SESSION_INVALID);
    expect(redis.getdel).not.toHaveBeenCalled();
    expect(logger.child().error).not.toHaveBeenCalled();
  });

  it('answers 401 when the session key is gone — expired, revoked or REPLAYED', async () => {
    // GETDEL returning null covers all three at once, and the third is plan:390:
    // the second use of one cookie finds nothing, because the first consumed it.
    const { token } = givenSession();
    redis.getdel.mockResolvedValue(null);

    const err = await refresh(token).catch((e) => e);

    expect(err.statusCode).toBe(401);
    expect(err.message).toBe(MESSAGES.AUTH.SESSION_INVALID);
  });

  it('gives every rejection a BYTE-IDENTICAL answer', async () => {
    // The oracle property, and the reason SESSION_INVALID is one string. A
    // client that can tell "expired" from "revoked" from "banned" can learn
    // whether a stolen cookie was ever a real session, and whose.
    const { token: banned } = givenSession({
      row: { ...ACCOUNT_ROW, isBanned: true },
    });
    const cases = [
      async () => refresh(undefined),
      async () => refresh(''),
      async () => refresh('not-a-jwt'),
      async () => refresh(signRefresh({ jti: `index:${ACCOUNT.id}` })),
      async () => refresh(banned),
      async () => {
        const { token } = givenSession();
        redis.getdel.mockResolvedValue(null);
        return refresh(token);
      },
    ];

    const answers = [];
    for (const attempt of cases) {
      const err = await attempt().catch((e) => e);
      answers.push(`${err.statusCode} ${err.message}`);
    }

    expect(new Set(answers).size).toBe(1);
    expect(answers[0]).toBe(`401 ${MESSAGES.AUTH.SESSION_INVALID}`);
  });

  it('opens no session for any rejection', async () => {
    for (const bad of ['', 'not-a-jwt', signRefresh({ jti: 'a:b' })]) {
      await refresh(bad).catch(() => {});
    }

    expect(redis.sadd).not.toHaveBeenCalled();
    expect(setWithTTL).not.toHaveBeenCalled();
  });
});

// ── the rotation gate (plan:346, plan:383, plan:390) ─────────────────────────

describe('refresh — the rotation gate', () => {
  it('consumes the session with a single GETDEL on the token jti', async () => {
    // ONE command, not a GET followed by an UNLINK. Measured against
    // redis:7-alpine: four concurrent refreshes on one cookie were all admitted
    // in 200 of 200 trials under GET+UNLINK, and exactly one under GETDEL. A
    // service that reached for redis.get() here would fail on this mock, which
    // has no such method — that absence is deliberate.
    const { token, jti } = givenSession();

    await refresh(token);

    expect(redis.getdel).toHaveBeenCalledTimes(1);
    expect(redis.getdel).toHaveBeenCalledWith(`session:${jti}`);
  });

  it('reads no account until the session is consumed', async () => {
    // The gate, stated as an ordering: an unauthorized caller must not be able
    // to make the service touch Postgres at all.
    const { token } = givenSession();
    redis.getdel.mockResolvedValue(null);

    await refresh(token).catch(() => {});

    expect(redis.getdel).toHaveBeenCalledTimes(1);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('answers 503, NOT 401, when Redis cannot be reached', async () => {
    // Fail closed (TRD §7.1). A 401 here would tell a client holding a perfectly
    // valid token to discard it because the cache was down.
    const { token } = givenSession();
    redis.getdel.mockRejectedValue(new Error('ECONNREFUSED'));

    const err = await refresh(token).catch((e) => e);

    expect(err.statusCode).toBe(503);
    expect(err.message).toBe(MESSAGES.COMMON.SERVICE_UNAVAILABLE);
    expect(redis.sadd).not.toHaveBeenCalled();
  });

  it('logs the cause of that 503, which the response cannot carry', async () => {
    const { token } = givenSession();
    const cause = new Error('ECONNREFUSED');
    redis.getdel.mockRejectedValue(cause);

    await refresh(token).catch(() => {});

    expect(logger.child().error).toHaveBeenCalledTimes(1);
    const [context] = logger.child().error.mock.calls[0];
    expect(context.err).toBe(cause);
    expect(context.userId).toBe(ACCOUNT.id);
  });

  it('answers 503 and mints nothing when the account re-read fails', async () => {
    // Past the point of no return — the old session is already gone — so this
    // is the one failure that costs the caller a login through no fault of
    // theirs. Still a 503 rather than a 401: the token was valid.
    const { token } = givenSession();
    findUnique.mockRejectedValue(new Error('connection terminated'));

    const err = await refresh(token).catch((e) => e);

    expect(err.statusCode).toBe(503);
    expect(redis.getdel).toHaveBeenCalledTimes(1);
    expect(redis.sadd).not.toHaveBeenCalled();
    expect(setWithTTL).not.toHaveBeenCalled();
  });
});

// ── an account that stopped being eligible mid-session ───────────────────────

describe('refresh — an account no longer eligible', () => {
  it('answers 401 and NOT 403 for a banned account', async () => {
    // The deliberate divergence from login(), which answers 403 for this exact
    // account. There a correct password bought the honest answer; here it would
    // be free, and apidoc §8.2 lists no 403 for this route. A 403 would make
    // refresh the ban oracle login's pricing exists to prevent.
    const { token } = givenSession({
      row: { ...ACCOUNT_ROW, isBanned: true },
    });

    const err = await refresh(token).catch((e) => e);

    expect(err.statusCode).toBe(401);
    expect(err.message).toBe(MESSAGES.AUTH.SESSION_INVALID);
    expect(err.message).not.toBe(MESSAGES.AUTH.ACCOUNT_DISABLED);
  });

  it('answers the same 401 for a soft-deleted account', async () => {
    const { token } = givenSession({
      row: { ...ACCOUNT_ROW, deletedAt: new Date('2026-08-20T00:00:00.000Z') },
    });

    const err = await refresh(token).catch((e) => e);

    expect(err.statusCode).toBe(401);
    expect(err.message).toBe(MESSAGES.AUTH.SESSION_INVALID);
  });

  it('answers the same 401 when the row is gone entirely', async () => {
    const { token } = givenSession();
    findUnique.mockResolvedValue(null);

    const err = await refresh(token).catch((e) => e);

    expect(err.statusCode).toBe(401);
  });

  it('does NOT restore the session it consumed — the ban ends it', async () => {
    // The session key was destroyed by the GETDEL that let this request in. A
    // service that wrote it back on the way out would hand a banned user another
    // seven days.
    const { token } = givenSession({
      row: { ...ACCOUNT_ROW, isBanned: true },
    });

    await refresh(token).catch(() => {});

    expect(redis.sadd).not.toHaveBeenCalled();
    expect(setWithTTL).not.toHaveBeenCalled();
    expect(writeOrder).toEqual([]);
  });

  it('logs it, because a ban that survives to here means one path forgot', async () => {
    // Day 13's ban unlinks every session key for the user, so reaching this
    // branch at all is worth a line: it means a ban landed by some path that
    // did not.
    const { token } = givenSession({
      row: { ...ACCOUNT_ROW, isBanned: true },
    });

    await refresh(token).catch(() => {});

    expect(logger.child().warn).toHaveBeenCalledTimes(1);
    expect(logger.child().warn.mock.calls[0][0].userId).toBe(ACCOUNT.id);
  });
});

// ── the new pair, and where its claims come from ─────────────────────────────

describe('refresh — the new token pair', () => {
  it('returns the two tokens and NOTHING else (apidoc §8.2)', async () => {
    // Not a `user`, unlike login's response. The endpoint's contract is the pair.
    const { token } = givenSession();

    const result = await refresh(token);

    expect(Object.keys(result).sort()).toEqual(['accessToken', 'refreshToken']);
  });

  it('takes role from POSTGRES, not from the session record it just read', async () => {
    // The reason refresh queries at all. The record's `role` is up to 7 days
    // stale — nothing rewrites a live session on a role change — so an
    // INSTRUCTOR demoted to STUDENT would otherwise keep minting access tokens
    // carrying the role they no longer hold, 15 minutes at a time, for a week.
    const { token } = givenSession({
      record: { role: UserRole.INSTRUCTOR },
      row: { ...ACCOUNT_ROW, role: UserRole.STUDENT },
    });

    const { accessToken } = await refresh(token);

    expect(jwt.verify(accessToken, ACCESS_SECRET).role).toBe(UserRole.STUDENT);
    // And the new session record carries the current role too, not the old one.
    expect(setWithTTL.mock.calls[0][1].role).toBe(UserRole.STUDENT);
  });

  it('carries an email the session record could not have supplied', async () => {
    // plan:356 fixes the record's shape at { userId, role, issuedAt, ip,
    // userAgent } — no email — while plan:351 has requireAuth build
    // `req.user = { id, email, role }` from the token with no round trip. Without
    // the query, every refreshed token arrives at 3.10 missing a field.
    const { token } = givenSession({
      row: { ...ACCOUNT_ROW, email: 'ada.new@example.com' },
    });

    const { accessToken } = await refresh(token);
    const claims = jwt.verify(accessToken, ACCESS_SECRET);

    expect(claims.email).toBe('ada.new@example.com');
    expect(claims.sub).toBe(ACCOUNT.id);
    expect(claims.type).toBe('access');
  });

  it('ROTATES the refresh jti rather than reissuing the same one', async () => {
    // A reissued jti is not a rotation: the old cookie would still name a live
    // key, and plan:383's single-use property would be a comment.
    const { token, jti } = givenSession();

    const { refreshToken } = await refresh(token);

    expect(jwt.decode(refreshToken).jti).not.toBe(jti);
    expect(jwt.decode(refreshToken).jti).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps the two classes on their own keys and their own jtis', async () => {
    const { token } = givenSession();

    const { accessToken, refreshToken } = await refresh(token);

    expect(() => jwt.verify(refreshToken, ACCESS_SECRET)).toThrow(
      /invalid signature/,
    );
    expect(() => jwt.verify(accessToken, REFRESH_SECRET)).toThrow(
      /invalid signature/,
    );
    expect(jwt.decode(accessToken).jti).not.toBe(jwt.decode(refreshToken).jti);
  });

  it('signs both with HS256, the one algorithm verify accepts', async () => {
    // The other half of the pin. Signing under an algorithm the service refuses
    // to verify would mint tokens nothing can redeem.
    const { token } = givenSession();

    const { accessToken, refreshToken } = await refresh(token);

    expect(jwt.decode(accessToken, { complete: true }).header.alg).toBe(
      'HS256',
    );
    expect(jwt.decode(refreshToken, { complete: true }).header.alg).toBe(
      'HS256',
    );
  });

  it('gives the new refresh token a FULL 7 days — the session slides', async () => {
    const { token } = givenSession();

    const { accessToken, refreshToken } = await refresh(token);
    const access = jwt.decode(accessToken);
    const refreshed = jwt.decode(refreshToken);

    expect(access.exp - access.iat).toBe(15 * 60);
    expect(refreshed.exp - refreshed.iat).toBe(TTL.session);
    expect(refreshed.exp - refreshed.iat).toBe(7 * 24 * 60 * 60);
  });

  it('keeps the new refresh payload as minimal as login keeps its own', async () => {
    const { token } = givenSession();

    const { refreshToken } = await refresh(token);

    expect(Object.keys(jwt.decode(refreshToken)).sort()).toEqual([
      'exp',
      'iat',
      'jti',
      'sub',
      'type',
    ]);
  });
});

// ── the new session records, and the order they are written in ───────────────

describe('refresh — the new session records', () => {
  it('keys the new session on the NEW refresh jti', async () => {
    const { token } = givenSession();

    const { refreshToken } = await refresh(token);

    expect(setWithTTL.mock.calls[0][0]).toBe(
      `session:${jwt.decode(refreshToken).jti}`,
    );
  });

  it('INDEXES BEFORE it writes the session, then prunes LAST', async () => {
    // Same ordering property login() has, for the same reason (plan:367): a
    // session key the index does not list survives "revoke all sessions" for its
    // full 7 days. The SREM comes last because it is the only write that can be
    // lost without consequence — the index is specified as a superset, so a
    // leftover jti is inert.
    const { token, jti } = givenSession();

    const { refreshToken } = await refresh(token);
    const newJti = jwt.decode(refreshToken).jti;

    expect(writeOrder).toEqual([
      INDEX_KEY,
      `session:${newJti}`,
      `user:state:${ACCOUNT.id}`,
      `SREM ${INDEX_KEY}`,
    ]);
    expect(redis.srem).toHaveBeenCalledWith(INDEX_KEY, jti);
  });

  it('writes plan:356 shape at TTL.session', async () => {
    const { token } = givenSession();

    await refresh(token, { ip: '203.0.113.7', userAgent: 'curl/8.5.0' });
    const [, record, ttl] = setWithTTL.mock.calls[0];

    expect(record).toEqual({
      userId: ACCOUNT.id,
      role: UserRole.STUDENT,
      issuedAt: expect.any(String),
      ip: '203.0.113.7',
      userAgent: 'curl/8.5.0',
    });
    expect(new Date(record.issuedAt).toISOString()).toBe(record.issuedAt);
    expect(ttl).toBe(TTL.session);
  });

  it('takes provenance from THIS request, not from the record it replaced', async () => {
    // The new record should say where the session was last used. Copying the old
    // ip and user-agent forward would make an audit trail that never moves.
    const { token } = givenSession();

    await refresh(token, { ip: '203.0.113.7', userAgent: 'curl/8.5.0' });
    const [, record] = setWithTTL.mock.calls[0];

    expect(record.ip).toBe('203.0.113.7');
    expect(record.ip).not.toBe('198.51.100.9');
    expect(record.userAgent).not.toBe('old-agent/1.0');
  });

  it('stores absent provenance as null, so the shape never varies', async () => {
    const { token } = givenSession();

    await refresh(token);
    const [, record] = setWithTTL.mock.calls[0];

    expect(record.ip).toBeNull();
    expect(record.userAgent).toBeNull();
    expect(Object.keys(record)).toContain('ip');
  });

  it('refreshes user:state at TTL.userState with REAL booleans', async () => {
    const { token } = givenSession();

    await refresh(token);
    const [key, state, ttl] = setWithTTL.mock.calls[1];

    expect(key).toBe(`user:state:${ACCOUNT.id}`);
    expect(state).toEqual({
      role: UserRole.STUDENT,
      isBanned: false,
      isEmailVerified: false,
      deletedAt: null,
    });
    expect(state.isBanned).toBe(false);
    expect(ttl).toBe(TTL.userState);
  });

  it('never fetches passwordHash — refresh compares no password', async () => {
    // ACCOUNT_FIELDS rather than LOGIN_USER_FIELDS. Selecting the hash here
    // would move a bcrypt digest into a function with no use for it.
    const { token } = givenSession();

    await refresh(token);
    const { where, select } = findUnique.mock.calls[0][0];

    expect(where).toEqual({ id: ACCOUNT.id });
    expect(select.passwordHash).toBeUndefined();
    expect(select.isBanned).toBe(true);
    expect(select.email).toBe(true);
  });
});

// ── the commit point ─────────────────────────────────────────────────────────

describe('refresh — before and after the commit point', () => {
  it('answers 503 with NO tokens when the index write fails', async () => {
    const { token } = givenSession();
    redis.sadd.mockRejectedValue(new Error('ECONNREFUSED'));

    const err = await refresh(token).catch((e) => e);

    expect(err.statusCode).toBe(503);
    expect(setWithTTL).not.toHaveBeenCalled();
  });

  it('answers 503 with NO tokens when the session write fails', async () => {
    // The commit point itself. Before it, failing closed costs a login; after
    // it, failing would throw away a rotation Redis has already recorded.
    const { token } = givenSession();
    setWithTTL.mockRejectedValue(new Error('ECONNREFUSED'));

    const err = await refresh(token).catch((e) => e);

    expect(err.statusCode).toBe(503);
    expect(err.message).toBe(MESSAGES.COMMON.SERVICE_UNAVAILABLE);
  });

  it('STANDS when the user:state write fails, and warns', async () => {
    // Past the commit point. A missing user:state is a defined fallthrough to
    // Postgres (cache-keys.js:316), so throwing here would strand a session that
    // Redis has correctly recorded — the client would discard the only live
    // refresh token it has.
    const { token } = givenSession();
    setWithTTL.mockImplementation(async (key) => {
      writeOrder.push(key);
      if (key.startsWith('user:state:')) throw new Error('ECONNREFUSED');
      return 'OK';
    });

    const result = await refresh(token);

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(logger.child().warn).toHaveBeenCalledTimes(1);
    expect(logger.child().error).not.toHaveBeenCalled();
  });

  it('STANDS when the stale index entry cannot be pruned, and warns', async () => {
    // The least consequential write in the function: the index is a superset by
    // specification (plan:367), the old session key is already gone, and SREM of
    // a non-member returns 0 rather than erroring (measured).
    const { token } = givenSession();
    redis.srem.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await refresh(token);

    expect(result.refreshToken).toBeTruthy();
    expect(logger.child().warn).toHaveBeenCalledTimes(1);
    expect(logger.child().error).not.toHaveBeenCalled();
  });

  it('still returns a usable pair when BOTH best-effort writes fail', async () => {
    const { token } = givenSession();
    setWithTTL.mockImplementation(async (key) => {
      if (key.startsWith('user:state:')) throw new Error('down');
      return 'OK';
    });
    redis.srem.mockRejectedValue(new Error('down'));

    const { accessToken, refreshToken } = await refresh(token);

    expect(jwt.verify(accessToken, ACCESS_SECRET).sub).toBe(ACCOUNT.id);
    expect(jwt.verify(refreshToken, REFRESH_SECRET).type).toBe('refresh');
    expect(logger.child().warn).toHaveBeenCalledTimes(2);
  });
});

// ── the cookie contract 3.6 and 3.9 both depend on ───────────────────────────

describe('REFRESH_COOKIE', () => {
  it('is apidoc:280 name plus plan:346 attributes', async () => {
    expect(REFRESH_COOKIE.name).toBe('refreshToken');
    expect(REFRESH_COOKIE.options.httpOnly).toBe(true);
    expect(REFRESH_COOKIE.options.sameSite).toBe('strict');
    // Narrower than '/', and the value 3.6's clearCookie must match exactly or
    // the browser keeps the cookie it was told to drop.
    expect(REFRESH_COOKIE.options.path).toBe('/api/v1/auth');
  });

  it('states maxAge in MILLISECONDS, matching the session TTL', async () => {
    // res.cookie takes ms, Redis EXPIRE takes seconds. Without the x1000 this is
    // a 7-second cookie, which no test of the service itself would ever notice.
    expect(REFRESH_COOKIE.options.maxAge).toBe(TTL.session * 1000);
    expect(REFRESH_COOKIE.options.maxAge).toBe(604800000);
  });

  it('is frozen, so no controller can edit the shared object', async () => {
    expect(Object.isFrozen(REFRESH_COOKIE)).toBe(true);
    expect(Object.isFrozen(REFRESH_COOKIE.options)).toBe(true);
  });

  it('waives Secure only for an EXPLICIT development NODE_ENV', async () => {
    // The polarity is the point. This file's other NODE_ENV readers default an
    // unset value to 'development'; doing that here would strip Secure off the
    // refresh cookie on any production host that forgot to set the variable.
    // Re-imported rather than asserted on a constant, because the value is fixed
    // at module load and there is no other way to see both branches.
    expect(process.env.NODE_ENV).toBe('test');
    expect(REFRESH_COOKIE.options.secure).toBe(true);

    const original = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'development';
      vi.resetModules();
      const dev = await import('../auth.service.js');
      expect(dev.REFRESH_COOKIE.options.secure).toBe(false);

      delete process.env.NODE_ENV;
      vi.resetModules();
      const unset = await import('../auth.service.js');
      expect(unset.REFRESH_COOKIE.options.secure).toBe(true);

      process.env.NODE_ENV = 'production';
      vi.resetModules();
      const prod = await import('../auth.service.js');
      expect(prod.REFRESH_COOKIE.options.secure).toBe(true);
    } finally {
      process.env.NODE_ENV = original;
      vi.resetModules();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// logout() — task 3.6
//
// The shape of these blocks differs from refresh()'s for one reason: logout has
// no failure response to assert. apidoc §8.2 gives it a single 200 and no error
// rows, so where a refresh test catches a thrown AppError and reads its
// statusCode, a logout test reads a RESOLVED `{ revoked }` and then asks what
// Redis was and was not told. "Did not throw" is therefore an assertion in its
// own right here, and the first block makes it explicitly rather than relying on
// an unhandled rejection to fail the run.
// ─────────────────────────────────────────────────────────────────────────────

/** A live session for logout: a cookie whose sub is the caller, and a hit. */
function givenLiveSession({ userId = ACCOUNT.id, jti = randomUUID() } = {}) {
  const token = signRefresh({ sub: userId, jti });
  redis.unlink.mockImplementation(async (key) => {
    writeOrder.push(`UNLINK ${key}`);
    return 1;
  });
  return { token, jti };
}

/**
 * A refresh token that verified correctly a second ago and no longer does.
 *
 * Not signRefresh({ expiresIn }) — that helper spreads its extras into the
 * PAYLOAD, so `expiresIn` there would be an inert custom claim on a token with a
 * full seven days left, and every assertion about expiry would pass for the
 * wrong reason.
 */
function signExpiredRefresh() {
  return jwt.sign({ sub: ACCOUNT.id, type: 'refresh' }, REFRESH_SECRET, {
    expiresIn: '-1s',
    jwtid: randomUUID(),
  });
}

// ── every cookie it will not act on, and the fact that none of them fail ─────

describe('logout — nothing to revoke', () => {
  it('resolves for an absent cookie, touching Redis not at all', async () => {
    const result = await logout(undefined, { userId: ACCOUNT.id });

    expect(result).toEqual({ revoked: false });
    expect(redis.unlink).not.toHaveBeenCalled();
    expect(redis.srem).not.toHaveBeenCalled();
    // A double logout is the ordinary case, not an incident. Logging it would put
    // a line in the security log for every client that clicked twice.
    expect(logger.child().warn).not.toHaveBeenCalled();
    expect(logger.child().error).not.toHaveBeenCalled();
  });

  it('NEVER THROWS, for any cookie a client could send', async () => {
    // apidoc §8.2's contract in one assertion. Each of these is a case refresh()
    // answers 401 for; every one of them has to resolve here instead, and resolve
    // to the same thing, or the endpoint has a failure mode its documentation
    // does not admit to.
    const cases = [
      ['no cookie at all', undefined],
      ['an empty-string cookie', ''],
      ['junk that is not a JWT', 'not-a-jwt'],
      [
        'a token signed with the ACCESS key',
        jwt.sign({ sub: ACCOUNT.id, type: 'refresh' }, ACCESS_SECRET, {
          expiresIn: '7d',
          jwtid: randomUUID(),
        }),
      ],
      [
        'a token signed with neither key',
        jwt.sign(
          { sub: ACCOUNT.id, type: 'refresh' },
          'a-third-secret-entirely',
          {
            expiresIn: '7d',
            jwtid: randomUUID(),
          },
        ),
      ],
      ['an expired refresh token', signExpiredRefresh()],
      ["a `type` claim of 'access'", signRefresh({ type: 'access' })],
      ['no `type` claim at all', signRefresh({ type: undefined })],
      [
        'no jti',
        jwt.sign({ sub: ACCOUNT.id, type: 'refresh' }, REFRESH_SECRET),
      ],
      ['a non-string sub', signRefresh({ sub: 12345 })],
      ["a jti carrying ':'", signRefresh({ jti: `index:${ACCOUNT.id}` })],
      [
        'a cookie belonging to someone else',
        signRefresh({ sub: 'another-user' }),
      ],
    ];

    const outcomes = {};
    for (const [label, token] of cases) {
      // Deliberately NOT wrapped in .catch() — a rejection here fails the test
      // by escaping, which is the behaviour being asserted.
      outcomes[label] = await logout(token, { userId: ACCOUNT.id });
    }

    expect(outcomes).toEqual(
      Object.fromEntries(cases.map(([label]) => [label, { revoked: false }])),
    );
  });

  it('does not reach Redis for a token it cannot verify', async () => {
    await logout('not-a-jwt', { userId: ACCOUNT.id });
    await logout(signExpiredRefresh(), { userId: ACCOUNT.id });

    // An expired cookie names an expired key: TTL.session and the token lifetime
    // are set from the same moment, so there is nothing there to unlink. Strict
    // verification rather than ignoreExpiration, and this is what pins it.
    expect(redis.unlink).not.toHaveBeenCalled();
  });

  it('refuses a token signed with the refresh key but minted as an access one', async () => {
    const result = await logout(signRefresh({ type: 'access' }), {
      userId: ACCOUNT.id,
    });

    expect(result).toEqual({ revoked: false });
    expect(redis.unlink).not.toHaveBeenCalled();
  });

  it('verifies against the REFRESH key, so an access token revokes nothing', async () => {
    // The NEVER THROWS table covers this case too, but only asserts the returned
    // value — and the unlink mock answers 0 by default, so that assertion would
    // still pass if the service verified with the wrong secret. This is the one
    // that would not: an accepted token reaches UNLINK.
    const accessToken = jwt.sign(
      {
        sub: ACCOUNT.id,
        email: ACCOUNT.email,
        role: ACCOUNT.role,
        type: 'access',
      },
      ACCESS_SECRET,
      { expiresIn: '15m', jwtid: randomUUID() },
    );

    await logout(accessToken, { userId: ACCOUNT.id });

    expect(redis.unlink).not.toHaveBeenCalled();
  });

  it('refuses HS512 signed with the right secret — the algorithms pin', async () => {
    // Same pin refresh() carries, for the same reason: without `algorithms`,
    // jsonwebtoken accepts whatever `alg` the header claims as long as the MAC
    // checks out, and the header is attacker-controlled. Measured in 3.5 —
    // HS512 with the correct secret is ACCEPTED without the pin.
    const hs512 = jwt.sign(
      { sub: ACCOUNT.id, type: 'refresh' },
      REFRESH_SECRET,
      {
        algorithm: 'HS512',
        expiresIn: '7d',
        jwtid: randomUUID(),
      },
    );

    const result = await logout(hs512, { userId: ACCOUNT.id });

    expect(result).toEqual({ revoked: false });
    expect(redis.unlink).not.toHaveBeenCalled();
  });

  it('touches neither PostgreSQL nor user:state on any path', async () => {
    givenLiveSession();
    const { token } = givenLiveSession();
    await logout(token, { userId: ACCOUNT.id });

    // Ending a session changes no account field, so there is nothing to re-read
    // and nothing to re-cache. A user:state write here would only reset a TTL.
    expect(findUnique).not.toHaveBeenCalled();
    expect(setWithTTL).not.toHaveBeenCalled();
  });
});

// ── a cookie that is authentic but not the caller's ──────────────────────────

describe('logout — someone else’s cookie', () => {
  it('revokes nothing when the cookie subject is not the caller', async () => {
    // Authentic — signed with the real refresh key — and still refused. Without
    // this comparison, a Bearer token for one account plus a leaked cookie for
    // another is a free way to end the second account's session.
    const victimToken = signRefresh({ sub: 'victim-user-id' });

    const result = await logout(victimToken, { userId: ACCOUNT.id });

    expect(result).toEqual({ revoked: false });
    expect(redis.unlink).not.toHaveBeenCalled();
    expect(redis.srem).not.toHaveBeenCalled();
  });

  it('logs the mismatch at warn, with both identities', async () => {
    await logout(signRefresh({ sub: 'victim-user-id' }), {
      userId: ACCOUNT.id,
    });

    expect(logger.child().warn).toHaveBeenCalledTimes(1);
    const [context] = logger.child().warn.mock.calls[0];
    expect(context.userId).toBe(ACCOUNT.id);
    expect(context.cookieSubject).toBe('victim-user-id');
    expect(logger.child().error).not.toHaveBeenCalled();
  });

  it('revokes nothing when the controller forgot to pass a userId', async () => {
    // Lands in the same guard, which is why it is safe: a missing caller identity
    // cannot match any cookie, so the failure mode of forgetting it is "logout
    // stops working", not "logout revokes the wrong session".
    const result = await logout(signRefresh(), {});

    expect(result).toEqual({ revoked: false });
    expect(redis.unlink).not.toHaveBeenCalled();
    const [context] = logger.child().warn.mock.calls[0];
    expect(context.userId).toBeUndefined();
  });

  it('revokes nothing when called with no context object at all', async () => {
    const result = await logout(signRefresh());
    expect(result).toEqual({ revoked: false });
    expect(redis.unlink).not.toHaveBeenCalled();
  });
});

// ── the forged jti, which UNLINK would honour where GETDEL refused it ────────

describe('logout — a jti that would name another key', () => {
  it('never lets a crafted jti reach UNLINK', async () => {
    // THE one in this block that matters. keys.session('index:<id>') would emit
    // `session:index:<id>` — the victim's index key — and UNLINK, unlike
    // refresh()'s GETDEL, does not refuse a Set: measured against redis 7.4.9, it
    // returns 1 and the Set is gone. Every session it listed would then be
    // unrevocable, so a ban on that account finds an empty set and reports zero.
    const forged = signRefresh({ jti: `index:${ACCOUNT.id}` });

    const result = await logout(forged, { userId: ACCOUNT.id });

    expect(result).toEqual({ revoked: false });
    expect(redis.unlink).not.toHaveBeenCalled();
    expect(redis.unlink).not.toHaveBeenCalledWith(INDEX_KEY);
    expect(redis.srem).not.toHaveBeenCalled();
  });

  it('refuses every jti outside the cache-keys character class', async () => {
    for (const jti of ['index:x', 'a b', 'a*', 'sess:ion', '']) {
      const result = await logout(signRefresh({ jti }), {
        userId: ACCOUNT.id,
      });
      expect(result).toEqual({ revoked: false });
    }
    expect(redis.unlink).not.toHaveBeenCalled();
  });

  it('logs the unusable jti at warn, without echoing it', async () => {
    await logout(signRefresh({ jti: `index:${ACCOUNT.id}` }), {
      userId: ACCOUNT.id,
    });

    expect(logger.child().warn).toHaveBeenCalledTimes(1);
    const [context, message] = logger.child().warn.mock.calls[0];
    expect(context.userId).toBe(ACCOUNT.id);
    expect(message).toMatch(/unusable jti/);
  });
});

// ── the revocation itself (plan:347, apidoc:290) ─────────────────────────────

describe('logout — the revocation', () => {
  it('unlinks exactly session:<jti> from the cookie', async () => {
    const { token, jti } = givenLiveSession();

    const result = await logout(token, { userId: ACCOUNT.id });

    expect(result).toEqual({ revoked: true });
    expect(redis.unlink).toHaveBeenCalledTimes(1);
    expect(redis.unlink).toHaveBeenCalledWith(`session:${jti}`);
  });

  it('prunes that jti from session:index:<userId>, and only that jti', async () => {
    const { token, jti } = givenLiveSession();

    await logout(token, { userId: ACCOUNT.id });

    expect(redis.srem).toHaveBeenCalledTimes(1);
    expect(redis.srem).toHaveBeenCalledWith(INDEX_KEY, jti);
  });

  it('UNLINKS BEFORE it prunes, never the other way round', async () => {
    // The invariant, and the reason plan:347 states this order. The index is a
    // superset of live sessions (plan:367, TRD:1723): it may list a dead jti but
    // must never omit a live one. SREM first plus a failed UNLINK leaves a live
    // session that no ban can find, because Day 13 works from the index.
    const { token, jti } = givenLiveSession();

    await logout(token, { userId: ACCOUNT.id });

    expect(writeOrder).toEqual([`UNLINK session:${jti}`, `SREM ${INDEX_KEY}`]);
  });

  it('reports revoked: false when the key was already gone', async () => {
    // UNLINK returns the number of keys removed, so 0 is "expired on its own, or
    // revoked by a ban, or a second logout" — a success with nothing in it. The
    // mock's default is 0 precisely so this is the case a test has to opt out of.
    const token = signRefresh({ sub: ACCOUNT.id });

    const result = await logout(token, { userId: ACCOUNT.id });

    expect(result).toEqual({ revoked: false });
    expect(redis.unlink).toHaveBeenCalledTimes(1);
  });

  it('still prunes the index when the session key was already gone', async () => {
    // The opportunistic cleanup TRD:1723 describes. Nothing was revoked, but the
    // dead member is exactly what the index accumulates and what inflates Day
    // 13's revoked-session count if it is never removed.
    const { token, jti } = givenLiveSession();
    redis.unlink.mockImplementation(async (key) => {
      writeOrder.push(`UNLINK ${key}`);
      return 0;
    });

    const result = await logout(token, { userId: ACCOUNT.id });

    expect(result).toEqual({ revoked: false });
    expect(redis.srem).toHaveBeenCalledWith(INDEX_KEY, jti);
  });

  it('revokes ONE session, not every session the user holds', async () => {
    // apidoc §8.2 is "Unlinks session:<jti>", singular — a phone stays signed in
    // when a laptop signs out. The all-sessions operation is 3.7's and Day 13's,
    // and it works by SMEMBERS on the index, which is never read here.
    //
    // This asserted `redis.smembers` was UNDEFINED until 3.7, using the mock's own
    // shape as the proof. 3.7 gave the mock an smembers for resetPassword, so the
    // claim is now made the way it should always have been made — the command
    // exists and this function does not reach for it.
    const { token } = givenLiveSession();

    await logout(token, { userId: ACCOUNT.id });

    expect(redis.unlink).toHaveBeenCalledTimes(1);
    expect(redis.smembers).not.toHaveBeenCalled();
    expect(redis.unlink).not.toHaveBeenCalledWith(INDEX_KEY);
  });

  it('logs nothing at all on a successful revocation', async () => {
    const { token } = givenLiveSession();

    await logout(token, { userId: ACCOUNT.id });

    // The module logs only failures — there is no log.info anywhere in it — so a
    // line here would be a new convention arriving by accident.
    expect(logger.child().warn).not.toHaveBeenCalled();
    expect(logger.child().error).not.toHaveBeenCalled();
  });
});

// ── Redis unreachable: the 503 that deliberately is not one ──────────────────

describe('logout — when Redis cannot be reached', () => {
  it('does NOT answer 503, unlike refresh', async () => {
    // The deliberate divergence from TRD §7.1's fail-closed rule, which is about
    // reads that ADMIT a request (TRD:1684). Logout admits nothing. And a thrown
    // error would stop the controller reaching res.clearCookie, leaving the
    // browser holding a live cookie — strictly worse than a stale server record.
    const { token } = givenLiveSession();
    redis.unlink.mockRejectedValue(new Error('READONLY'));

    const result = await logout(token, { userId: ACCOUNT.id });

    expect(result).toEqual({ revoked: false });
  });

  it('does not prune the index when the unlink failed', async () => {
    // The load-bearing half. Pruning a jti whose session may still be live is
    // the exact inversion of the superset invariant: the session would be live
    // and unlisted, so a ban would never find it.
    const { token } = givenLiveSession();
    redis.unlink.mockRejectedValue(new Error('ECONNREFUSED'));

    await logout(token, { userId: ACCOUNT.id });

    expect(redis.srem).not.toHaveBeenCalled();
    expect(writeOrder).toEqual([]);
  });

  it('logs the failed unlink at ERROR, not warn', async () => {
    // An operator has to know that revocations are silently not happening. This
    // is the one failure in logout that is nobody's fault but the platform's.
    const { token } = givenLiveSession();
    const boom = new Error('ECONNREFUSED');
    redis.unlink.mockRejectedValue(boom);

    await logout(token, { userId: ACCOUNT.id });

    expect(logger.child().error).toHaveBeenCalledTimes(1);
    const [context, message] = logger.child().error.mock.calls[0];
    expect(context.err).toBe(boom);
    expect(context.userId).toBe(ACCOUNT.id);
    expect(message).toMatch(/NOT revoked/);
    expect(logger.child().warn).not.toHaveBeenCalled();
  });

  it('keeps revoked: true when only the index prune failed', async () => {
    // Past the commit point. The session IS gone; a leftover index member is
    // inert by specification (plan:367) and SREM of a non-member returns 0 rather
    // than throwing, so the next rotation's cleanup is a no-op either way.
    const { token } = givenLiveSession();
    redis.srem.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await logout(token, { userId: ACCOUNT.id });

    expect(result).toEqual({ revoked: true });
    expect(logger.child().warn).toHaveBeenCalledTimes(1);
    expect(logger.child().error).not.toHaveBeenCalled();
  });

  it('survives a malformed userId reaching the index key builder', async () => {
    // keys.sessionIndex() throws on a userId outside its character class, and it
    // is evaluated INSIDE the try — so the throw lands in the warn rather than
    // escaping past a revocation that already happened.
    const token = signRefresh({ sub: 'bad:user:id' });
    redis.unlink.mockResolvedValue(1);

    const result = await logout(token, { userId: 'bad:user:id' });

    expect(result).toEqual({ revoked: true });
    expect(logger.child().warn).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Password recovery — task 3.7
//
// The digests below are recomputed with createHash rather than by calling
// keys.passwordReset(), for the reason register()'s tests already do it that way:
// asking the builder to confirm its own output proves only that it is
// deterministic. The pointer key is likewise written out in full.
// ─────────────────────────────────────────────────────────────────────────────

const resetKeyFor = (token) =>
  `reset:pw:${createHash('sha256').update(token, 'utf8').digest('hex')}`;

const RECOVERED = Object.freeze({
  id: '99999999-8888-7777-6666-555555555555',
  email: 'ada@example.com',
  fullName: 'Ada Lovelace',
  deletedAt: null,
});

const pointerKeyFor = (userId) => `reset:pw:user:${userId}`;

/** The single argument sendPasswordResetEmail was called with. */
const mailedToken = () => sendPasswordResetEmail.mock.calls[0][0].token;

// ── forgot-password, when the address belongs to somebody ─────────────────────

describe('forgotPassword — an eligible account', () => {
  beforeEach(() => {
    findUnique.mockResolvedValue({ ...RECOVERED });
  });

  it('stores the user id under reset:pw:<sha256(token)> for 15 minutes', async () => {
    await forgotPassword({ email: RECOVERED.email });

    const [key, value, ttl] = setWithTTL.mock.calls[0];
    expect(key).toMatch(/^reset:pw:[0-9a-f]{64}$/);
    expect(value).toBe(RECOVERED.id);
    expect(ttl).toBe(TTL.passwordReset);
    expect(ttl).toBe(15 * 60);
  });

  it('emails the RAW token and persists only its digest (TRD:1474)', async () => {
    await forgotPassword({ email: RECOVERED.email });

    const token = mailedToken();
    expect(token).toMatch(new RegExp(`^[0-9a-f]{${TOKEN.LENGTH}}$`));

    // The one assertion that ties the two halves together: what was mailed hashes
    // to what was stored. A service that mailed a different token than it wrote
    // would pass every other test in this block.
    const [key] = setWithTTL.mock.calls[0];
    expect(key).toBe(resetKeyFor(token));

    // And the raw token appears in nothing that was written.
    const written = JSON.stringify(setWithTTL.mock.calls);
    expect(written).not.toContain(token);
  });

  it('addresses the mail from the row, not from the request', async () => {
    // A caller could send a differently-cased address that findUnique still
    // matches; the link must go to the stored one.
    await forgotPassword({ email: 'ADA@Example.com  ' });

    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(sendPasswordResetEmail.mock.calls[0][0]).toMatchObject({
      to: RECOVERED.email,
      fullName: RECOVERED.fullName,
    });
  });

  it('normalises the address before looking it up', async () => {
    await forgotPassword({ email: '  ADA@Example.COM ' });

    expect(findUnique).toHaveBeenCalledWith({
      where: { email: 'ada@example.com' },
      select: expect.objectContaining({ id: true, deletedAt: true }),
    });
  });

  it('never selects the password hash', async () => {
    await forgotPassword({ email: RECOVERED.email });

    const { select } = findUnique.mock.calls[0][0];
    expect(select.passwordHash).toBeUndefined();
    expect(Object.keys(select).sort()).toEqual([
      'deletedAt',
      'email',
      'fullName',
      'id',
    ]);
  });

  it('returns nothing at all, so no controller can leak the branch', async () => {
    const result = await forgotPassword({ email: RECOVERED.email });

    expect(result).toBeUndefined();
  });

  it('writes the token BEFORE the pointer that names it', async () => {
    await forgotPassword({ email: RECOVERED.email });

    const token = mailedToken();
    expect(writeOrder).toEqual([
      resetKeyFor(token),
      pointerKeyFor(RECOVERED.id),
    ]);
    expect(setWithTTL.mock.calls[1][1]).toBe(resetKeyFor(token));
    expect(setWithTTL.mock.calls[1][2]).toBe(TTL.passwordReset);
  });

  it('dispatches the mail only after the token is redeemable', async () => {
    // Fire-and-forget means the ordering is the only thing that stops a user
    // clicking a link before the token it names exists.
    let writtenWhenMailed = null;
    sendPasswordResetEmail.mockImplementation(() => {
      writtenWhenMailed = setWithTTL.mock.calls.length;
    });

    await forgotPassword({ email: RECOVERED.email });

    expect(writtenWhenMailed).toBeGreaterThanOrEqual(1);
  });

  it('does not await the mailer', async () => {
    // register()'s contract, restated here: the integration cannot reject, so a
    // floating call is safe — and a service that awaited a slow provider would
    // hold the request open for it.
    sendPasswordResetEmail.mockReturnValue(new Promise(() => {}));

    await expect(
      forgotPassword({ email: RECOVERED.email }),
    ).resolves.toBeUndefined();
  });
});

// ── forgot-password, when it is not: the enumeration contract ─────────────────

describe('forgotPassword — no eligible account', () => {
  it('answers exactly as the hit path does for an unknown address', async () => {
    findUnique.mockResolvedValue(null);

    const result = await forgotPassword({ email: 'nobody@example.com' });

    expect(result).toBeUndefined();
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(setWithTTL).not.toHaveBeenCalled();
  });

  it('treats a soft-deleted account as absent', async () => {
    findUnique.mockResolvedValue({
      ...RECOVERED,
      deletedAt: new Date('2026-01-01T00:00:00Z'),
    });

    const result = await forgotPassword({ email: RECOVERED.email });

    expect(result).toBeUndefined();
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(setWithTTL).not.toHaveBeenCalled();
  });

  it('still touches Redis once, with a key that cannot exist', async () => {
    findUnique.mockResolvedValue(null);

    await forgotPassword({ email: 'nobody@example.com' });

    expect(redis.exists).toHaveBeenCalledTimes(1);
    const [key] = redis.exists.mock.calls[0];
    expect(key).toMatch(/^reset:pw:[0-9a-f]{64}$/);
  });

  it('reads rather than writes on the decoy — it must not create a token', async () => {
    findUnique.mockResolvedValue(null);

    await forgotPassword({ email: 'nobody@example.com' });

    expect(setWithTTL).not.toHaveBeenCalled();
    expect(redis.unlink).not.toHaveBeenCalled();
    expect(redis.getdel).not.toHaveBeenCalled();
    expect(writeOrder).toEqual([]);
  });

  it('draws a fresh decoy key each time, so the probe is not a fixed key', async () => {
    findUnique.mockResolvedValue(null);

    await forgotPassword({ email: 'a@example.com' });
    await forgotPassword({ email: 'b@example.com' });

    const [first] = redis.exists.mock.calls[0];
    const [second] = redis.exists.mock.calls[1];
    expect(first).not.toBe(second);
  });
});

// ── the outage symmetry, which is the whole reason the decoy exists ───────────

describe('forgotPassword — when Redis cannot be reached', () => {
  const outage = () => new Error('ECONNREFUSED');

  it('answers 503 when the token write fails', async () => {
    findUnique.mockResolvedValue({ ...RECOVERED });
    setWithTTL.mockRejectedValueOnce(outage());

    const err = await forgotPassword({ email: RECOVERED.email }).catch(
      (e) => e,
    );

    expect(err.statusCode).toBe(503);
    expect(err.message).toBe(MESSAGES.COMMON.SERVICE_UNAVAILABLE);
  });

  it('answers 503 on the NO-ACCOUNT branch too (TRD:1478 + TRD:1480)', async () => {
    findUnique.mockResolvedValue(null);
    redis.exists.mockRejectedValueOnce(outage());

    const err = await forgotPassword({ email: 'nobody@example.com' }).catch(
      (e) => e,
    );

    expect(err.statusCode).toBe(503);
    expect(err.message).toBe(MESSAGES.COMMON.SERVICE_UNAVAILABLE);
  });

  it('makes the two outage answers indistinguishable', async () => {
    // The test this whole design exists for. Without the decoy the second call
    // resolves to undefined while the first throws 503, and the difference is a
    // one-request account oracle available to anyone who can push Redis over.
    findUnique.mockResolvedValue({ ...RECOVERED });
    setWithTTL.mockRejectedValue(outage());
    redis.exists.mockRejectedValue(outage());
    const real = await forgotPassword({ email: RECOVERED.email }).catch(
      (e) => e,
    );

    findUnique.mockResolvedValue(null);
    const fake = await forgotPassword({ email: 'nobody@example.com' }).catch(
      (e) => e,
    );

    expect(fake.statusCode).toBe(real.statusCode);
    expect(fake.message).toBe(real.message);
    expect(fake.constructor).toBe(real.constructor);
  });

  it('sends no mail when the token could not be stored', async () => {
    findUnique.mockResolvedValue({ ...RECOVERED });
    setWithTTL.mockRejectedValueOnce(outage());

    await forgotPassword({ email: RECOVERED.email }).catch(() => {});

    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('logs the token-write failure at error before converting it', async () => {
    findUnique.mockResolvedValue({ ...RECOVERED });
    setWithTTL.mockRejectedValueOnce(outage());

    await forgotPassword({ email: RECOVERED.email }).catch(() => {});

    expect(logger.child().error).toHaveBeenCalledTimes(1);
  });

  it('still succeeds when only the POINTER write fails', async () => {
    // Best-effort by design: the pointer costs TRD:1477 for a later token, never
    // this one, so the reset must go out.
    findUnique.mockResolvedValue({ ...RECOVERED });
    setWithTTL.mockImplementationOnce(async (key) => {
      writeOrder.push(key);
      return 'OK';
    });
    setWithTTL.mockRejectedValueOnce(outage());

    await expect(
      forgotPassword({ email: RECOVERED.email }),
    ).resolves.toBeUndefined();
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(logger.child().warn).toHaveBeenCalledTimes(1);
  });
});

// ── superseding the previous token (TRD:1477) ───────────────────────────────

describe('forgotPassword — a second request for the same account', () => {
  beforeEach(() => {
    findUnique.mockResolvedValue({ ...RECOVERED });
  });

  it('unlinks the token key the pointer named', async () => {
    const previous = resetKeyFor('the-previous-token');
    redis.getdel.mockResolvedValue(JSON.stringify(previous));

    await forgotPassword({ email: RECOVERED.email });

    expect(redis.getdel).toHaveBeenCalledWith(pointerKeyFor(RECOVERED.id));
    expect(redis.unlink).toHaveBeenCalledWith(previous);
  });

  it('supersedes only AFTER the replacement is stored', async () => {
    // Reversed, a failed write would leave the account with no working token at
    // all — strictly worse than one that is merely older than it should be.
    const previous = resetKeyFor('the-previous-token');
    redis.getdel.mockResolvedValue(JSON.stringify(previous));

    await forgotPassword({ email: RECOVERED.email });

    const token = mailedToken();
    expect(writeOrder).toEqual([
      resetKeyFor(token),
      `UNLINK ${previous}`,
      pointerKeyFor(RECOVERED.id),
    ]);
  });

  it('unlinks nothing when there was no previous token', async () => {
    redis.getdel.mockResolvedValue(null);

    await forgotPassword({ email: RECOVERED.email });

    expect(redis.getdel).toHaveBeenCalledTimes(1);
    expect(redis.unlink).not.toHaveBeenCalled();
  });

  it('REFUSES to unlink a pointer value that is not a reset key', async () => {
    // The attack the shape check exists for. UNLINK has no type check — logout's
    // tests prove it will happily destroy a Set — so a pointer holding a victim's
    // session index would make this route delete every trace of their live
    // sessions and leave a ban unable to revoke them.
    const victimIndex = `session:index:${randomUUID()}`;
    redis.getdel.mockResolvedValue(JSON.stringify(victimIndex));

    await forgotPassword({ email: RECOVERED.email });

    expect(redis.unlink).not.toHaveBeenCalled();
    expect(logger.child().error).toHaveBeenCalledTimes(1);
    // And the reset itself still works — refusing is not failing.
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });

  it('refuses a pointer that names itself', async () => {
    redis.getdel.mockResolvedValue(JSON.stringify(pointerKeyFor(RECOVERED.id)));

    await forgotPassword({ email: RECOVERED.email });

    expect(redis.unlink).not.toHaveBeenCalled();
  });

  it('refuses a pointer whose digest is the wrong shape', async () => {
    // Right prefix, wrong body: 63 hex characters, or non-hex ones.
    for (const bad of [
      'reset:pw:' + 'a'.repeat(63),
      'reset:pw:' + 'g'.repeat(64),
      'reset:pw:',
    ]) {
      vi.clearAllMocks();
      findUnique.mockResolvedValue({ ...RECOVERED });
      redis.getdel.mockResolvedValue(JSON.stringify(bad));

      await forgotPassword({ email: RECOVERED.email });

      expect(redis.unlink).not.toHaveBeenCalled();
    }
  });

  it('refuses a pointer value that is not JSON at all', async () => {
    redis.getdel.mockResolvedValue(resetKeyFor('unquoted-and-so-not-json'));

    await forgotPassword({ email: RECOVERED.email });

    expect(redis.unlink).not.toHaveBeenCalled();
    expect(logger.child().error).toHaveBeenCalledTimes(1);
  });

  it('survives a supersede that throws, and still issues the new token', async () => {
    redis.getdel.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      forgotPassword({ email: RECOVERED.email }),
    ).resolves.toBeUndefined();
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(logger.child().warn).toHaveBeenCalled();
  });
});

// ── reset-password: consuming the token ─────────────────────────────────────

describe('resetPassword — the happy path', () => {
  const TOKEN_STR = 'a'.repeat(64);
  const NEW_PASSWORD = 'BrandNewPassword123';

  beforeEach(() => {
    // JSON, exactly as setWithTTL wrote it — see the header. A test that armed the
    // bare id would pass while production failed on every link.
    redis.getdel.mockResolvedValue(JSON.stringify(RECOVERED.id));
    update.mockResolvedValue({ id: RECOVERED.id });
  });

  it('consumes the token with GETDEL against the digest key', async () => {
    await resetPassword({ token: TOKEN_STR, newPassword: NEW_PASSWORD });

    expect(redis.getdel).toHaveBeenCalledTimes(1);
    expect(redis.getdel).toHaveBeenCalledWith(resetKeyFor(TOKEN_STR));
  });

  it('JSON-parses the stored id before using it as a where clause', async () => {
    await resetPassword({ token: TOKEN_STR, newPassword: NEW_PASSWORD });

    const [{ where }] = update.mock.calls[0];
    expect(where).toEqual({ id: RECOVERED.id });
    // The bug this pins: the quotes surviving into the query.
    expect(where.id).not.toContain('"');
  });

  it('hashes the new password at BCRYPT_ROUNDS and writes only that', async () => {
    await resetPassword({ token: TOKEN_STR, newPassword: NEW_PASSWORD });

    expect(bcrypt.hash).toHaveBeenCalledWith(NEW_PASSWORD, BCRYPT_ROUNDS);

    const [{ data, select }] = update.mock.calls[0];
    expect(Object.keys(data)).toEqual(['passwordHash']);
    expect(data.passwordHash).toBe(
      await bcrypt.hash(NEW_PASSWORD, BCRYPT_ROUNDS),
    );
    expect(JSON.stringify(data)).not.toContain(NEW_PASSWORD);
    expect(select).toEqual({ id: true });
  });

  it('consumes the token BEFORE spending 290 ms on bcrypt', async () => {
    // The single-use window: a GET-then-delete would leave the whole hash
    // duration open for a second replay of the same token.
    let consumedFirst = false;
    bcrypt.hash.mockImplementationOnce(async (pw, rounds) => {
      consumedFirst = redis.getdel.mock.calls.length === 1;
      return `$2a$${rounds}$stub`;
    });

    await resetPassword({ token: TOKEN_STR, newPassword: NEW_PASSWORD });

    expect(consumedFirst).toBe(true);
  });

  it('reports revokedSessions from UNLINK, not from the member count', async () => {
    // Measured against redis 7.4.9: three keys passed, two present, returns 2 —
    // the index is a superset, so counting members over-reports the revocation.
    const jtis = [randomUUID(), randomUUID(), randomUUID()];
    redis.smembers.mockResolvedValue(jtis);
    redis.unlink.mockResolvedValueOnce(2);

    const result = await resetPassword({
      token: TOKEN_STR,
      newPassword: NEW_PASSWORD,
    });

    expect(result).toEqual({ revokedSessions: 2 });
    expect(result.revokedSessions).not.toBe(jtis.length);
  });

  it('unlinks every session key in the index in one command', async () => {
    const jtis = [randomUUID(), randomUUID()];
    redis.smembers.mockResolvedValue(jtis);

    await resetPassword({ token: TOKEN_STR, newPassword: NEW_PASSWORD });

    expect(redis.smembers).toHaveBeenCalledWith(
      `session:index:${RECOVERED.id}`,
    );
    expect(redis.unlink).toHaveBeenCalledWith(
      `session:${jtis[0]}`,
      `session:${jtis[1]}`,
    );
  });

  it('changes the password BEFORE revoking, so the old one buys nothing', async () => {
    // TRD:1476 read strictly. Revoking first leaves an interval in which the old
    // password still logs in and mints a session the sweep has already passed.
    //
    // Sampled at EVERY session-store touch, not at the last one. A single flag
    // assigned inside the SMEMBERS mock is not enough: measured, a mutant that
    // revoked early and then swept again late overwrote the flag with the
    // reassuring value on its second call and survived. Every touch must see the
    // update already done, so an early one cannot be papered over by a late one.
    const updatesAtTouch = [];
    redis.smembers.mockImplementation(async () => {
      updatesAtTouch.push(update.mock.calls.length);
      return [randomUUID()];
    });
    redis.unlink.mockImplementation(async (...args) => {
      updatesAtTouch.push(update.mock.calls.length);
      writeOrder.push(`UNLINK ${args.join(' ')}`);
      return 0;
    });

    await resetPassword({ token: TOKEN_STR, newPassword: NEW_PASSWORD });

    // toEqual over .every() so a failure prints WHICH touch was early: the diff
    // reads [0, 1, 1] against [1, 1, 1] rather than false against true.
    expect(updatesAtTouch).not.toHaveLength(0);
    expect(updatesAtTouch).toEqual(updatesAtTouch.map(() => 1));
  });

  it('clears the index Set and the pointer once the sessions are gone', async () => {
    const jti = randomUUID();
    redis.smembers.mockResolvedValue([jti]);

    await resetPassword({ token: TOKEN_STR, newPassword: NEW_PASSWORD });

    expect(writeOrder).toEqual([
      `UNLINK session:${jti}`,
      `UNLINK session:index:${RECOVERED.id} ${pointerKeyFor(RECOVERED.id)}`,
    ]);
  });

  it('issues no UNLINK at all for an account with no sessions', async () => {
    // Measured: UNLINK with no arguments throws "wrong number of arguments", so
    // the length guard is required rather than defensive — and an empty index is
    // the ordinary case for an account that never logged in.
    redis.smembers.mockResolvedValue([]);

    const result = await resetPassword({
      token: TOKEN_STR,
      newPassword: NEW_PASSWORD,
    });

    expect(result).toEqual({ revokedSessions: 0 });
    // The only UNLINK is the housekeeping one, which always has two arguments.
    expect(redis.unlink).toHaveBeenCalledTimes(1);
    expect(redis.unlink.mock.calls[0]).toHaveLength(2);
  });

  it('skips an index member that cannot become a key, and revokes the rest', async () => {
    // A poison pill otherwise: a forged member would fail every future reset for
    // that account rather than being stepped over once.
    const good = randomUUID();
    redis.smembers.mockResolvedValue([good, 'index:someone-else', 'a:b']);
    redis.unlink.mockResolvedValueOnce(1);

    const result = await resetPassword({
      token: TOKEN_STR,
      newPassword: NEW_PASSWORD,
    });

    expect(result).toEqual({ revokedSessions: 1 });
    expect(redis.unlink).toHaveBeenNthCalledWith(1, `session:${good}`);
    expect(logger.child().warn).toHaveBeenCalledTimes(1);
  });

  it('survives housekeeping that fails, since both keys are already inert', async () => {
    redis.smembers.mockResolvedValue([randomUUID()]);
    redis.unlink
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await resetPassword({
      token: TOKEN_STR,
      newPassword: NEW_PASSWORD,
    });

    expect(result).toEqual({ revokedSessions: 1 });
    expect(logger.child().warn).toHaveBeenCalledTimes(1);
  });
});

// ── reset-password: every token it will not accept ──────────────────────────

describe('resetPassword — a token it refuses', () => {
  const NEW_PASSWORD = 'BrandNewPassword123';
  const expectTokenInvalid = (err) => {
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe(MESSAGES.VALIDATION.TOKEN_INVALID);
    expect(err.isOperational).toBe(true);
  };

  it('refuses an unknown, expired or already-used token with one 400', async () => {
    redis.getdel.mockResolvedValue(null);

    const err = await resetPassword({
      token: 'a'.repeat(64),
      newPassword: NEW_PASSWORD,
    }).catch((e) => e);

    expectTokenInvalid(err);
  });

  it('gives the same answer to all three, so a token cannot be probed', async () => {
    // One message for unknown / expired / consumed is the contract
    // MESSAGES.VALIDATION.TOKEN_INVALID's own comment fixes. All three arrive
    // here as the same `null`, which is exactly why they cannot be told apart.
    redis.getdel.mockResolvedValue(null);
    const first = await resetPassword({
      token: 'a'.repeat(64),
      newPassword: NEW_PASSWORD,
    }).catch((e) => e);
    const second = await resetPassword({
      token: 'b'.repeat(64),
      newPassword: NEW_PASSWORD,
    }).catch((e) => e);

    expect(first.message).toBe(second.message);
    expect(first.statusCode).toBe(second.statusCode);
  });

  it.each([
    ['', 'empty'],
    [null, 'null'],
    [undefined, 'absent'],
    [{}, 'an object'],
  ])('refuses %s (%s) without touching Redis', async (token) => {
    const err = await resetPassword({ token, newPassword: NEW_PASSWORD }).catch(
      (e) => e,
    );

    expectTokenInvalid(err);
    expect(redis.getdel).not.toHaveBeenCalled();
    expect(bcrypt.hash).not.toHaveBeenCalled();
  });

  it('hashes nothing and updates nothing when the token is refused', async () => {
    redis.getdel.mockResolvedValue(null);

    await resetPassword({
      token: 'a'.repeat(64),
      newPassword: NEW_PASSWORD,
    }).catch(() => {});

    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(redis.smembers).not.toHaveBeenCalled();
  });

  it('answers 503, NOT 400, when GETDEL itself fails', async () => {
    // The distinction matters: a 400 would tell a user with a perfectly good link
    // that their link is broken, and they would request another one into the same
    // outage. TRD:1478 makes reset fail closed.
    redis.getdel.mockRejectedValue(new Error('ECONNREFUSED'));

    const err = await resetPassword({
      token: 'a'.repeat(64),
      newPassword: NEW_PASSWORD,
    }).catch((e) => e);

    expect(err.statusCode).toBe(503);
    expect(err.message).toBe(MESSAGES.COMMON.SERVICE_UNAVAILABLE);
    expect(bcrypt.hash).not.toHaveBeenCalled();
  });

  it.each([
    ['not JSON at all', 'raw-user-id-without-quotes'],
    ['a JSON number', '42'],
    ['a JSON null', 'null'],
    ['a JSON object', '{"id":"x"}'],
    ['an empty JSON string', '""'],
  ])('refuses a stored value that is %s', async (_label, stored) => {
    redis.getdel.mockResolvedValue(stored);

    const err = await resetPassword({
      token: 'a'.repeat(64),
      newPassword: NEW_PASSWORD,
    }).catch((e) => e);

    expectTokenInvalid(err);
    expect(update).not.toHaveBeenCalled();
    // Corruption in a namespace only this module writes — the operator has to see
    // it even though the caller is told nothing.
    expect(logger.child().error).toHaveBeenCalledTimes(1);
  });
});

// ── reset-password: the account, and the sweep that must not be silent ───────

describe('resetPassword — the account and the sweep', () => {
  const TOKEN_STR = 'a'.repeat(64);
  const NEW_PASSWORD = 'BrandNewPassword123';

  beforeEach(() => {
    redis.getdel.mockResolvedValue(JSON.stringify(RECOVERED.id));
  });

  it('refuses a valid token whose account has been hard-deleted (P2025)', async () => {
    // Measured: update against an absent id raises P2025 rather than returning
    // null. Answered as an invalid token, because a distinct message would confirm
    // the address once belonged to an account.
    const err = await resetPassword({
      token: TOKEN_STR,
      newPassword: NEW_PASSWORD,
    }).catch((e) => e);

    expect(err.statusCode).toBe(400);
    expect(err.message).toBe(MESSAGES.VALIDATION.TOKEN_INVALID);
    expect(redis.smembers).not.toHaveBeenCalled();
  });

  it('refuses a valid token whose stored id is not a UUID (P2023)', async () => {
    // Added while measuring 3.8, which hit this on the identical code path: an id
    // that is not a UUID raises P2023 ("Inconsistent column data"), NOT P2025, and
    // the `typeof userId === 'string'` guard cannot exclude it because a corrupted
    // value like "not-a-uuid" is a perfectly good non-empty string. Before the
    // branch existed this answered 500 rather than the 400 every other unusable
    // token answers.
    const malformed = new Error(
      'Inconsistent column data: Error creating UUID, invalid character',
    );
    malformed.code = 'P2023';
    update.mockRejectedValue(malformed);
    redis.getdel.mockResolvedValue(JSON.stringify('not-a-uuid'));

    const err = await resetPassword({
      token: TOKEN_STR,
      newPassword: NEW_PASSWORD,
    }).catch((e) => e);

    expect(err.statusCode).toBe(400);
    expect(err.message).toBe(MESSAGES.VALIDATION.TOKEN_INVALID);
    expect(err.isOperational).toBe(true);
    expect(redis.smembers).not.toHaveBeenCalled();
    expect(logger.child().error).toHaveBeenCalledTimes(1);
  });

  it('rethrows a Prisma error that is not P2025 unchanged', async () => {
    const boom = new Error('connection terminated');
    boom.code = 'P1001';
    update.mockRejectedValue(boom);

    const err = await resetPassword({
      token: TOKEN_STR,
      newPassword: NEW_PASSWORD,
    }).catch((e) => e);

    expect(err).toBe(boom);
    expect(err.statusCode).toBeUndefined();
  });

  it('answers 503 when the session sweep cannot be completed', async () => {
    // Fatal here, where the same failure in logout() is a 200: TRD:1476 makes
    // revocation part of what a reset IS, and the caller is usually someone who
    // believes they are compromised. Reporting success would tell them the
    // attacker is gone while the attacker still holds a redeemable token.
    update.mockResolvedValue({ id: RECOVERED.id });
    redis.smembers.mockRejectedValue(new Error('ECONNREFUSED'));

    const err = await resetPassword({
      token: TOKEN_STR,
      newPassword: NEW_PASSWORD,
    }).catch((e) => e);

    expect(err.statusCode).toBe(503);
    expect(err.message).toBe(MESSAGES.COMMON.SERVICE_UNAVAILABLE);
    expect(logger.child().error).toHaveBeenCalledTimes(1);
  });

  it('answers 503 when the session UNLINK fails', async () => {
    update.mockResolvedValue({ id: RECOVERED.id });
    redis.smembers.mockResolvedValue([randomUUID()]);
    redis.unlink.mockRejectedValue(new Error('ECONNREFUSED'));

    const err = await resetPassword({
      token: TOKEN_STR,
      newPassword: NEW_PASSWORD,
    }).catch((e) => e);

    expect(err.statusCode).toBe(503);
  });

  it('leaves the password CHANGED when the sweep 503s', async () => {
    // The 503 reports a partial success truthfully; it does not undo the update,
    // and it must not, because the token is already spent.
    update.mockResolvedValue({ id: RECOVERED.id });
    redis.smembers.mockRejectedValue(new Error('ECONNREFUSED'));

    await resetPassword({
      token: TOKEN_STR,
      newPassword: NEW_PASSWORD,
    }).catch(() => {});

    expect(update).toHaveBeenCalledTimes(1);
    expect(bcrypt.hash).toHaveBeenCalledTimes(1);
  });

  it('does not rewrite user:state — a password changes none of its fields', async () => {
    update.mockResolvedValue({ id: RECOVERED.id });

    await resetPassword({ token: TOKEN_STR, newPassword: NEW_PASSWORD });

    const stateWrites = setWithTTL.mock.calls.filter(([key]) =>
      String(key).startsWith('user:state:'),
    );
    expect(stateWrites).toEqual([]);
  });

  it('takes the account from the token, never from a caller-supplied id', async () => {
    // The reason the stored value is the only source: an `id` in the payload would
    // let anyone holding one valid token reset any account.
    update.mockResolvedValue({ id: RECOVERED.id });

    await resetPassword({
      token: TOKEN_STR,
      newPassword: NEW_PASSWORD,
      userId: 'attacker-chosen-id',
    });

    expect(update.mock.calls[0][0].where).toEqual({ id: RECOVERED.id });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Email verification — task 3.8
//
// The digest is recomputed with createHash rather than by calling
// keys.emailVerify(), for the reason the 3.7 block already gives: asking the
// builder to confirm its own output proves only that it is deterministic.
//
// One claim runs through nearly every test below and is the whole reason 3.8's
// shape differs from 3.7's: the token is NOT consumed unless the flag was
// committed. There is no resend-verification endpoint anywhere in apidoc, so a
// token destroyed by a later failure cannot be replaced, and TRD:1482 refuses
// enrollments, course creation and quiz attempts for the life of the account.
// Every refusal below therefore asserts `redis.unlink` was not called — that
// assertion is the test of the GET-instead-of-GETDEL decision, not decoration.
// ─────────────────────────────────────────────────────────────────────────────

const verifyKeyFor = (token) =>
  `verify:email:${createHash('sha256').update(token, 'utf8').digest('hex')}`;

/**
 * The row the update returns: exactly VERIFIED_STATE_FIELDS, with the flag
 * already true because the write set it.
 */
const VERIFYING = Object.freeze({
  id: '77777777-6666-5555-4444-333333333333',
  role: UserRole.STUDENT,
  isBanned: false,
  isEmailVerified: true,
  deletedAt: null,
});

const VERIFY_TOKEN = 'c'.repeat(64);

// ── verify-email: the happy path ─────────────────────────────────────────────

describe('verifyEmail — the happy path', () => {
  beforeEach(() => {
    redis.get.mockResolvedValue(JSON.stringify(VERIFYING.id));
    update.mockResolvedValue({ ...VERIFYING });
    // 1, not the file-wide default of 0: measured against Redis 7.4.9, UNLINK
    // answers 1 when this call removed the key and 0 when it was already gone. The
    // default models the raced case, which has its own test below, so the ordinary
    // one has to say so explicitly.
    redis.unlink.mockResolvedValue(1);
  });

  it('reads verify:email:<sha256(token)> and never the raw token', async () => {
    await verifyEmail({ token: VERIFY_TOKEN });

    expect(redis.get).toHaveBeenCalledTimes(1);
    expect(redis.get).toHaveBeenCalledWith(verifyKeyFor(VERIFY_TOKEN));
    // TRD:1474. Stronger than matching the digest shape: this fails if the key ever
    // carries the token itself, which a `verify:email:${token}` typo would produce
    // while still looking like a 64-character hex suffix.
    expect(redis.get.mock.calls[0][0]).not.toContain(VERIFY_TOKEN);
  });

  it('reads the token WITHOUT consuming it — GET, never GETDEL', async () => {
    // The single line the whole asymmetry with resetPassword() lives on. A GETDEL
    // here would still pass every other test in this block, because the happy path
    // deletes the key either way; only this assertion separates them.
    await verifyEmail({ token: VERIFY_TOKEN });

    expect(redis.getdel).not.toHaveBeenCalled();
  });

  it('sets isEmailVerified on the account the token names, and nothing else', async () => {
    await verifyEmail({ token: VERIFY_TOKEN });

    expect(update).toHaveBeenCalledTimes(1);
    const [{ where, data }] = update.mock.calls[0];
    expect(where).toEqual({ id: VERIFYING.id, deletedAt: null });
    // Exhaustive rather than a property check: a write that also touched `role` or
    // `isBanned` would be a privilege escalation reachable from an emailed link.
    expect(data).toEqual({ isEmailVerified: true });
  });

  it('excludes soft-deleted accounts in the where-clause, not after the fact', async () => {
    // Measured against Prisma 6.19: a non-unique filter is accepted in update()'s
    // where-clause, and a row it excludes raises P2025 with the flag left false. The
    // alternative — read, check deletedAt in JS, then write — is two round trips
    // with a window between them.
    await verifyEmail({ token: VERIFY_TOKEN });

    const { where } = update.mock.calls[0][0];
    expect(where).toHaveProperty('deletedAt', null);
  });

  it('never asks the database for passwordHash or email', async () => {
    await verifyEmail({ token: VERIFY_TOKEN });

    const { select } = update.mock.calls[0][0];
    expect(Object.keys(select).sort()).toEqual([
      'deletedAt',
      'id',
      'isBanned',
      'isEmailVerified',
      'role',
    ]);
  });

  it('returns nothing at all', async () => {
    // apidoc §8.2's 200 row for this route specifies no `data`, and the flag is the
    // outcome. Returning the row would put role and isBanned one careless
    // controller away from an unauthenticated response body.
    await expect(verifyEmail({ token: VERIFY_TOKEN })).resolves.toBeUndefined();
  });

  it('consumes the token only AFTER the flag is committed', async () => {
    // Sampled at EVERY touch of the verify key, not at the last one — the lesson
    // 3.7's ordering test learned the hard way, where a mutant that acted early and
    // then acted again late overwrote a single flag with the reassuring value.
    //
    // Ordering is the design decision this test exists for: consuming first, as
    // resetPassword() does, means any later failure destroys a token that CANNOT be
    // reissued, because no resend-verification endpoint exists.
    const updatesAtUnlink = [];
    redis.unlink.mockImplementation(async () => {
      updatesAtUnlink.push(update.mock.calls.length);
      return 1;
    });

    await verifyEmail({ token: VERIFY_TOKEN });

    expect(updatesAtUnlink).toEqual([1]);
    expect(redis.unlink).toHaveBeenCalledWith(verifyKeyFor(VERIFY_TOKEN));
  });

  it('reads the token before it writes the row', async () => {
    const order = [];
    redis.get.mockImplementation(async () => {
      order.push('GET');
      return JSON.stringify(VERIFYING.id);
    });
    update.mockImplementation(async () => {
      order.push('UPDATE');
      return { ...VERIFYING };
    });
    setWithTTL.mockImplementation(async () => {
      order.push('SET user:state');
      return 'OK';
    });
    redis.unlink.mockImplementation(async () => {
      order.push('UNLINK');
      return 1;
    });

    await verifyEmail({ token: VERIFY_TOKEN });

    expect(order).toEqual(['GET', 'UPDATE', 'UNLINK', 'SET user:state']);
  });

  it('rewrites user:state for TTL.userState so the flag is visible at once', async () => {
    // plan:349's reason for existing. Without this the account is verified in
    // PostgreSQL and still refused by requireVerifiedEmail for up to 15 minutes,
    // which reads to the user as a verification link that did not work.
    await verifyEmail({ token: VERIFY_TOKEN });

    const stateWrites = setWithTTL.mock.calls.filter(([key]) =>
      String(key).startsWith('user:state:'),
    );
    expect(stateWrites).toHaveLength(1);
    const [key, value, ttl] = stateWrites[0];
    expect(key).toBe(`user:state:${VERIFYING.id}`);
    expect(value).toEqual({
      role: VERIFYING.role,
      isBanned: false,
      isEmailVerified: true,
      deletedAt: null,
    });
    expect(ttl).toBe(TTL.userState);
    expect(ttl).toBe(15 * 60);
  });

  it('takes every user:state field from the updated row, not from constants', async () => {
    // A record assembled from literals — `{ role: 'STUDENT', isBanned: false, ... }`
    // — passes the test above and is a privilege bug: it would hand a banned
    // instructor an unbanned STUDENT fast-path record for 15 minutes. Only fields
    // that could not have been guessed prove the row is the source.
    update.mockResolvedValue({
      ...VERIFYING,
      role: UserRole.INSTRUCTOR,
      isBanned: true,
    });

    await verifyEmail({ token: VERIFY_TOKEN });

    const [, value] = setWithTTL.mock.calls.find(([key]) =>
      String(key).startsWith('user:state:'),
    );
    expect(value.role).toBe(UserRole.INSTRUCTOR);
    expect(value.isBanned).toBe(true);
  });

  it('takes the account from the token, never from a caller-supplied id', async () => {
    // The same claim resetPassword() makes: an `id` in the payload would let anyone
    // holding one valid token verify any account.
    await verifyEmail({ token: VERIFY_TOKEN, userId: 'attacker-chosen-id' });

    expect(update.mock.calls[0][0].where.id).toBe(VERIFYING.id);
  });

  it('touches no session and sends no email', async () => {
    // Verification is not a session event: unlike a password reset it invalidates
    // nothing, so sweeping the index would log the user out of every device for
    // clicking a link. And re-sending the verification email from the endpoint that
    // just consumed the token would be an unauthenticated mail amplifier.
    await verifyEmail({ token: VERIFY_TOKEN });

    expect(redis.smembers).not.toHaveBeenCalled();
    expect(redis.srem).not.toHaveBeenCalled();
    expect(redis.sadd).not.toHaveBeenCalled();
    expect(sendVerificationEmail).not.toHaveBeenCalled();
    expect(redis.unlink).toHaveBeenCalledTimes(1);
  });

  it('logs the success once, recording that the state write landed', async () => {
    await verifyEmail({ token: VERIFY_TOKEN });

    expect(logger.child().warn).not.toHaveBeenCalled();
    expect(logger.child().error).not.toHaveBeenCalled();
    expect(logger.child().info).toHaveBeenCalledTimes(1);
    expect(logger.child().info.mock.calls[0][0]).toMatchObject({
      userId: VERIFYING.id,
      stateRewritten: true,
    });
  });
});

// ── verify-email: every token it refuses, and the one it preserves ───────────

describe('verifyEmail — a token it refuses', () => {
  const expectTokenInvalid = (err) => {
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe(MESSAGES.VALIDATION.TOKEN_INVALID);
    expect(err.isOperational).toBe(true);
  };

  it.each([
    ['', 'empty'],
    [null, 'null'],
    [undefined, 'absent'],
    [{}, 'an object'],
    [64, 'a number'],
  ])('refuses %s (%s) without touching Redis', async (token) => {
    // keys.emailVerify() throws a TypeError on all five, and that has to surface as
    // this caller's 400 rather than being caught by the Redis handler below and
    // mislabelled as an outage — which would answer 503 and invite a retry.
    const err = await verifyEmail({ token }).catch((e) => e);

    expectTokenInvalid(err);
    expect(redis.get).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses an unknown, expired or already-consumed token with one 400', async () => {
    // apidoc:301's three causes arrive here as the same `null`, which is exactly why
    // they cannot be told apart.
    redis.get.mockResolvedValue(null);

    const err = await verifyEmail({ token: VERIFY_TOKEN }).catch((e) => e);

    expectTokenInvalid(err);
    expect(update).not.toHaveBeenCalled();
    expect(redis.unlink).not.toHaveBeenCalled();
    // At no log level at all. An expired link is the single most ordinary way this
    // endpoint is reached, and it says nothing about the health of the system; a
    // service that fell through to the corruption branch below would answer the same
    // 400 while filing every stale link as an operator problem. Measured — that
    // mutant survives every other assertion in this block.
    expect(logger.child().error).not.toHaveBeenCalled();
    expect(logger.child().warn).not.toHaveBeenCalled();
  });

  it('gives two different unknown tokens the same answer', async () => {
    redis.get.mockResolvedValue(null);

    const first = await verifyEmail({ token: 'a'.repeat(64) }).catch((e) => e);
    const second = await verifyEmail({ token: 'b'.repeat(64) }).catch((e) => e);

    expect(first.message).toBe(second.message);
    expect(first.statusCode).toBe(second.statusCode);
  });

  it.each([
    ['not JSON at all', 'raw-user-id-without-quotes'],
    ['a JSON number', '42'],
    ['a JSON null', 'null'],
    ['a JSON object', '{"id":"x"}'],
    ['an empty JSON string', '""'],
  ])('refuses a stored value that is %s', async (_label, stored) => {
    redis.get.mockResolvedValue(stored);

    const err = await verifyEmail({ token: VERIFY_TOKEN }).catch((e) => e);

    expectTokenInvalid(err);
    expect(update).not.toHaveBeenCalled();
    // Corruption in a namespace only register() writes — the operator has to see it
    // even though the caller is told nothing.
    expect(logger.child().error).toHaveBeenCalledTimes(1);
  });

  it('refuses a token whose account was hard-deleted (P2025)', async () => {
    // The residual named at auth.service.js:45 — a token that outlived a rolled-back
    // COMMIT. Warned rather than errored: it is a state the design allows for, and
    // it self-heals when the 24h TTL expires.
    redis.get.mockResolvedValue(JSON.stringify(VERIFYING.id));

    const err = await verifyEmail({ token: VERIFY_TOKEN }).catch((e) => e);

    expectTokenInvalid(err);
    expect(logger.child().warn).toHaveBeenCalledTimes(1);
    expect(logger.child().error).not.toHaveBeenCalled();
  });

  it('refuses a token whose account is soft-deleted, which arrives as the same P2025', async () => {
    // Measured: `where: { id, deletedAt: null }` against a soft-deleted row raises
    // P2025 and leaves the flag false. The service cannot distinguish this from a
    // missing row, and deliberately does not try — both answer 400.
    redis.get.mockResolvedValue(JSON.stringify(VERIFYING.id));
    const excluded = new Error(
      'An operation failed because it depends on one or more records that were required but not found.',
    );
    excluded.code = 'P2025';
    update.mockRejectedValue(excluded);

    const err = await verifyEmail({ token: VERIFY_TOKEN }).catch((e) => e);

    expectTokenInvalid(err);
  });

  it('refuses a stored id that is not a UUID (P2023), not a 500', async () => {
    // Measured, and not anticipated: Prisma raises P2023 rather than P2025 for an id
    // that is not a UUID, and the string guard cannot exclude it because
    // "not-a-uuid" is a perfectly good non-empty string. Without the branch this is
    // an unhandled Prisma error and the caller reads Internal Server Error.
    redis.get.mockResolvedValue(JSON.stringify('not-a-uuid'));
    const malformed = new Error(
      'Inconsistent column data: Error creating UUID, invalid character',
    );
    malformed.code = 'P2023';
    update.mockRejectedValue(malformed);

    const err = await verifyEmail({ token: VERIFY_TOKEN }).catch((e) => e);

    expectTokenInvalid(err);
    expect(logger.child().error).toHaveBeenCalledTimes(1);
  });

  it('rethrows a Prisma error that is neither P2025 nor P2023 unchanged', async () => {
    redis.get.mockResolvedValue(JSON.stringify(VERIFYING.id));
    const boom = new Error('connection terminated');
    boom.code = 'P1001';
    update.mockRejectedValue(boom);

    const err = await verifyEmail({ token: VERIFY_TOKEN }).catch((e) => e);

    expect(err).toBe(boom);
    expect(err.statusCode).toBeUndefined();
  });

  it('answers 503, NOT 400, when the GET itself fails', async () => {
    // TRD:1478 makes this path fail closed. A 400 would tell a user holding a
    // perfectly good link that the link is broken — and since no endpoint reissues
    // one, that is a dead end rather than an inconvenience.
    redis.get.mockRejectedValue(new Error('ECONNREFUSED'));

    const err = await verifyEmail({ token: VERIFY_TOKEN }).catch((e) => e);

    expect(err.statusCode).toBe(503);
    expect(err.message).toBe(MESSAGES.COMMON.SERVICE_UNAVAILABLE);
    expect(update).not.toHaveBeenCalled();
    expect(logger.child().error).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the token is unknown', async () => redis.get.mockResolvedValue(null)],
    [
      'the stored value is corrupt',
      async () => redis.get.mockResolvedValue('42'),
    ],
    [
      'the account is gone',
      async () => redis.get.mockResolvedValue(JSON.stringify(VERIFYING.id)),
    ],
    [
      'Redis cannot be read',
      async () => redis.get.mockRejectedValue(new Error('ECONNREFUSED')),
    ],
  ])('leaves the token in Redis when %s', async (_label, arrange) => {
    // The point of GET-then-UNLINK, asserted on every refusal branch at once. If any
    // of these consumed the token, a transient failure would permanently strip the
    // account of the only way it can ever be verified: TRD:1482 then refuses
    // enrollments, course creation and quiz attempts for the life of the account,
    // and re-registering the same address is register()'s 409.
    await arrange();

    await verifyEmail({ token: VERIFY_TOKEN }).catch(() => {});

    expect(redis.unlink).not.toHaveBeenCalled();
    expect(redis.getdel).not.toHaveBeenCalled();
    // And no fast-path record either: a refusal must not publish a user:state entry
    // for an account it just declined to verify.
    expect(setWithTTL).not.toHaveBeenCalled();
  });
});

// ── verify-email: what it deliberately does not refuse ───────────────────────

describe('verifyEmail — what it allows on purpose', () => {
  beforeEach(() => {
    redis.get.mockResolvedValue(JSON.stringify(VERIFYING.id));
    redis.unlink.mockResolvedValue(1);
  });

  it('succeeds for an account that was already verified', async () => {
    // Idempotent by construction: `data: { isEmailVerified: true }` is a no-op write
    // on a row that already says true, so a replayed link earns the same 200. A
    // "you have already verified" refusal would need a read-then-branch, and would
    // turn the ordinary case of a user clicking the link twice into an error.
    update.mockResolvedValue({ ...VERIFYING, isEmailVerified: true });

    await expect(verifyEmail({ token: VERIFY_TOKEN })).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('lets a BANNED account verify, and records the ban in user:state', async () => {
    // Refusing here would make an unauthenticated route into a ban oracle: anyone
    // holding a link would learn the account's moderation status. login()'s 403
    // enforces the ban and charges a correct password for the answer, which is where
    // that belongs. Verification changes nothing a banned account can do.
    update.mockResolvedValue({ ...VERIFYING, isBanned: true });

    await expect(verifyEmail({ token: VERIFY_TOKEN })).resolves.toBeUndefined();

    const [, value] = setWithTTL.mock.calls.find(([key]) =>
      String(key).startsWith('user:state:'),
    );
    // The rewrite must not un-ban anyone: it carries the row's isBanned forward, so
    // the fast path stays as restrictive as PostgreSQL is.
    expect(value.isBanned).toBe(true);
  });
});

// ── verify-email: the two best-effort steps, and the one that is not ──────────

describe('verifyEmail — after the flag is committed', () => {
  beforeEach(() => {
    redis.get.mockResolvedValue(JSON.stringify(VERIFYING.id));
    update.mockResolvedValue({ ...VERIFYING });
    redis.unlink.mockResolvedValue(1);
  });

  it('still succeeds when the token cannot be deleted', async () => {
    // The row is committed, so the request succeeded. A 503 here would report
    // failure for a success and send the caller back to a link that now works —
    // except they have been told it did not.
    redis.unlink.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(verifyEmail({ token: VERIFY_TOKEN })).resolves.toBeUndefined();
    expect(logger.child().warn).toHaveBeenCalledTimes(1);
  });

  it('rewrites user:state even when the token deletion failed', async () => {
    // Ordering, not politeness: the state rewrite is what makes the flag visible, so
    // it must not be skipped by a failure in the step before it.
    redis.unlink.mockRejectedValue(new Error('ECONNREFUSED'));

    await verifyEmail({ token: VERIFY_TOKEN });

    expect(
      setWithTTL.mock.calls.filter(([key]) =>
        String(key).startsWith('user:state:'),
      ),
    ).toHaveLength(1);
  });

  it('warns when UNLINK returns 0, which is the concurrent-replay trace', async () => {
    // Measured: 0 means the key was already gone, so a second request carrying the
    // same token passed its GET inside this one's window. Harmless — both set the
    // same flag — but it is the only visible trace of the race.
    redis.unlink.mockResolvedValue(0);

    await expect(verifyEmail({ token: VERIFY_TOKEN })).resolves.toBeUndefined();
    expect(logger.child().warn).toHaveBeenCalledTimes(1);
  });

  it('says nothing when UNLINK returns 1', async () => {
    // The other half of the assertion above: without this, a service that warned
    // unconditionally would pass it and fill the log with a race that never happened.
    redis.unlink.mockResolvedValue(1);

    await verifyEmail({ token: VERIFY_TOKEN });

    expect(logger.child().warn).not.toHaveBeenCalled();
  });

  it('still succeeds when user:state cannot be rewritten', async () => {
    // Both failure modes of a missing or stale record are MORE restrictive than the
    // truth — a miss falls through to PostgreSQL, a stale record gates the account
    // for at most 15 more minutes — so neither justifies failing a request whose
    // token has just been consumed.
    setWithTTL.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(verifyEmail({ token: VERIFY_TOKEN })).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledTimes(1);
    expect(logger.child().warn).toHaveBeenCalledTimes(1);
  });

  it('does not claim the state was rewritten when it was not', async () => {
    // The success line is what an operator reads when a verified user still cannot
    // enrol. Logging "state rewritten" on the branch that just warned it could not
    // be rewritten would point that investigation away from the only fault.
    setWithTTL.mockRejectedValue(new Error('ECONNREFUSED'));

    await verifyEmail({ token: VERIFY_TOKEN });

    expect(logger.child().info.mock.calls[0][0].stateRewritten).toBe(false);
  });

  it('survives both best-effort steps failing at once', async () => {
    redis.unlink.mockRejectedValue(new Error('ECONNREFUSED'));
    setWithTTL.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(verifyEmail({ token: VERIFY_TOKEN })).resolves.toBeUndefined();
    expect(logger.child().warn).toHaveBeenCalledTimes(2);
  });
});

// ── the cookie clear 3.9 owes plan:347 ──────────────────────────────────────

describe('the refresh cookie can actually be cleared', () => {
  // Not a test of this service — logout() has no `res`. It pins the two
  // assumptions logout()'s header makes about express, because both fail
  // SILENTLY: a cookie that is not cleared raises no error anywhere, and the bug
  // surfaces only as a "logged out" browser that can still refresh. 3.9 will own
  // the real assertion; until it exists, these are what would catch an express
  // upgrade that changed clearCookie's handling of maxAge or of Path.
  const emitted = async (handler) => {
    const express = (await import('express')).default;
    const request = (await import('supertest')).default;
    const app = express();
    app.post('/t', (_req, res) => {
      handler(res);
      res.status(204).end();
    });
    const res = await request(app).post('/t');
    return res.headers['set-cookie'][0];
  };

  it('expires in the PAST even though REFRESH_COOKIE.options carries maxAge', async () => {
    // clearCookie is built on res.cookie, which derives `expires` FROM maxAge. If
    // express stopped deleting it first, this call would set a cookie expiring
    // seven days in the future and clear nothing at all.
    const header = await emitted((res) =>
      res.clearCookie(REFRESH_COOKIE.name, REFRESH_COOKIE.options),
    );

    const expires = new Date(/Expires=([^;]+)/.exec(header)[1]);
    expect(expires.getTime()).toBeLessThan(Date.now());
    expect(header).not.toMatch(/Max-Age/i);
    expect(header).toMatch(/^refreshToken=;/);
  });

  it('keeps the Path that identifies the cookie, which the default would lose', async () => {
    // plan:347's "the SAME Path=/api/v1/auth attribute it was set with". A cookie
    // is identified by name plus Path plus Domain, so clearCookie's own default of
    // '/' does not match the one login() set and does not remove it.
    const withOptions = await emitted((res) =>
      res.clearCookie(REFRESH_COOKIE.name, REFRESH_COOKIE.options),
    );
    const withoutOptions = await emitted((res) =>
      res.clearCookie(REFRESH_COOKIE.name),
    );

    expect(withOptions).toMatch(/Path=\/api\/v1\/auth/);
    expect(withOptions).toMatch(/HttpOnly/);
    expect(withOptions).toMatch(/SameSite=Strict/);
    expect(withoutOptions).toMatch(/Path=\/;/);
    expect(withoutOptions).not.toMatch(/api\/v1\/auth/);
  });
});
