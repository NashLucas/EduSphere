// ─────────────────────────────────────────────────────────────────────────────
// requireAuth / optionalAuth tests — task 3.10.
//
// Co-located next to the middleware it covers, mirroring src/modules/*/tests/.
// vitest.config.js includes src/**/*.test.js, so this file is collected without
// any config change; tests/unit/ is reserved for the pure-function and contract
// specs TRD §3.4 describes, and a guard with two mocked backing stores is not
// one of those.
//
// ── WHAT IS MOCKED, AND WHY IT IS THE CLIENT AND NOT THE HELPER ──────────────
//
// The ioredis client and the Prisma client, and nothing else. Not cache-keys.js:
// mocking that would throw away keys.userState(), and "reads user:state:<id> and
// not some other key" is one of the properties most worth pinning — the guard
// reading the wrong key would authorize every request against a permanent miss.
// With the real key builder and the real getJSON() in the path, `redis.get` is
// asserted against the literal key string, and the parse-failure branch is
// exercised by handing it text that is not JSON.
//
// Every test builds its own one-route app. The guard is the only thing under
// test, so the app is deliberately bare — no cookieParser, no body parser, no
// rate limiter. src/modules/auth/tests/auth.routes.test.js is where the guard is
// checked in its real position inside src/app.js.
// ─────────────────────────────────────────────────────────────────────────────

import cookieParser from 'cookie-parser';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MESSAGES } from '../../config/system_messages.js';

const redis = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
const prisma = vi.hoisted(() => ({ user: { findUnique: vi.fn() } }));
const log = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../config/redis.js', () => ({ default: redis }));
vi.mock('../../database/index.js', () => ({ default: prisma }));
vi.mock('../logging.middleware.js', () => ({
  logger: { child: () => log, ...log },
  httpLogger: (_req, _res, next) => next(),
  default: { logger: log },
}));

const { optionalAuth, requireAuth } = await import('../auth.middleware.js');

// ── Fixtures ─────────────────────────────────────────────────────────────────

const ACCESS_SECRET = 'access-secret-'.padEnd(48, 'a');
const REFRESH_SECRET = 'refresh-secret-'.padEnd(48, 'r');

const USER = Object.freeze({
  id: '3f1c9d8e-0000-4000-8000-000000000001',
  email: 'alex@example.com',
  role: 'STUDENT',
});

const STATE_KEY = `user:state:${USER.id}`;

/** A live account, as login() writes it and JSON.parse reads it back. */
const LIVE_STATE = Object.freeze({
  role: 'STUDENT',
  isBanned: false,
  isEmailVerified: true,
  deletedAt: null,
});

/** A live account, as STATE_FIELDS selects it. */
const LIVE_ROW = Object.freeze({
  role: 'STUDENT',
  isBanned: false,
  deletedAt: null,
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Signs an access token, with every parameter overridable by a test. */
const mint = ({
  claims = {},
  secret = ACCESS_SECRET,
  algorithm = 'HS256',
  expiresIn = '15m',
} = {}) =>
  jwt.sign(
    {
      sub: USER.id,
      email: USER.email,
      role: USER.role,
      type: 'access',
      ...claims,
    },
    secret,
    { expiresIn, algorithm },
  );

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

/**
 * A one-route app ending in a handler that echoes whatever the guard attached.
 *
 * The error handler is the four-parameter form on purpose: Express identifies an
 * error handler by arity, so a three-parameter one would never receive the
 * rejections these tests are about.
 */
const mount = (guard, terminal) => {
  const app = express();

  // cookie-parser is mounted for one reason: without it `req.cookies` is
  // undefined, and a guard that reached for a cookie would silently fall back to
  // the header and look correct. app.js mounts it globally, so this matches the
  // real stack -- and it is what lets the two "ignores a cookie" tests below
  // actually observe the difference. (Measured: with no parser, a mutant reading
  // `req.cookies?.accessToken` survives them both.)
  app.use(cookieParser());

  app.get(
    '/probe',
    guard,
    terminal ??
      ((req, res) => res.status(200).json({ user: req.user ?? null })),
  );

  // `next` is what makes this an error handler; Express reads the arity, not the
  // body. The disable has to be the LAST comment line before the call, or it
  // lands on the comment underneath it instead of on the code.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) =>
    res.status(err.statusCode ?? 500).json({
      message: err.message,
      operational: err.isOperational ?? null,
    }),
  );

  return app;
};

/** GET /probe on a fresh app wrapping `guard`, with the given headers. */
const call = (guard, headers = {}) =>
  request(mount(guard)).get('/probe').set(headers);

// `redis.get` resolves a STRING or null, which is what ioredis does; getJSON is
// real, so a test that wants a cache hit must stringify its own record.
const cached = (value) => redis.get.mockResolvedValue(JSON.stringify(value));
const missing = () => redis.get.mockResolvedValue(null);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET = ACCESS_SECRET;
  process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;
  missing();
  prisma.user.findUnique.mockResolvedValue({ ...LIVE_ROW });
});

// ── The Authorization header ──────────────────────────────────────────────────

describe('requireAuth: extracting the Bearer token', () => {
  it('401s with no Authorization header, before touching either store', async () => {
    const res = await call(requireAuth);

    expect(res.status).toBe(401);
    expect(res.body.message).toBe(MESSAGES.COMMON.UNAUTHENTICATED);
    expect(redis.get).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('401s on a non-Bearer scheme', async () => {
    const res = await call(requireAuth, { Authorization: `Basic ${mint()}` });

    expect(res.status).toBe(401);
  });

  it('401s on a bare token with no scheme', async () => {
    const res = await call(requireAuth, { Authorization: mint() });

    expect(res.status).toBe(401);
  });

  it('401s on the scheme with no token', async () => {
    const res = await call(requireAuth, { Authorization: 'Bearer' });

    expect(res.status).toBe(401);
  });

  it('401s on a value with an embedded space', async () => {
    const res = await call(requireAuth, {
      Authorization: `Bearer ${mint()} extra`,
    });

    expect(res.status).toBe(401);
  });

  it('accepts a lowercase scheme (RFC 7235 makes it case-insensitive)', async () => {
    cached(LIVE_STATE);

    const res = await call(requireAuth, { Authorization: `bearer ${mint()}` });

    expect(res.status).toBe(200);
  });

  it('accepts more than one space between scheme and token (1*SP)', async () => {
    cached(LIVE_STATE);

    const res = await call(requireAuth, {
      Authorization: `Bearer  ${mint()}`,
    });

    expect(res.status).toBe(200);
  });

  it('ignores a token in the query string', async () => {
    const res = await request(mount(requireAuth)).get(
      `/probe?token=${mint()}&access_token=${mint()}`,
    );

    expect(res.status).toBe(401);
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('ignores a token in a cookie', async () => {
    const res = await call(requireAuth, {
      Cookie: `accessToken=${mint()}; edusphere_rt=${mint()}`,
    });

    expect(res.status).toBe(401);
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('judges the header SHAPE before it reads any key', async () => {
    // With the secrets gone, anything that gets as far as verificationKey() is a
    // 500. So a 401 here is the proof that a malformed header is refused by
    // bearerToken() and never reaches the verify step -- which is also what
    // separates `(\S+)` from `(.+)` in BEARER: the loose form would extract
    // 'abc def' as a token and go on to look for a key.
    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;

    for (const header of ['Bearer abc def', 'Basic abc', 'Bearer', '']) {
      const res = await call(requireAuth, { Authorization: header });

      expect(res.status, header).toBe(401);
      expect(res.body.operational, header).toBe(true);
    }
  });
});

// ── The token itself ──────────────────────────────────────────────────────────

describe('requireAuth: verifying the token', () => {
  it('admits a valid access token and attaches exactly { id, email, role }', async () => {
    cached(LIVE_STATE);

    const res = await call(requireAuth, bearer(mint()));

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: USER.id,
      email: USER.email,
      role: USER.role,
    });
    expect(Object.keys(res.body.user).sort()).toEqual(['email', 'id', 'role']);
  });

  it('401s on a token signed with the refresh key', async () => {
    const res = await call(
      requireAuth,
      bearer(mint({ secret: REFRESH_SECRET })),
    );

    expect(res.status).toBe(401);
    expect(res.body.message).toBe(MESSAGES.COMMON.UNAUTHENTICATED);
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('401s on an expired token', async () => {
    const res = await call(requireAuth, bearer(mint({ expiresIn: '-1s' })));

    expect(res.status).toBe(401);
  });

  it('401s on an algorithm substitution', async () => {
    // A correct HS512 MAC over the real secret. Without the algorithms pin this
    // verifies; with it, jsonwebtoken reports "invalid algorithm".
    const res = await call(
      requireAuth,
      bearer(mint({ algorithm: 'HS512', expiresIn: '15m' })),
    );

    expect(res.status).toBe(401);
  });

  it('401s on a refresh-typed token signed with the ACCESS key', async () => {
    const res = await call(
      requireAuth,
      bearer(mint({ claims: { type: 'refresh' } })),
    );

    expect(res.status).toBe(401);
  });

  it('401s on a token with no type claim', async () => {
    const res = await call(
      requireAuth,
      bearer(mint({ claims: { type: undefined } })),
    );

    expect(res.status).toBe(401);
  });

  it('401s on a non-string sub', async () => {
    const res = await call(
      requireAuth,
      bearer(mint({ claims: { sub: 12345 } })),
    );

    expect(res.status).toBe(401);
  });

  it('401s on a missing email claim', async () => {
    const res = await call(
      requireAuth,
      bearer(mint({ claims: { email: undefined } })),
    );

    expect(res.status).toBe(401);
  });

  it('401s on a sub that is not a UUID, before either read', async () => {
    // The point of this guard: `where: { id: 'not-a-uuid' }` against a uuid
    // column is an error, and this middleware reports a failed row read as 503 —
    // so a crafted sub would arrive dressed as an outage.
    const res = await call(
      requireAuth,
      bearer(mint({ claims: { sub: 'admin' } })),
    );

    expect(res.status).toBe(401);
    expect(redis.get).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('401s on a sub that merely CONTAINS a UUID', async () => {
    // The anchors are the whole check. An unanchored pattern matches the id
    // inside `zz<uuid>`, and that string passes the key charset too — so the
    // request would go on to ask PostgreSQL for a row whose id is not a uuid,
    // and arrive back as a 503.
    for (const sub of [`zz${USER.id}`, `${USER.id}zz`, ` ${USER.id}`]) {
      const res = await call(requireAuth, bearer(mint({ claims: { sub } })));

      expect(res.status, sub).toBe(401);
      expect(redis.get, sub).not.toHaveBeenCalled();
      expect(prisma.user.findUnique, sub).not.toHaveBeenCalled();
    }
  });

  it('takes the id from sub, never from a claim named id', async () => {
    cached(LIVE_STATE);

    const res = await call(
      requireAuth,
      bearer(mint({ claims: { id: '00000000-0000-4000-8000-00000000dead' } })),
    );

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(USER.id);
    expect(redis.get).toHaveBeenCalledWith(STATE_KEY);
  });

  it('401s on a malformed token', async () => {
    const res = await call(requireAuth, bearer('not.a.jwt'));

    expect(res.status).toBe(401);
  });

  it('500s rather than 401s when JWT_SECRET is absent', async () => {
    // Measured: jwt.verify with an undefined secret throws JsonWebTokenError,
    // the same class as a bad signature. Left to the catch, an unset secret
    // would 401 the whole platform and look like a wave of bad credentials.
    delete process.env.JWT_SECRET;

    const res = await call(requireAuth, bearer(mint()));

    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/must be set/);
    expect(res.body.operational).toBeNull();
  });

  it('500s when JWT_REFRESH_SECRET alone is absent', async () => {
    // The access secret is the only one this file verifies with, so it would be
    // easy to require just that one. But the check the guard is really making is
    // that the two keys DIFFER, and it cannot make it against a key that is not
    // there: a deployment missing the refresh secret is one where a refresh
    // token might verify here.
    delete process.env.JWT_REFRESH_SECRET;

    const res = await call(requireAuth, bearer(mint()));

    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/must be set/);
  });

  it('500s when the two secrets are identical', async () => {
    process.env.JWT_REFRESH_SECRET = ACCESS_SECRET;

    const res = await call(requireAuth, bearer(mint()));

    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/must differ/);
  });
});

// ── Reading the authorization state ───────────────────────────────────────────

describe('requireAuth: the Redis fast path', () => {
  it('reads exactly user:state:<id>', async () => {
    cached(LIVE_STATE);

    await call(requireAuth, bearer(mint()));

    expect(redis.get).toHaveBeenCalledTimes(1);
    expect(redis.get).toHaveBeenCalledWith(STATE_KEY);
  });

  it('queries PostgreSQL not at all on a cache hit (plan:376)', async () => {
    cached(LIVE_STATE);

    const res = await call(requireAuth, bearer(mint()));

    expect(res.status).toBe(200);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('never writes the record back', async () => {
    // Not a read-through cache: plan:376 enumerates the writers and this guard
    // is not one of them. Asserted on the miss path, where a fill would happen.
    missing();

    const res = await call(requireAuth, bearer(mint()));

    expect(res.status).toBe(200);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('403s a banned account from the cached record alone', async () => {
    cached({ ...LIVE_STATE, isBanned: true });

    const res = await call(requireAuth, bearer(mint()));

    expect(res.status).toBe(403);
    expect(res.body.message).toBe(MESSAGES.AUTH.ACCOUNT_DISABLED);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('403s a soft-deleted account whose deletedAt is an ISO string', async () => {
    // What survives JSON: setWithTTL stringifies the Date into a string, so the
    // check has to be `!== null` and not an instanceof.
    cached({ ...LIVE_STATE, deletedAt: '2026-08-01T10:00:00.000Z' });

    const res = await call(requireAuth, bearer(mint()));

    expect(res.status).toBe(403);
    expect(res.body.message).toBe(MESSAGES.AUTH.ACCOUNT_DISABLED);
  });

  it('takes the role from the record, not from the token', async () => {
    // The record is rewritten by the Day 14 role-change handler; the claim is
    // frozen for 15 minutes. A demotion has to bite on the next request.
    cached({ ...LIVE_STATE, role: 'INSTRUCTOR' });

    const res = await call(
      requireAuth,
      bearer(mint({ claims: { role: 'ADMIN' } })),
    );

    expect(res.body.user.role).toBe('INSTRUCTOR');
  });

  it('503s when Redis cannot answer, and does not fall through to PostgreSQL', async () => {
    redis.get.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await call(requireAuth, bearer(mint()));

    expect(res.status).toBe(503);
    expect(res.body.message).toBe(MESSAGES.COMMON.SERVICE_UNAVAILABLE);
    // The fail-closed rule (plan:379). A fallthrough here would make an outage
    // the way to have every request answered from a store the ban writer may
    // not have reached yet.
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalled();
  });

  it('treats an unparseable cached value as a miss', async () => {
    redis.get.mockResolvedValue('{not json');

    const res = await call(requireAuth, bearer(mint()));

    expect(res.status).toBe(200);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('treats a partial record as a miss rather than a refusal', async () => {
    // The measured trap this guard exists for: on `{"role":"STUDENT"}`,
    // `isBanned` is undefined (falsy — admits a banned account) while
    // `deletedAt !== null` is TRUE (refuses a live one). Neither may decide.
    redis.get.mockResolvedValue('{"role":"STUDENT"}');

    const res = await call(requireAuth, bearer(mint()));

    expect(res.status).toBe(200);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('treats a record whose isBanned is a string as a miss (plan:364)', async () => {
    // What a Hash would have returned. 'false' is truthy, so a record that lost
    // its types must not be trusted in either direction.
    cached({ ...LIVE_STATE, isBanned: 'false' });

    const res = await call(requireAuth, bearer(mint()));

    expect(res.status).toBe(200);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('requires each of the three fields separately', async () => {
    // One case per check in isUsableState, because each one is the only thing
    // standing between a malformed record and a wrong answer, and a record can
    // lose any single field on its own. `deletedAt` absent is the sharpest: it
    // reads as `undefined !== null`, which would 403 a live account.
    const partials = [
      { ...LIVE_STATE, role: undefined },
      { ...LIVE_STATE, role: 42 },
      { ...LIVE_STATE, isBanned: undefined },
      { ...LIVE_STATE, deletedAt: undefined },
      { ...LIVE_STATE, deletedAt: 0 },
      { ...LIVE_STATE, deletedAt: false },
    ];

    for (const [i, state] of partials.entries()) {
      cached(state);

      const res = await call(requireAuth, bearer(mint()));

      expect(res.status, JSON.stringify(state)).toBe(200);
      expect(
        prisma.user.findUnique,
        JSON.stringify(state),
      ).toHaveBeenCalledTimes(i + 1);
    }
  });

  it('treats a JSON null and a JSON scalar as misses', async () => {
    redis.get.mockResolvedValueOnce('null').mockResolvedValueOnce('42');

    const first = await call(requireAuth, bearer(mint()));
    const second = await call(requireAuth, bearer(mint()));

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });
});

describe('requireAuth: the PostgreSQL fallthrough', () => {
  it('selects the three authorization columns and nothing else', async () => {
    await call(requireAuth, bearer(mint()));

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: USER.id },
      select: { role: true, isBanned: true, deletedAt: true },
    });
  });

  it('does not scope the query by deletedAt: null', async () => {
    // Every other read in this codebase does. This one must not: a soft-deleted
    // row has to come back so it can be answered with 403 rather than 401.
    await call(requireAuth, bearer(mint()));

    const { where } = prisma.user.findUnique.mock.calls[0][0];

    expect(where).toEqual({ id: USER.id });
    expect('deletedAt' in where).toBe(false);
  });

  it('admits a live row and takes the role from it', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...LIVE_ROW,
      role: 'INSTRUCTOR',
    });

    const res = await call(
      requireAuth,
      bearer(mint({ claims: { role: 'STUDENT' } })),
    );

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('INSTRUCTOR');
  });

  it('takes the email from the token even here, where the row has none', async () => {
    const res = await call(requireAuth, bearer(mint()));

    expect(res.body.user.email).toBe(USER.email);
  });

  it('403s a banned row', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...LIVE_ROW, isBanned: true });

    const res = await call(requireAuth, bearer(mint()));

    expect(res.status).toBe(403);
    expect(res.body.message).toBe(MESSAGES.AUTH.ACCOUNT_DISABLED);
  });

  it('403s a soft-deleted row, whose deletedAt is a Date', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...LIVE_ROW,
      deletedAt: new Date('2026-08-01T10:00:00.000Z'),
    });

    const res = await call(requireAuth, bearer(mint()));

    expect(res.status).toBe(403);
    expect(res.body.message).toBe(MESSAGES.AUTH.ACCOUNT_DISABLED);
  });

  it('401s when there is no such row — not 403, and not 404', async () => {
    // Nothing was withdrawn from an account that does not exist, so the token
    // identifies nobody. getProfile()'s 404 is a different contract, for a
    // caller this guard has already admitted.
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await call(requireAuth, bearer(mint()));

    expect(res.status).toBe(401);
    expect(res.body.message).toBe(MESSAGES.COMMON.UNAUTHENTICATED);
  });

  it('503s when the row cannot be read', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('P1001'));

    const res = await call(requireAuth, bearer(mint()));

    expect(res.status).toBe(503);
    expect(res.body.message).toBe(MESSAGES.COMMON.SERVICE_UNAVAILABLE);
    expect(log.error).toHaveBeenCalled();
  });
});

describe('requireAuth: what it hands downstream', () => {
  it('freezes req.user, so a handler cannot rewrite the caller', async () => {
    cached(LIVE_STATE);

    const escalate = (req, res) => {
      try {
        req.user.role = 'ADMIN';
        res.status(200).json({ threw: false, role: req.user.role });
      } catch (err) {
        res
          .status(200)
          .json({ threw: true, name: err.name, role: req.user.role });
      }
    };

    const res = await request(mount(requireAuth, escalate))
      .get('/probe')
      .set(bearer(mint()));

    expect(res.body).toEqual({
      threw: true,
      name: 'TypeError',
      role: 'STUDENT',
    });
  });

  it('calls next() exactly once on the happy path', async () => {
    cached(LIVE_STATE);

    const next = vi.fn();
    const req = { get: () => `Bearer ${mint()}` };

    await requireAuth(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('passes the error to next() rather than throwing', async () => {
    const next = vi.fn();

    await requireAuth({ get: () => undefined }, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({
      statusCode: 401,
      isOperational: true,
    });
  });
});

// ── optionalAuth ─────────────────────────────────────────────────────────────

describe('optionalAuth', () => {
  it('proceeds anonymously with no header, touching neither store', async () => {
    const res = await call(optionalAuth);

    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
    expect(redis.get).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('attaches the same req.user as requireAuth for a valid token', async () => {
    cached(LIVE_STATE);

    const res = await call(optionalAuth, bearer(mint()));

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: USER.id,
      email: USER.email,
      role: USER.role,
    });
  });

  it('sets req.user to null rather than leaving it undefined', async () => {
    const res = await call(optionalAuth, { Authorization: 'Bearer nonsense' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: null });
  });

  it('assigns the null itself, and does so before reading the header', async () => {
    // Over HTTP this is invisible: `req.user ?? null` in a handler flattens an
    // absent property and an explicit null into the same body, which is exactly
    // why the assignment is easy to lose. Asserted on the request object.
    const anonymous = { get: () => undefined };
    const next = vi.fn();

    await optionalAuth(anonymous, {}, next);

    expect(Object.hasOwn(anonymous, 'user')).toBe(true);
    expect(anonymous.user).toBeNull();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]).toEqual([]);
  });

  it('never 401s on an invalid, expired or foreign-key token', async () => {
    const tokens = [
      'not.a.jwt',
      mint({ expiresIn: '-1s' }),
      mint({ secret: REFRESH_SECRET }),
      mint({ claims: { type: 'refresh' } }),
      mint({ claims: { sub: 'not-a-uuid' } }),
    ];

    for (const token of tokens) {
      const res = await call(optionalAuth, bearer(token));

      expect(res.status).toBe(200);
      expect(res.body.user).toBeNull();
    }
  });

  it('never 403s a banned account — it treats it as a stranger', async () => {
    cached({ ...LIVE_STATE, isBanned: true });

    const res = await call(optionalAuth, bearer(mint()));

    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });

  it('never 401s for an account that no longer exists', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await call(optionalAuth, bearer(mint()));

    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });

  it('never 503s during a Redis outage — the public view is served', async () => {
    redis.get.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await call(optionalAuth, bearer(mint()));

    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });

  it('propagates a misconfiguration instead of going quietly anonymous', async () => {
    // The one thing it must not swallow. An unset secret absorbed into
    // "anonymous" would make every optionalAuth route silently public.
    delete process.env.JWT_SECRET;

    const res = await call(optionalAuth, bearer(mint()));

    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/must be set/);
  });

  it('logs the refusal it swallowed', async () => {
    await call(optionalAuth, bearer('not.a.jwt'));

    expect(log.debug).toHaveBeenCalledWith(
      { statusCode: 401 },
      expect.stringContaining('continuing anonymously'),
    );
  });
});
