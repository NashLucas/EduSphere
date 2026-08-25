// ─────────────────────────────────────────────────────────────────────────────
// Auth service unit tests — plan:179 and plan:1032 ("service-layer unit tests
// are written in the module's tests/ folder the same day the service lands").
// Task 3.3 is the first service to land, so this is the first such file; 3.4 adds
// the login() blocks below register()'s, and 3.5 the refresh() blocks below those.
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

/**
 * How many transactions are open right now — 1 while the callback is running.
 *
 * This is what lets a test distinguish "written inside the transaction" from
 * "written after the commit", which is otherwise invisible on the happy path.
 */
let txDepth = 0;

const prismaMock = {
  user: { findUnique, create },
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

// SADD, GETDEL and SREM are the Redis commands this module issues directly;
// everything else goes through cache-keys.js, whose setWithTTL is mocked below.
// Importing the real client would be harmless (lazyConnect opens no socket) but
// would leave the index write and the rotation gate unobservable.
//
// `getdel` defaults to null — an ABSENT session — so a refresh test that forgets
// to arm a live session fails as an unauthenticated one rather than passing on a
// mock's convenient truthiness.
vi.mock('../../../config/redis.js', () => {
  const client = {
    sadd: vi.fn(async () => 1),
    getdel: vi.fn(async () => null),
    srem: vi.fn(async () => 1),
  };
  return { redis: client, default: client };
});

vi.mock('../../../utils/cache-keys.js', async (importOriginal) => ({
  ...(await importOriginal()),
  setWithTTL: vi.fn(async () => 'OK'),
}));

vi.mock('../../../integrations/email/index.js', () => ({
  sendVerificationEmail: vi.fn(),
}));

vi.mock('../../../middlewares/logging.middleware.js', () => {
  const child = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  return { logger: { child: () => child, ...child } };
});

const bcrypt = (await import('bcryptjs')).default;
const { redis } = await import('../../../config/redis.js');
const { setWithTTL } = await import('../../../utils/cache-keys.js');
const { sendVerificationEmail } =
  await import('../../../integrations/email/index.js');
const { logger } = await import('../../../middlewares/logging.middleware.js');
const { register, generateToken, login, refresh, REFRESH_COOKIE } =
  await import('../auth.service.js');

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
  // Absent by default: a refresh test that forgets to arm a session fails as an
  // unauthenticated one rather than passing on a mock's convenient truthiness.
  redis.getdel.mockResolvedValue(null);
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
