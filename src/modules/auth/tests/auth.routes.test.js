// ─────────────────────────────────────────────────────────────────────────────
// Auth router + controller tests — task 3.9.
//
// This suite tests the WIRING, and the service is mocked on purpose. auth.service
// .test.js already covers what those nine functions do across 238 cases; repeating
// any of it here would mean two places to update when a rule changes, and neither
// would be testing what 3.9 actually added. What 3.9 added is: which middleware
// runs, in which order, on which path, with which schema, and what shape comes back
// out — so every assertion below is about one of those.
//
// ── THE APP UNDER TEST IS THE REAL src/app.js ────────────────────────────────
//
// Not a hand-built express app with the router bolted on. A hand-built app would
// pass while the /api/v1 mount was missing, while cookieParser was mounted after
// the router, or while the error handler had three parameters — and those are
// exactly the failures this task can introduce. Importing the real app costs no
// connections (the Prisma export is a lazy Proxy, the Redis client is lazyConnect)
// and its own header documents that.
//
// Only two of its dependencies are replaced: the auth service, and the request
// logger. The logger mock is what keeps a pino line per request out of the test
// output, and it hands the guard a `req.log` to assert against.
//
// ── EVERY REQUEST CARRIES ITS OWN X-Forwarded-For ────────────────────────────
//
// The 5/15-min limiter is ONE express-rate-limit instance with ONE in-memory store
// shared by all six routes, and it lives at module scope — so it does not reset
// between tests, and the sixth request in this FILE would 429 no matter which test
// made it. `trust proxy` is 1 in app.js, so an X-Forwarded-For gives each request
// its own bucket (measured). The `post`/`get` helpers below never omit it, and the
// two tests that are ABOUT the limiter pin one address deliberately.
// ─────────────────────────────────────────────────────────────────────────────

import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MESSAGES } from '../../../config/system_messages.js';
import { UnauthorizedError } from '../../../utils/app-error.js';

// vi.mock factories are hoisted above the imports, so the spies they close over
// have to be created by vi.hoisted rather than at module scope.
const svc = vi.hoisted(() => ({
  forgotPassword: vi.fn(),
  getProfile: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  refresh: vi.fn(),
  register: vi.fn(),
  resetPassword: vi.fn(),
  signAccessToken: vi.fn(),
  verifyEmail: vi.fn(),
}));

const log = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  info: vi.fn(),
  trace: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../../middlewares/logging.middleware.js', () => ({
  logger: { child: () => log, ...log },
  // A stand-in for pino-http that installs the one thing app.js and the Origin
  // guard read off the request, and writes nothing.
  httpLogger: (req, _res, next) => {
    req.log = log;
    next();
  },
  default: { logger: log },
}));

// importOriginal keeps REFRESH_COOKIE real — the Set-Cookie assertions below are
// only worth making against the constant production uses.
vi.mock('../auth.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  ...svc,
}));

const { default: app } = await import('../../../app.js');
const { REFRESH_COOKIE } = await import('../auth.service.js');
const { requireSameOrigin } = await import('../auth.routes.js');
const controller = await import('../auth.controller.js');

// ── Fixtures ─────────────────────────────────────────────────────────────────

const USER = Object.freeze({
  id: '3f1c9d8e-0000-4000-8000-000000000001',
  fullName: 'Alex Morgan',
  email: 'alex@example.com',
  role: 'STUDENT',
  isEmailVerified: false,
});

const PROFILE = Object.freeze({
  ...USER,
  avatarUrl: null,
  bio: null,
  createdAt: new Date('2026-08-25T09:14:02.518Z'),
});

const PASSWORD = 'SecurePassword123';
const TOKEN = 'a1b2c3d4'.repeat(8); // 64 hex characters — TOKEN.LENGTH

// Deliberately untrimmed and mixed-case, so the assertion on what reaches the
// service also proves the schema's trim/toLowerCase/default ran on the way in.
const REGISTER_BODY = Object.freeze({
  fullName: '  Alex Morgan  ',
  email: 'Alex@Example.COM',
  password: PASSWORD,
});

const REGISTER_PARSED = Object.freeze({
  fullName: 'Alex Morgan',
  email: 'alex@example.com',
  password: PASSWORD,
  role: 'STUDENT',
});

const ORIGIN = 'http://localhost:5173';

// ── Helpers ──────────────────────────────────────────────────────────────────

// Three octets of counter: ~16M distinct buckets, so no test can collide with
// another however many requests the file grows to.
let ipSeed = 0;
const nextIp = () => {
  ipSeed += 1;
  return `10.${(ipSeed >> 16) & 255}.${(ipSeed >> 8) & 255}.${ipSeed & 255}`;
};

const post = (path, ip = nextIp()) =>
  request(app).post(path).set('X-Forwarded-For', ip);

const get = (path, ip = nextIp()) =>
  request(app).get(path).set('X-Forwarded-For', ip);

const setCookieOf = (res) => (res.headers['set-cookie'] ?? []).join('\n');

/** A bare app around one middleware: 204 means it called next(), 4xx means it did not. */
const isolate = (...stack) => {
  const bare = express();
  bare.use(cookieParser());
  bare.post('/probe', ...stack, (_req, res) => res.status(204).end());
  bare.get('/probe', ...stack, (_req, res) => res.status(204).end());
  // Express identifies an error handler by arity alone, so the fourth parameter
  // has to be declared even though this one never delegates. Dropping it turns the
  // whole helper into ordinary middleware that never runs, and every isolate()
  // test would read Express's default HTML error page instead of a status code.
  //
  // eslint-disable-next-line no-unused-vars -- see above.
  bare.use((err, _req, res, _next) =>
    res.status(err.statusCode ?? 500).json({ message: err.message }),
  );
  return bare;
};

/**
 * Stands in for requireAuth in the isolated stacks that test one route's own
 * middleware order. Mirrors the real guard's contract as of task 3.10 -- the same
 * three fields, frozen -- so a handler that starts reading something requireAuth
 * does not attach fails here too.
 */
const asUser = (req, _res, next) => {
  req.user = Object.freeze({
    id: USER.id,
    email: USER.email,
    role: USER.role,
  });
  next();
};

const withCorsOrigin = (value, fn) => async () => {
  const before = process.env.CORS_ORIGIN;
  if (value === undefined) delete process.env.CORS_ORIGIN;
  else process.env.CORS_ORIGIN = value;
  try {
    await fn();
  } finally {
    if (before === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = before;
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  svc.register.mockResolvedValue(USER);
  svc.signAccessToken.mockReturnValue('access.minted');
  svc.login.mockResolvedValue({
    user: USER,
    accessToken: 'access.login',
    refreshToken: 'refresh.login',
  });
  svc.refresh.mockResolvedValue({
    accessToken: 'access.rotated',
    refreshToken: 'refresh.rotated',
  });
  svc.logout.mockResolvedValue({ revoked: true });
  svc.verifyEmail.mockResolvedValue(undefined);
  svc.forgotPassword.mockResolvedValue(undefined);
  svc.resetPassword.mockResolvedValue(undefined);
  svc.getProfile.mockResolvedValue(PROFILE);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the /api/v1 mount (app.js + routes/v1.js)', () => {
  it('reaches the auth router at /api/v1/auth/*', async () => {
    const res = await post('/api/v1/auth/register').send(REGISTER_BODY);

    expect(res.status).toBe(201);
    expect(svc.register).toHaveBeenCalledTimes(1);
  });

  it('does NOT serve the router at the unversioned path', async () => {
    // The version prefix belongs to app.js's mount, not to the module router. If
    // this ever answers 201 the router has grown its own '/api/v1'.
    const res = await post('/auth/register').send(REGISTER_BODY);

    expect(res.status).toBe(404);
    expect(svc.register).not.toHaveBeenCalled();
  });

  it('404s an unknown path under the router with the interpolated message', async () => {
    const res = await get('/api/v1/auth/nope');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      status: 'error',
      message: 'Cannot GET /api/v1/auth/nope',
    });
  });

  it('404s a known path on the wrong method', async () => {
    // Express 5 falls through to the terminal handler rather than answering 405,
    // which is what apidoc's error table describes.
    const res = await get('/api/v1/auth/register');

    expect(res.status).toBe(404);
    expect(svc.register).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('canonical envelopes and status codes', () => {
  it('register answers 201 with { user, accessToken } and the pinned message', async () => {
    const res = await post('/api/v1/auth/register').send(REGISTER_BODY);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      status: 'success',
      message: MESSAGES.AUTH.REGISTERED,
      data: { user: USER, accessToken: 'access.minted' },
    });
  });

  it('register hands the service the PARSED body, not the raw one', async () => {
    await post('/api/v1/auth/register').send(REGISTER_BODY);

    expect(svc.register).toHaveBeenCalledWith(REGISTER_PARSED);
  });

  it('register mints its access token from the row the service returned', async () => {
    await post('/api/v1/auth/register').send(REGISTER_BODY);

    expect(svc.signAccessToken).toHaveBeenCalledWith(USER);
  });

  it('register sets NO cookie — it opens no session', async () => {
    const res = await post('/api/v1/auth/register').send(REGISTER_BODY);

    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('login answers 200 with { user, accessToken } and its own message', async () => {
    const res = await post('/api/v1/auth/login').send({
      email: USER.email,
      password: PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'success',
      message: MESSAGES.AUTH.LOGGED_IN,
      data: { user: USER, accessToken: 'access.login' },
    });
  });

  it('login keeps the refresh token OUT of the body', async () => {
    const res = await post('/api/v1/auth/login').send({
      email: USER.email,
      password: PASSWORD,
    });

    expect(JSON.stringify(res.body)).not.toContain('refresh.login');
  });

  it('login sets the refresh cookie with every attribute apidoc pins', async () => {
    const res = await post('/api/v1/auth/login').send({
      email: USER.email,
      password: PASSWORD,
    });
    const cookie = setCookieOf(res);

    expect(cookie).toContain(`${REFRESH_COOKIE.name}=refresh.login`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure'); // NODE_ENV is 'test' under Vitest
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toMatch(/Max-Age=604800/);
  });

  it('login hands the service the credentials and the request provenance', async () => {
    await post('/api/v1/auth/login', '9.9.9.9')
      .set('User-Agent', 'ProbeAgent/1.0')
      .send({ email: USER.email, password: PASSWORD });

    expect(svc.login).toHaveBeenCalledWith(
      { email: USER.email, password: PASSWORD },
      { ip: '9.9.9.9', userAgent: 'ProbeAgent/1.0' },
    );
  });

  it('login records userAgent as null rather than undefined when absent', async () => {
    // Supertest always sends a User-Agent, so this asserts the coercion at the
    // controller instead — a JSON undefined would vanish on serialization and the
    // session records would not all have the same shape.
    const res = {
      cookie: vi.fn(),
      status: vi.fn(() => res),
      json: vi.fn(() => res),
    };
    await controller.loginHandler(
      { body: {}, ip: '1.2.3.4', get: () => undefined },
      res,
    );

    expect(svc.login).toHaveBeenCalledWith(
      {},
      { ip: '1.2.3.4', userAgent: null },
    );
  });

  it('refresh answers 200 with the access token ALONE', async () => {
    const res = await post('/api/v1/auth/refresh').set(
      'Cookie',
      `${REFRESH_COOKIE.name}=cookie.value`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'success',
      message: MESSAGES.AUTH.SESSION_REFRESHED,
      data: { accessToken: 'access.rotated' },
    });
  });

  it('refresh reads the token from the cookie and rotates it', async () => {
    const res = await post('/api/v1/auth/refresh', '8.8.8.8')
      .set('Cookie', `${REFRESH_COOKIE.name}=cookie.value`)
      .set('User-Agent', 'ProbeAgent/1.0');

    expect(svc.refresh).toHaveBeenCalledWith('cookie.value', {
      ip: '8.8.8.8',
      userAgent: 'ProbeAgent/1.0',
    });
    expect(setCookieOf(res)).toContain(
      `${REFRESH_COOKIE.name}=refresh.rotated`,
    );
  });

  it('refresh passes undefined when no cookie was sent', async () => {
    await post('/api/v1/auth/refresh');

    expect(svc.refresh).toHaveBeenCalledWith(undefined, expect.any(Object));
  });

  it('verify-email answers 200 with an empty data object', async () => {
    const res = await post('/api/v1/auth/verify-email').send({ token: TOKEN });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'success',
      message: MESSAGES.AUTH.EMAIL_VERIFIED,
      data: {},
    });
    expect(svc.verifyEmail).toHaveBeenCalledWith({ token: TOKEN });
  });

  it('forgot-password answers 200 with the non-committal message', async () => {
    const res = await post('/api/v1/auth/forgot-password').send({
      email: USER.email,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'success',
      message: MESSAGES.AUTH.PASSWORD_RESET_SENT,
      data: {},
    });
  });

  it('reset-password answers 200 and sets no cookie', async () => {
    const res = await post('/api/v1/auth/reset-password').send({
      token: TOKEN,
      newPassword: 'BrandNewPassword2026',
    });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe(MESSAGES.AUTH.PASSWORD_RESET);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(svc.resetPassword).toHaveBeenCalledWith({
      token: TOKEN,
      newPassword: 'BrandNewPassword2026',
    });
  });

  it('never emits a payload key other than data', async () => {
    const res = await post('/api/v1/auth/register').send(REGISTER_BODY);

    expect(Object.keys(res.body).sort()).toEqual(['data', 'message', 'status']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('errors travel to the global handler untouched', () => {
  it('an AppError from a service keeps its status and message', async () => {
    // The point of no try/catch and no asyncHandler: Express 5 forwards the
    // rejection itself, so a 401 cannot be flattened into a 500 on the way out.
    svc.login.mockRejectedValue(
      UnauthorizedError(MESSAGES.AUTH.INVALID_CREDENTIALS),
    );

    const res = await post('/api/v1/auth/login').send({
      email: USER.email,
      password: PASSWORD,
    });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      status: 'error',
      message: MESSAGES.AUTH.INVALID_CREDENTIALS,
    });
    expect(res.body.data).toBeUndefined();
  });

  it('an unexpected throw becomes a 500 that leaks nothing', async () => {
    svc.forgotPassword.mockRejectedValue(
      new Error('ECONNREFUSED 127.0.0.1:5432'),
    );

    const res = await post('/api/v1/auth/forgot-password').send({
      email: USER.email,
    });

    expect(res.status).toBe(500);
    expect(res.body.message).toBe(MESSAGES.COMMON.INTERNAL_ERROR);
    expect(JSON.stringify(res.body)).not.toContain('5432');
  });

  it('a synchronous throw in a handler is forwarded too', async () => {
    svc.verifyEmail.mockImplementation(() => {
      throw UnauthorizedError('sync');
    });

    const res = await post('/api/v1/auth/verify-email').send({ token: TOKEN });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Zod validation is wired per route', () => {
  it('register reports one errors[] entry per missing field', async () => {
    const res = await post('/api/v1/auth/register').send({
      email: 'not-an-email',
    });

    expect(res.status).toBe(422);
    expect(res.body.status).toBe('error');
    expect(res.body.message).toBe(MESSAGES.COMMON.VALIDATION_FAILED);
    expect(res.body.errors).toEqual([
      { field: 'fullName', message: 'Required' },
      { field: 'email', message: MESSAGES.VALIDATION.EMAIL_INVALID },
      { field: 'password', message: 'Required' },
    ]);
  });

  it('a 422 carries errors[] and no data', async () => {
    const res = await post('/api/v1/auth/register').send({});

    expect(res.body.data).toBeUndefined();
    expect(Array.isArray(res.body.errors)).toBe(true);
  });

  it('a validation failure never reaches the service', async () => {
    await post('/api/v1/auth/register').send({});

    expect(svc.register).not.toHaveBeenCalled();
  });

  it('register refuses role: ADMIN — self-registration cannot mint an admin', async () => {
    const res = await post('/api/v1/auth/register').send({
      ...REGISTER_BODY,
      role: 'ADMIN',
    });

    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual([
      { field: 'role', message: MESSAGES.VALIDATION.ROLE_INVALID },
    ]);
  });

  it('login checks password presence only, not the policy', async () => {
    const res = await post('/api/v1/auth/login').send({
      email: USER.email,
      password: 'x',
    });

    expect(res.status).toBe(200);
  });

  it('login rejects an empty password', async () => {
    const res = await post('/api/v1/auth/login').send({
      email: USER.email,
      password: '',
    });

    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual([
      { field: 'password', message: MESSAGES.VALIDATION.PASSWORD_REQUIRED },
    ]);
  });

  it('verify-email rejects a token that is not 64 hex characters', async () => {
    const res = await post('/api/v1/auth/verify-email').send({ token: 'nope' });

    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual([
      { field: 'token', message: MESSAGES.VALIDATION.TOKEN_INVALID },
    ]);
    expect(svc.verifyEmail).not.toHaveBeenCalled();
  });

  it('forgot-password rejects a malformed address', async () => {
    const res = await post('/api/v1/auth/forgot-password').send({ email: 'x' });

    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual([
      { field: 'email', message: MESSAGES.VALIDATION.EMAIL_INVALID },
    ]);
  });

  it('reset-password applies the full password policy to newPassword', async () => {
    const res = await post('/api/v1/auth/reset-password').send({
      token: TOKEN,
      newPassword: 'alllowercase',
    });

    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual([
      { field: 'newPassword', message: MESSAGES.VALIDATION.PASSWORD_WEAK },
    ]);
  });

  it('every route rejects an unrecognised key', async () => {
    const res = await post('/api/v1/auth/forgot-password').send({
      email: USER.email,
      isAdmin: true,
    });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].field).toBe('isAdmin');
  });

  it('refresh accepts a request with no body at all', async () => {
    // refreshSchema preprocesses an absent body to {}, which is why the route can
    // be validated at all: express.json() leaves req.body undefined for a POST
    // that sends nothing.
    const res = await post('/api/v1/auth/refresh');

    expect(res.status).toBe(200);
    expect(svc.refresh).toHaveBeenCalledTimes(1);
  });

  it('refresh refuses a body — the token comes from the cookie', async () => {
    const res = await post('/api/v1/auth/refresh').send({
      refreshToken: 'from.the.body',
    });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].field).toBe('refreshToken');
    expect(svc.refresh).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the 5 req / 15 min limiter', () => {
  it('lets five through and refuses the sixth', async () => {
    const ip = '172.20.1.1';
    const codes = [];
    for (let i = 0; i < 6; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- the limiter counts in order.
      const res = await post('/api/v1/auth/forgot-password', ip).send({
        email: USER.email,
      });
      codes.push(res.status);
    }

    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('answers the 429 with the canonical envelope and Retry-After', async () => {
    const ip = '172.20.1.2';
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- as above.
      await post('/api/v1/auth/forgot-password', ip).send({
        email: USER.email,
      });
    }
    const res = await post('/api/v1/auth/forgot-password', ip).send({
      email: USER.email,
    });

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({
      status: 'error',
      message: MESSAGES.COMMON.RATE_LIMITED,
    });
    expect(res.headers['retry-after']).toBe('900');
    expect(res.headers['ratelimit-remaining']).toBe('0');
  });

  it('shares ONE bucket across all six routes', async () => {
    // The documented cost of one rateLimit() instance per tier: five logins spend
    // the allowance a password reset would have used.
    const ip = '172.20.1.3';
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- as above.
      await post('/api/v1/auth/login', ip).send({
        email: USER.email,
        password: PASSWORD,
      });
    }
    const res = await post('/api/v1/auth/verify-email', ip).send({
      token: TOKEN,
    });

    expect(res.status).toBe(429);
  });

  it('keys on the client address, so one caller cannot exhaust another', async () => {
    const ip = '172.20.1.4';
    for (let i = 0; i < 6; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- as above.
      await post('/api/v1/auth/forgot-password', ip).send({
        email: USER.email,
      });
    }

    const other = await post('/api/v1/auth/forgot-password', '172.20.1.5').send(
      {
        email: USER.email,
      },
    );

    expect(other.status).toBe(200);
  });

  it('counts a request that fails validation, and one that is refused calls nothing', async () => {
    // The limiter is mounted ABOVE validate() so a malformed-body flood is metered
    // too; a 429 therefore reaches neither the validator nor the service.
    const ip = '172.20.1.6';
    const codes = [];
    for (let i = 0; i < 6; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- as above.
      const res = await post('/api/v1/auth/forgot-password', ip).send({
        email: 'garbage',
      });
      codes.push(res.status);
    }

    expect(codes).toEqual([422, 422, 422, 422, 422, 429]);
    expect(svc.forgotPassword).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('requireSameOrigin (TRD:1673)', () => {
  const cases = [
    ['neither header — not a browser', {}, 204],
    ['Origin exact', { Origin: ORIGIN }, 204],
    ['Origin with a trailing slash', { Origin: `${ORIGIN}/` }, 204],
    [
      'Referer, when Origin is absent',
      { Referer: `${ORIGIN}/login?next=/x#h` },
      204,
    ],
    ['Origin from another site', { Origin: 'http://evil.test' }, 401],
    ['Origin: null (opaque)', { Origin: 'null' }, 401],
    ['Origin that is not a URL', { Origin: 'not a url' }, 401],
    ['Origin with the wrong scheme', { Origin: 'https://localhost:5173' }, 401],
    ['Origin with the wrong port', { Origin: 'http://localhost:5174' }, 401],
    ['Origin on a subdomain', { Origin: 'http://evil.localhost:5173' }, 401],
    ['Referer from another site', { Referer: 'http://evil.test/x' }, 401],
    ['an empty Origin header', { Origin: '' }, 401],
    [
      'a foreign Origin beside a matching Referer — Origin wins',
      { Origin: 'http://evil.test', Referer: `${ORIGIN}/` },
      401,
    ],
    [
      'a matching Origin beside a foreign Referer — Origin wins',
      { Origin: ORIGIN, Referer: 'http://evil.test/x' },
      204,
    ],
  ];

  for (const [label, headers, expected] of cases) {
    it(
      `${expected === 204 ? 'allows' : 'refuses'} ${label}`,
      withCorsOrigin(ORIGIN, async () => {
        let req = request(isolate(requireSameOrigin)).post('/probe');
        for (const [key, value] of Object.entries(headers)) {
          req = req.set(key, value);
        }
        const res = await req;

        expect(res.status).toBe(expected);
      }),
    );
  }

  it(
    'refuses with the same 401 message as any other invalid session',
    withCorsOrigin(ORIGIN, async () => {
      const res = await request(isolate(requireSameOrigin))
        .post('/probe')
        .set('Origin', 'http://evil.test');

      expect(res.body.message).toBe(MESSAGES.AUTH.SESSION_INVALID);
    }),
  );

  it(
    'logs the refusal with both headers',
    withCorsOrigin(ORIGIN, async () => {
      await request(isolate(requireSameOrigin))
        .post('/probe')
        .set('Origin', 'http://evil.test');

      expect(log.warn).toHaveBeenCalledWith(
        { origin: 'http://evil.test', referer: null, expected: ORIGIN },
        expect.stringContaining('foreign origin'),
      );
    }),
  );

  it(
    'tolerates a CORS_ORIGIN that carries a trailing slash',
    withCorsOrigin(`${ORIGIN}/`, async () => {
      const res = await request(isolate(requireSameOrigin))
        .post('/probe')
        .set('Origin', ORIGIN);

      expect(res.status).toBe(204);
    }),
  );

  it(
    'allows everything, warning once, when CORS_ORIGIN is unset',
    withCorsOrigin(undefined, async () => {
      // A fresh module so the once-per-process flag starts down.
      vi.resetModules();
      const { requireSameOrigin: fresh } = await import('../auth.routes.js');
      const bare = isolate(fresh);

      const first = await request(bare)
        .post('/probe')
        .set('Origin', 'http://evil.test');
      const second = await request(bare)
        .post('/probe')
        .set('Origin', 'http://evil.test');

      expect([first.status, second.status]).toEqual([204, 204]);
      const warnings = log.warn.mock.calls.filter(([, msg]) =>
        String(msg).includes('CORS_ORIGIN'),
      );
      expect(warnings).toHaveLength(1);
    }),
  );

  it(
    'treats a CORS_ORIGIN that is not an http(s) origin as unconfigured',
    withCorsOrigin('localhost:5173', async () => {
      // new URL('localhost:5173') parses — scheme 'localhost:', origin the STRING
      // 'null' — so without the scheme check this would compare every request
      // against a value no browser can ever send and 401 the whole platform.
      vi.resetModules();
      const { requireSameOrigin: fresh } = await import('../auth.routes.js');

      const res = await request(isolate(fresh))
        .post('/probe')
        .set('Origin', 'http://evil.test');

      expect(res.status).toBe(204);
    }),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the Origin guard is mounted on refresh and nowhere else', () => {
  it(
    'refuses a cross-site refresh before the service is reached',
    withCorsOrigin(ORIGIN, async () => {
      const res = await post('/api/v1/auth/refresh')
        .set('Origin', 'http://evil.test')
        .set('Cookie', `${REFRESH_COOKIE.name}=stolen.value`);

      expect(res.status).toBe(401);
      expect(res.body.message).toBe(MESSAGES.AUTH.SESSION_INVALID);
      expect(svc.refresh).not.toHaveBeenCalled();
    }),
  );

  it(
    'allows a same-site refresh through to the service',
    withCorsOrigin(ORIGIN, async () => {
      const res = await post('/api/v1/auth/refresh')
        .set('Origin', ORIGIN)
        .set('Cookie', `${REFRESH_COOKIE.name}=cookie.value`);

      expect(res.status).toBe(200);
      expect(svc.refresh).toHaveBeenCalledTimes(1);
    }),
  );

  it(
    'does not guard the five header-authenticated routes',
    withCorsOrigin(ORIGIN, async () => {
      // Nothing on these routes rides an ambient cookie, so an Origin check would
      // only break non-browser clients.
      const res = await post('/api/v1/auth/register')
        .set('Origin', 'http://evil.test')
        .send(REGISTER_BODY);

      expect(res.status).toBe(201);
    }),
  );

  it(
    'still counts a cross-site attempt against the limiter',
    withCorsOrigin(ORIGIN, async () => {
      const ip = '172.20.2.1';
      const codes = [];
      for (let i = 0; i < 6; i += 1) {
        // eslint-disable-next-line no-await-in-loop -- the limiter counts in order.
        const res = await post('/api/v1/auth/refresh', ip).set(
          'Origin',
          'http://evil.test',
        );
        codes.push(res.status);
      }

      expect(codes).toEqual([401, 401, 401, 401, 401, 429]);
    }),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the two Authenticated routes (task 3.10)', () => {
  // Task 3.9 left this block holding a tripwire named "are not routable yet",
  // which asserted a 404 from both paths so that the deferral could not be
  // forgotten silently. Task 3.10 landed requireAuth and uncommented the two
  // registrations, so the tripwire was deleted and replaced by the four tests
  // below: the routes exist, and neither is reachable without the guard.
  //
  // What they do NOT do is authenticate. src/middlewares/tests/
  // auth.middleware.test.js owns the guard's behaviour against a mocked Redis
  // and Prisma; here the only question is whether it is mounted, and an
  // unauthenticated request answers that without either store being touched —
  // requireAuth refuses a request with no Authorization header before it reads
  // anything.

  it('are both mounted, and both refuse an unauthenticated caller', async () => {
    const logout = await post('/api/v1/auth/logout');
    const me = await get('/api/v1/auth/me');

    expect([logout.status, me.status]).toEqual([401, 401]);
    expect(logout.body).toEqual({
      status: 'error',
      message: MESSAGES.COMMON.UNAUTHENTICATED,
    });
    expect(me.body).toEqual({
      status: 'error',
      message: MESSAGES.COMMON.UNAUTHENTICATED,
    });
    expect(svc.logout).not.toHaveBeenCalled();
    expect(svc.getProfile).not.toHaveBeenCalled();
  });

  it('refuse a malformed Authorization header without reaching the service', async () => {
    const headers = ['Basic abc', 'Bearer', 'token-with-no-scheme', ''];

    for (const value of headers) {
      // eslint-disable-next-line no-await-in-loop -- one shared limiter bucket.
      const res = await get('/api/v1/auth/me').set('Authorization', value);

      expect(res.status).toBe(401);
    }

    expect(svc.getProfile).not.toHaveBeenCalled();
  });

  it('put requireAuth ahead of the origin guard on /auth/logout', async () => {
    // Both middlewares answer 401, so the MESSAGE is what identifies which one
    // ran: a foreign origin with no credential must be refused as
    // unauthenticated, not as an invalid session.
    const res = await post('/api/v1/auth/logout').set(
      'Origin',
      'http://evil.test',
    );

    expect(res.status).toBe(401);
    expect(res.body.message).toBe(MESSAGES.COMMON.UNAUTHENTICATED);
  });

  it('are not on the strict auth limiter', async () => {
    // apidoc §4:140 lists six endpoints for the 5/15-min tier and neither of
    // these is among them (constants.js:212), so seven calls from one address
    // must all still be answered by the guard rather than by a 429. Both routes,
    // separately: the limiter is a per-registration middleware, so covering one
    // of them says nothing about the other.
    for (const [i, path] of [
      '/api/v1/auth/me',
      '/api/v1/auth/logout',
    ].entries()) {
      const ip = `172.30.7.${i + 1}`;
      const codes = [];

      for (let n = 0; n < 7; n += 1) {
        // eslint-disable-next-line no-await-in-loop -- limiter counts in order.
        const res = await (path.endsWith('/me')
          ? get(path, ip)
          : post(path, ip));
        codes.push(res.status);
      }

      expect(codes, path).toEqual([401, 401, 401, 401, 401, 401, 401]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the two Authenticated handlers (task 3.9)', () => {
  it('logoutHandler answers 200 with data: null', async () => {
    const bare = isolate(asUser, controller.logoutHandler);

    const res = await request(bare)
      .post('/probe')
      .set('Cookie', `${REFRESH_COOKIE.name}=cookie.value`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'success',
      message: MESSAGES.AUTH.LOGGED_OUT,
      data: null,
    });
  });

  it('logoutHandler passes the cookie and the authenticated user id', async () => {
    await request(isolate(asUser, controller.logoutHandler))
      .post('/probe')
      .set('Cookie', `${REFRESH_COOKIE.name}=cookie.value`);

    expect(svc.logout).toHaveBeenCalledWith('cookie.value', {
      userId: USER.id,
    });
  });

  it('logoutHandler clears the cookie on the path it was set with', async () => {
    const res = await request(isolate(asUser, controller.logoutHandler))
      .post('/probe')
      .set('Cookie', `${REFRESH_COOKIE.name}=cookie.value`);
    const cookie = setCookieOf(res);

    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toContain(`${REFRESH_COOKIE.name}=;`);
    expect(cookie).not.toMatch(/Max-Age/i);
  });

  it('meHandler answers 200 with data.user for the token subject', async () => {
    const res = await request(isolate(asUser, controller.meHandler)).get(
      '/probe',
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'success',
      message: MESSAGES.COMMON.SUCCESS,
      data: {
        user: { ...PROFILE, createdAt: PROFILE.createdAt.toISOString() },
      },
    });
    expect(svc.getProfile).toHaveBeenCalledWith(USER.id);
  });

  it('meHandler ignores an id supplied by the caller (IDOR)', async () => {
    // The test above cannot see this: isolate() mounts a GET with no
    // express.json(), so req.body is undefined there and a handler reading
    // `req.body?.id ?? req.user.id` would fall back to the right answer and pass.
    // A mutation to exactly that survived the suite until this test existed. The
    // fake req carries BOTH, so only reading req.user.id gets the assertion.
    const res = {
      status: vi.fn(() => res),
      json: vi.fn(() => res),
    };
    await controller.meHandler(
      {
        body: { id: 'someone-elses-id' },
        query: { id: 'someone-elses-id' },
        params: { id: 'someone-elses-id' },
        user: { id: USER.id, role: USER.role },
      },
      res,
    );

    expect(svc.getProfile).toHaveBeenCalledWith(USER.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the swagger annotations render (plan:1033)', () => {
  // Verified against the generated spec, not the comment source: YAML inside a
  // block comment is easy to break in ways nothing else notices until 4.8 wires
  // the generator and 12.8 tries to sweep the whole surface.
  const build = async () => {
    const { default: swaggerJsdoc } = await import('swagger-jsdoc');
    return swaggerJsdoc({
      definition: {
        openapi: '3.0.0',
        info: { title: 'spec check', version: '1.0.0' },
        servers: [{ url: 'http://localhost:3000/api/v1' }],
        security: [{ bearerAuth: [] }],
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          },
        },
      },
      apis: ['./src/modules/auth/auth.routes.js'],
    });
  };

  it('publishes exactly the eight mounted endpoints', async () => {
    const spec = await build();

    expect(Object.keys(spec.paths).sort()).toEqual([
      '/auth/forgot-password',
      '/auth/login',
      '/auth/logout',
      '/auth/me',
      '/auth/refresh',
      '/auth/register',
      '/auth/reset-password',
      '/auth/verify-email',
    ]);
  });

  it('writes paths WITHOUT the /api/v1 the server URL already carries', async () => {
    const spec = await build();

    expect(
      Object.keys(spec.paths).filter((p) => p.includes('/api/v1')),
    ).toEqual([]);
  });

  it('opts every public route out of the global bearerAuth, and no others', async () => {
    // swagger.json applies security: [{ bearerAuth: [] }] globally, so a public
    // route that forgets `security: []` documents a token it does not accept and
    // swagger-ui sends one. The inverse matters just as much now that task 3.10
    // has mounted two guarded routes: `security: []` on one of THOSE would
    // publish an authenticated endpoint as public, and swagger-ui would stop
    // sending the token that is the only way to call it.
    const GUARDED = ['/auth/logout', '/auth/me'];
    const spec = await build();

    for (const [path, ops] of Object.entries(spec.paths)) {
      for (const [verb, op] of Object.entries(ops)) {
        if (GUARDED.includes(path)) {
          // Absent, so the global requirement applies unchanged.
          expect(op.security, `${verb} ${path}`).toBeUndefined();
        } else {
          expect(op.security, `${verb} ${path}`).toEqual([]);
        }
        expect(op.tags, `${verb} ${path}`).toEqual(['Authentication']);
        expect(op.summary, `${verb} ${path}`).toBeTruthy();
      }
    }
  });

  it('documents every status code each route can answer', async () => {
    const spec = await build();
    const codes = (p, verb = 'post') =>
      Object.keys(spec.paths[p][verb].responses).sort();

    expect(codes('/auth/register')).toEqual([
      '201',
      '409',
      '422',
      '429',
      '503',
    ]);
    expect(codes('/auth/login')).toEqual([
      '200',
      '401',
      '403',
      '422',
      '429',
      '503',
    ]);
    expect(codes('/auth/refresh')).toEqual(['200', '401', '422', '429', '503']);
    expect(codes('/auth/verify-email')).toEqual([
      '200',
      '400',
      '422',
      '429',
      '503',
    ]);
    expect(codes('/auth/forgot-password')).toEqual([
      '200',
      '422',
      '429',
      '503',
    ]);
    expect(codes('/auth/reset-password')).toEqual([
      '200',
      '400',
      '422',
      '429',
      '503',
    ]);
    // The two guarded routes (task 3.10). Neither is on a limiter, so neither
    // documents a 429; both can 403 (banned or soft-deleted, and on /auth/logout
    // a foreign Origin as well) and both can 503 when the state read fails.
    expect(codes('/auth/logout')).toEqual(['200', '401', '403', '503']);
    expect(codes('/auth/me', 'get')).toEqual([
      '200',
      '401',
      '403',
      '404',
      '503',
    ]);
  });

  it('resolves every $ref it emits', async () => {
    const spec = await build();
    const refs = new Set();
    JSON.stringify(spec, (key, value) => {
      if (key === '$ref') refs.add(value);
      return value;
    });

    expect(refs.size).toBeGreaterThan(0);
    for (const ref of refs) {
      const node = ref
        .replace(/^#\//, '')
        .split('/')
        .reduce((acc, part) => acc?.[part], spec);
      expect(node, ref).toBeDefined();
    }
  });

  it('describes the success bodies through the shared auth schemas', async () => {
    const spec = await build();
    const dataOf = (path, code) =>
      spec.paths[path].post.responses[code].content['application/json'].schema
        .properties.data;

    expect(dataOf('/auth/register', '201')).toEqual({
      $ref: '#/components/schemas/AuthSession',
    });
    expect(dataOf('/auth/login', '200')).toEqual({
      $ref: '#/components/schemas/AuthSession',
    });
    expect(Object.keys(spec.components.schemas).sort()).toEqual([
      'AuthProfile',
      'AuthSession',
      'AuthUser',
    ]);
  });

  it('never suggests a request body for the cookie-borne route', async () => {
    const spec = await build();

    expect(spec.paths['/auth/refresh'].post.requestBody).toBeUndefined();
    expect(spec.paths['/auth/refresh'].post.parameters).toEqual([
      expect.objectContaining({ in: 'cookie', name: REFRESH_COOKIE.name }),
    ]);
  });
});
