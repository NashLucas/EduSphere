// ─────────────────────────────────────────────────────────────────────────────
// requireRole / requireVerifiedEmail tests — task 3.11.
//
// Beside auth.middleware.test.js, and mocking the same two clients for the same
// reason: cache-keys.js stays REAL, so `redis.get` is asserted against the
// literal `user:state:<id>` string that keys.userState() built and the
// parse-failure branch is exercised by handing it text that is not JSON. A guard
// reading the wrong key would gate every request on a permanent miss.
//
// ── req.user IS INJECTED, NOT MINTED ─────────────────────────────────────────
//
// These guards run after requireAuth and read only what it attached, so the
// harness below sets `req.user` directly instead of signing a token. Routing a
// real JWT through requireAuth to arrive at the same three fields would make
// every case here depend on 3.10's token rules, and a change there would fail
// tests about roles. auth.middleware.test.js owns that path; the ONE thing worth
// checking across the seam is that the shape requireAuth produces is the shape
// these guards consume, which the fixtures below are written from.
//
// The absent-req.user cases are the reason the harness takes its user as a rest
// parameter: `call(guard)` leaves the property off entirely, which is what an
// unmounted requireAuth looks like, and `call(guard, null)` is what optionalAuth
// leaves behind for an anonymous caller. `user: undefined` cannot express the
// difference.
// ─────────────────────────────────────────────────────────────────────────────

import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserRole } from '../../config/constants.js';
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
  httpLogger: (req, _res, next) => {
    req.log = log;
    next();
  },
  default: { logger: log },
}));

const { requireRole, requireVerifiedEmail } =
  await import('../rbac.middleware.js');

// The real /api/v1 router, for the tripwire at the bottom of this file. Imported
// here rather than inside the test so that a module-load failure is a collection
// error naming this line, not three identical failures inside an it.each.
const { default: apiRouter } = await import('../../routes/v1.js');

// ── Fixtures ─────────────────────────────────────────────────────────────────

const { ADMIN, INSTRUCTOR, STUDENT } = UserRole;

/** Exactly what requireAuth attaches: `{ id, email, role }` and nothing else. */
const as = (role, id = '3f1c9d8e-0000-4000-8000-000000000001') =>
  Object.freeze({ id, email: 'alex@example.com', role });

const student = as(STUDENT);
const instructor = as(INSTRUCTOR);
const admin = as(ADMIN);

const STATE_KEY = `user:state:${student.id}`;

/** A verified live account, as login() writes the record and getJSON reads it. */
const LIVE_STATE = Object.freeze({
  role: STUDENT,
  isBanned: false,
  isEmailVerified: true,
  deletedAt: null,
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * A one-route app: attach `req.user` (when the caller supplied one), run the
 * guard, echo what survived.
 *
 * `maybeUser` is a rest parameter so that no argument and an explicit `null` are
 * distinguishable — see the header. The error handler is the four-parameter form
 * because Express identifies one by arity.
 */
const mount = (guard, ...maybeUser) => {
  const app = express();

  app.get(
    '/probe',
    (req, _res, next) => {
      if (maybeUser.length > 0) {
        req.user = maybeUser[0];
      }
      next();
    },
    guard,
    (req, res) => res.status(200).json({ user: req.user ?? null }),
  );

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) =>
    res.status(err.statusCode ?? 500).json({
      message: err.message,
      operational: err.isOperational ?? null,
    }),
  );

  return app;
};

const call = (guard, ...maybeUser) =>
  request(mount(guard, ...maybeUser)).get('/probe');

// `redis.get` resolves a STRING or null, which is what ioredis does; getJSON is
// real, so a cache hit has to be stringified here.
const cached = (value) => redis.get.mockResolvedValue(JSON.stringify(value));
const missing = () => redis.get.mockResolvedValue(null);

beforeEach(() => {
  vi.clearAllMocks();
  missing();
  prisma.user.findUnique.mockResolvedValue({ isEmailVerified: true });
});

// ── requireRole: the array is judged when the route is registered ────────────

describe('requireRole: refusing a bad roles array at registration', () => {
  it('throws when there is no array at all', () => {
    expect(() => requireRole()).toThrow(/non-empty array/);
    expect(() => requireRole(null)).toThrow(/non-empty array/);
  });

  it('throws on a bare string, which Array.includes would accept', () => {
    // `'ADMIN'.includes('ADMIN')` is true and `'ADMIN'.includes('AD')` is too, so
    // a membership test written against the raw argument would admit a caller
    // whose role is a SUBSTRING of the intended one. The type check is what makes
    // that unreachable.
    expect(() => requireRole(ADMIN)).toThrow(/non-empty array/);
  });

  it('throws on an empty array rather than serving a locked route', () => {
    expect(() => requireRole([])).toThrow(/non-empty array/);
  });

  it('throws on a misspelt role, and names it', () => {
    expect(() => requireRole(['ADMNI'])).toThrow(/ADMNI/);
    expect(() => requireRole(['ADMNI'])).toThrow(/STUDENT, INSTRUCTOR, ADMIN/);
  });

  it('throws on the right role in the wrong case', () => {
    // The column is a Postgres enum and the claim is copied from it, so 'admin'
    // never equals a stored role. Lowercasing here instead would be a second
    // place the enum's spelling lives.
    expect(() => requireRole(['admin'])).toThrow(/admin/);
  });

  it('throws when one member of an otherwise valid array is unknown', () => {
    expect(() => requireRole([INSTRUCTOR, 'OWNER'])).toThrow(/OWNER/);
  });

  it('reports every unknown member, not just the first', () => {
    expect(() => requireRole(['ADMNI', 'STUDNET'])).toThrow(/ADMNI.*STUDNET/);
  });

  it('accepts each real role, alone and together', () => {
    expect(() => requireRole([STUDENT])).not.toThrow();
    expect(() => requireRole([INSTRUCTOR])).not.toThrow();
    expect(() => requireRole([ADMIN])).not.toThrow();
    expect(() => requireRole([STUDENT, INSTRUCTOR, ADMIN])).not.toThrow();
  });

  it('returns a three-parameter middleware, not a four-parameter one', () => {
    // Express reads arity to tell a middleware from an error handler. A guard
    // that arrived with four parameters would be registered as an error handler
    // and never run on a normal request — the route would be wide open.
    const guard = requireRole([ADMIN]);

    expect(typeof guard).toBe('function');
    expect(guard.length).toBe(3);
  });
});

// ── requireRole: admitting and refusing ──────────────────────────────────────

describe('requireRole: the membership test', () => {
  it('admits the role the array names', async () => {
    const res = await call(requireRole([STUDENT]), student);

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ ...student });
  });

  it('admits any member of a multi-role array', async () => {
    const guard = requireRole([INSTRUCTOR, ADMIN]);

    const first = await call(guard, instructor);
    const second = await call(guard, admin);

    expect([first.status, second.status]).toEqual([200, 200]);
  });

  it('403s a role the array does not name', async () => {
    const res = await call(requireRole([INSTRUCTOR]), student);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe(MESSAGES.COMMON.FORBIDDEN);
    expect(res.body.operational).toBe(true);
  });

  it('403s a role that is not a UserRole at all', async () => {
    // A claim copied from a record written by an older schema, or a role column
    // that gained a value this guard has not been told about. Set membership
    // answers it without a special case.
    const res = await call(requireRole([STUDENT]), as('SUPERUSER'));

    expect(res.status).toBe(403);
  });

  it('403s the right role in the wrong case', async () => {
    // The mirror of the registration-time case check above, and the one direction
    // that matters at request time. Prisma hands back the enum member, so a
    // lowercase 'student' cannot have come from the schema — it came from a
    // hand-written record, a hand-signed token, or a store that lost its types,
    // and none of those should widen a route. A case-folding comparison here
    // would admit all three and no happy-path test would notice.
    const res = await call(requireRole([STUDENT]), as('student'));

    expect(res.status).toBe(403);
  });

  it('403s when req.user carries no role', async () => {
    const res = await call(requireRole([STUDENT]), {
      id: student.id,
      email: student.email,
    });

    expect(res.status).toBe(403);
  });

  it('reads neither Redis nor PostgreSQL, on either branch', async () => {
    await call(requireRole([STUDENT]), student);
    await call(requireRole([ADMIN]), student);

    expect(redis.get).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('logs the refusal with the role and the permitted set', async () => {
    await call(requireRole([INSTRUCTOR, ADMIN]), student);

    expect(log.warn).toHaveBeenCalledWith(
      {
        userId: student.id,
        role: STUDENT,
        permitted: [INSTRUCTOR, ADMIN],
      },
      expect.stringContaining('not permitted'),
    );
  });

  it('does not log an admitted caller', async () => {
    await call(requireRole([STUDENT]), student);

    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('calls next() exactly once, with nothing, on the happy path', () => {
    const next = vi.fn();

    requireRole([STUDENT])({ user: student }, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]).toEqual([]);
  });

  it('hands the refusal to next() rather than throwing', () => {
    const next = vi.fn();

    requireRole([ADMIN])({ user: student }, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({
      statusCode: 403,
      isOperational: true,
    });
  });

  it('leaves req.user exactly as requireAuth left it', async () => {
    const res = await call(requireRole([STUDENT]), student);

    expect(Object.keys(res.body.user).sort()).toEqual(['email', 'id', 'role']);
  });
});

// ── requireRole: no implicit hierarchy ───────────────────────────────────────

describe('requireRole: the roles are a set, not a ladder', () => {
  it('403s an INSTRUCTOR and an ADMIN on a Student-only route', async () => {
    // TRD:1550 guards POST /enrollments as Student. apidoc §3 gives an
    // INSTRUCTOR "all STUDENT permissions" and an ADMIN an ownership bypass, and
    // reading either as a ladder here would let both take a seat on a course.
    const guard = requireRole([STUDENT]);

    const asInstructor = await call(guard, instructor);
    const asAdmin = await call(guard, admin);

    expect([asInstructor.status, asAdmin.status]).toEqual([403, 403]);
  });

  it('403s an ADMIN on an Instructor-only route', async () => {
    const res = await call(requireRole([INSTRUCTOR]), admin);

    expect(res.status).toBe(403);
  });

  it('admits an ADMIN only where the array says ADMIN', async () => {
    // Which is how every TRD §6 table writes it: "Instructor (Owner) / Admin",
    // never "Instructor" with the admin left implicit.
    const res = await call(requireRole([INSTRUCTOR, ADMIN]), admin);

    expect(res.status).toBe(200);
  });
});

// ── requireRole: the array cannot be widened afterwards ──────────────────────

describe('requireRole: the roles are copied out of the caller array', () => {
  it('ignores a role pushed onto the array after registration', async () => {
    const roles = [ADMIN];
    const guard = requireRole(roles);

    roles.push(STUDENT);

    const res = await call(guard, student);

    expect(res.status).toBe(403);
  });

  it('ignores a role spliced out of the array after registration', async () => {
    const roles = [ADMIN, STUDENT];
    const guard = requireRole(roles);

    roles.length = 0;

    const res = await call(guard, student);

    expect(res.status).toBe(200);
  });

  it('freezing a Set would not have protected it — Object.freeze does not stop add', () => {
    // The measurement behind the header's claim, and the reason this file has no
    // `Object.freeze(new Set(...))` in it: a Set's members live in an internal
    // slot rather than in properties, so freeze leaves `add` fully working. The
    // copy is the protection; a freeze would only have looked like one.
    const frozen = Object.freeze(new Set([ADMIN]));

    expect(Object.isFrozen(frozen)).toBe(true);
    expect(() => frozen.add(STUDENT)).not.toThrow();
    expect(frozen.has(STUDENT)).toBe(true);
  });
});

// ── Both guards: a missing req.user is a deployment fault ────────────────────

describe('both guards: a missing req.user is a 500, never a 401', () => {
  const guards = [
    ['requireRole', () => requireRole([STUDENT])],
    ['requireVerifiedEmail', () => requireVerifiedEmail],
  ];

  for (const [name, build] of guards) {
    it(`500s when ${name} runs with no req.user`, async () => {
      const res = await call(build());

      expect(res.status).toBe(500);
      expect(res.body.message).toMatch(new RegExp(`${name}.*no req.user`));
      expect(res.body.message).toMatch(/mount requireAuth/);
      // Not an AppError: globalErrorHandler logs a non-operational error as the
      // bug it is, and a 401 here would file a mounting mistake as a routine
      // client failure.
      expect(res.body.operational).toBeNull();
    });

    it(`500s when ${name} runs behind optionalAuth's anonymous caller`, async () => {
      const res = await call(build(), null);

      expect(res.status).toBe(500);
      // The message matters as much as the code. `== null` is what catches this
      // case; an `=== undefined` check would let the null through to a TypeError
      // on `.role` or `.id`, which is also a non-operational 500 — identical from
      // the outside, and useless to whoever has to find the mounting bug.
      expect(res.body.message).toMatch(new RegExp(`${name}.*no req.user`));
      expect(res.body.operational).toBeNull();
    });
  }

  it('touches no store before deciding req.user is missing', async () => {
    await call(requireVerifiedEmail);

    expect(redis.get).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

// ── requireVerifiedEmail: the Redis fast path ────────────────────────────────

describe('requireVerifiedEmail: the Redis fast path', () => {
  it('admits a verified account from the cached record alone', async () => {
    cached(LIVE_STATE);

    const res = await call(requireVerifiedEmail, student);

    expect(res.status).toBe(200);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('403s an unverified account from the cached record alone', async () => {
    cached({ ...LIVE_STATE, isEmailVerified: false });

    const res = await call(requireVerifiedEmail, student);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe(MESSAGES.AUTH.EMAIL_NOT_VERIFIED);
    expect(res.body.operational).toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalled();
  });

  it('reads exactly user:state:<id>, once', async () => {
    cached(LIVE_STATE);

    await call(requireVerifiedEmail, student);

    expect(redis.get).toHaveBeenCalledTimes(1);
    expect(redis.get).toHaveBeenCalledWith(STATE_KEY);
  });

  it('reads the id from req.user, not from anywhere else', async () => {
    const other = as(STUDENT, '3f1c9d8e-0000-4000-8000-0000000000ff');
    cached(LIVE_STATE);

    await call(requireVerifiedEmail, other);

    expect(redis.get).toHaveBeenCalledWith(`user:state:${other.id}`);
  });

  it('never writes the record back', async () => {
    // Task 3.8 owns that write (plan:349); this guard is a reader. Asserted on
    // the miss path, where a read-through cache would fill.
    missing();

    const res = await call(requireVerifiedEmail, student);

    expect(res.status).toBe(200);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('503s when Redis cannot answer, without consulting PostgreSQL', async () => {
    redis.get.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await call(requireVerifiedEmail, student);

    expect(res.status).toBe(503);
    expect(res.body.message).toBe(MESSAGES.COMMON.SERVICE_UNAVAILABLE);
    // plan:379. A fallthrough would make an outage the way to be answered from a
    // store the verification writer may not have reached.
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalled();
  });

  it('treats an unparseable cached value as a miss', async () => {
    redis.get.mockResolvedValue('{not json');

    const res = await call(requireVerifiedEmail, student);

    expect(res.status).toBe(200);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('treats a record with no isEmailVerified field as a miss', async () => {
    cached({ role: STUDENT, isBanned: false, deletedAt: null });

    const res = await call(requireVerifiedEmail, student);

    expect(res.status).toBe(200);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it("treats the string 'true' as a miss, not as verified (plan:364)", async () => {
    // What HGETALL would have returned. The dangerous half of the pair: a
    // truthiness test admits this record, and PostgreSQL is never asked.
    cached({ ...LIVE_STATE, isEmailVerified: 'true' });
    prisma.user.findUnique.mockResolvedValue({ isEmailVerified: false });

    const res = await call(requireVerifiedEmail, student);

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(403);
  });

  it("treats the string 'false' as a miss, not as unverified", async () => {
    // The other half. 'false' is truthy, so a truthiness test would ADMIT it —
    // and a `=== 'false'` reading would refuse a verified account forever.
    cached({ ...LIVE_STATE, isEmailVerified: 'false' });
    prisma.user.findUnique.mockResolvedValue({ isEmailVerified: true });

    const res = await call(requireVerifiedEmail, student);

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it('treats 0, 1, null and a JSON scalar as misses', async () => {
    const values = [
      { ...LIVE_STATE, isEmailVerified: 0 },
      { ...LIVE_STATE, isEmailVerified: 1 },
      { ...LIVE_STATE, isEmailVerified: null },
      42,
      null,
    ];

    for (const [i, value] of values.entries()) {
      cached(value);

      const res = await call(requireVerifiedEmail, student);

      expect(res.status, JSON.stringify(value)).toBe(200);
      expect(
        prisma.user.findUnique,
        JSON.stringify(value),
      ).toHaveBeenCalledTimes(i + 1);
    }
  });
});

// ── requireVerifiedEmail: the PostgreSQL fallthrough ────────────────────────

describe('requireVerifiedEmail: the PostgreSQL fallthrough', () => {
  it('selects one column, by id, and nothing else', async () => {
    await call(requireVerifiedEmail, student);

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: student.id },
      select: { isEmailVerified: true },
    });
  });

  it('admits a verified row', async () => {
    prisma.user.findUnique.mockResolvedValue({ isEmailVerified: true });

    const res = await call(requireVerifiedEmail, student);

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ ...student });
  });

  it('403s an unverified row', async () => {
    prisma.user.findUnique.mockResolvedValue({ isEmailVerified: false });

    const res = await call(requireVerifiedEmail, student);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe(MESSAGES.AUTH.EMAIL_NOT_VERIFIED);
  });

  it('401s when the row is gone — not 403', async () => {
    // requireAuth already refused a token naming no row, so the account was
    // hard-deleted between the two reads. "Verify your email" would be a nonsense
    // instruction for an account that no longer exists.
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await call(requireVerifiedEmail, student);

    expect(res.status).toBe(401);
    expect(res.body.message).toBe(MESSAGES.COMMON.UNAUTHENTICATED);
    expect(log.warn).toHaveBeenCalled();
  });

  it('503s when the row cannot be read', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('P1001'));

    const res = await call(requireVerifiedEmail, student);

    expect(res.status).toBe(503);
    expect(res.body.message).toBe(MESSAGES.COMMON.SERVICE_UNAVAILABLE);
    expect(log.error).toHaveBeenCalled();
  });

  it('calls next() exactly once, with nothing, on the happy path', async () => {
    cached(LIVE_STATE);

    const next = vi.fn();

    await requireVerifiedEmail({ user: student }, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]).toEqual([]);
  });

  it('hands the refusal to next() rather than rejecting', async () => {
    cached({ ...LIVE_STATE, isEmailVerified: false });

    const next = vi.fn();

    await expect(
      requireVerifiedEmail({ user: student }, {}, next),
    ).resolves.toBeUndefined();
    expect(next.mock.calls[0][0]).toMatchObject({
      statusCode: 403,
      isOperational: true,
    });
  });

  it('calls next() once even when next() itself throws', async () => {
    // This is what keeps the happy-path `return next()` outside the try. Were it
    // inside, a throw out of next() would land in the catch and be answered with
    // a SECOND next(err) on the same request — two responses, or a response plus
    // a "headers already sent".
    //
    // Measured: through Express 5.2.1 the two shapes are indistinguishable,
    // because every Layer wraps its own handler in a try/catch, so a downstream
    // throw is answered where it happened and never reaches this frame. The
    // difference shows only to a direct caller, which is exactly what this is.
    cached(LIVE_STATE);

    const next = vi.fn(() => {
      throw new Error('the caller of next() threw');
    });

    await expect(
      requireVerifiedEmail({ user: student }, {}, next),
    ).rejects.toThrow('the caller of next() threw');
    expect(next).toHaveBeenCalledTimes(1);
  });
});

// ── The two guards in the order TRD:179 puts them ───────────────────────────

describe('requireRole then requireVerifiedEmail', () => {
  const chain = [requireRole([STUDENT]), requireVerifiedEmail];

  it('admits a verified caller whose role is permitted', async () => {
    cached(LIVE_STATE);

    const res = await request(mount(chain, student)).get('/probe');

    expect(res.status).toBe(200);
  });

  it('403s the wrong role before the flag is ever read', async () => {
    // Ordering, not duplication: the role check costs nothing and the flag check
    // costs a network round trip, so a refused instructor must not spend one.
    cached(LIVE_STATE);

    const res = await request(mount(chain, instructor)).get('/probe');

    expect(res.status).toBe(403);
    expect(res.body.message).toBe(MESSAGES.COMMON.FORBIDDEN);
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('403s the right role with an unverified address', async () => {
    cached({ ...LIVE_STATE, isEmailVerified: false });

    const res = await request(mount(chain, student)).get('/probe');

    expect(res.status).toBe(403);
    expect(res.body.message).toBe(MESSAGES.AUTH.EMAIL_NOT_VERIFIED);
  });
});

// ── Tripwire: the three gated surfaces do not exist yet ─────────────────────

describe('the surfaces plan:352 names are still absent', () => {
  // plan:352 says to mount requireVerifiedEmail on POST /enrollments, POST
  // /courses and every quiz submission (apidoc:131, TRD:1482). All three belong
  // to modules that are still empty files, so there is nothing to mount it on
  // and this test is what makes that state deliberate rather than forgotten.
  //
  // WHEN THIS FAILS, IT IS BECAUSE THE ROUTE IT NAMES NOW EXISTS. Mount
  // requireVerifiedEmail on it — after requireAuth and requireRole — and delete
  // the entry from the list below. When the list empties, delete this block.
  //
  // Task 3.9 handed /auth/logout and /auth/me to 3.10 the same way.
  const surfaces = [
    { name: 'POST /enrollments', path: '/api/v1/enrollments', owner: 'Day 5' },
    {
      name: 'POST /quizzes/:id/submit',
      path: '/api/v1/quizzes/3f1c9d8e-0000-4000-8000-000000000009/submit',
      owner: 'Day 6',
    },
  ];

  it.each(surfaces)(
    '$name is unrouted (it arrives in $owner)',
    async ({ path }) => {
      const app = express();
      app.use('/api/v1', apiRouter);

      const res = await request(app).post(path);

      expect(res.status).toBe(404);
    },
  );

  it('and review creation is deliberately not on that list', () => {
    // TRD:1590 guards POST /courses/:courseId/reviews on ENROLLMENT, which is
    // the stronger condition and belongs to the reviews service. plan:352 says
    // so explicitly; this assertion is here so the sentence is not the only
    // record of it.
    expect(surfaces.map(({ name }) => name)).not.toContain(
      'POST /courses/:courseId/reviews',
    );
  });
});
