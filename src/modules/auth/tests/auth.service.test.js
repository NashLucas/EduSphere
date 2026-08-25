// ─────────────────────────────────────────────────────────────────────────────
// Auth service unit tests — plan:179 and plan:1032 ("service-layer unit tests
// are written in the module's tests/ folder the same day the service lands").
// Task 3.3 is the first service to land, so this is the first such file.
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
// The $transaction mock models rollback rather than merely forwarding the
// callback: rows written through `tx` are staged and DISCARDED if the callback
// throws, and it tracks whether a transaction is open so a test can assert
// WHERE a write happened rather than only what it wrote. Without the first,
// "a Redis outage creates no user" would assert against a mock that never had
// the chance to disagree; without the second, moving the token write below the
// commit stays green. Both claims were also verified against live containers
// with Redis stopped, and every assertion here was checked by mutating the
// service until it failed.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BCRYPT_ROUNDS, TOKEN, UserRole } from '../../../config/constants.js';
import { MESSAGES } from '../../../config/system_messages.js';
import { TTL } from '../../../utils/cache-keys.js';

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
vi.mock('bcryptjs', async () => {
  const { createHash } = await import('node:crypto');
  return {
    default: {
      hash: vi.fn(async (pw, rounds) => {
        const body = createHash('sha256')
          .update(String(pw))
          .digest('base64url')
          .slice(0, 31);
        return `$2a$${rounds}$${body}`;
      }),
    },
  };
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
const { setWithTTL } = await import('../../../utils/cache-keys.js');
const { sendVerificationEmail } =
  await import('../../../integrations/email/index.js');
const { logger } = await import('../../../middlewares/logging.middleware.js');
const { register, generateToken } = await import('../auth.service.js');

const VALID = Object.freeze({
  fullName: 'Ada Lovelace',
  email: 'ada@example.com',
  password: 'SecurePassword123',
});

beforeEach(() => {
  vi.clearAllMocks();
  staged = [];
  committed = [];
  txDepth = 0;
  findUnique.mockResolvedValue(null);
  setWithTTL.mockResolvedValue('OK');
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
