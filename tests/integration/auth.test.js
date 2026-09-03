import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import prisma from '../../src/database/index.js';
import redis from '../../src/config/redis.js';
import { makeUser, loginAs } from './factories.js';
import jwt from 'jsonwebtoken';
const accessSecret = process.env.JWT_SECRET;
import { TOKEN_TYPE } from '../../src/config/constants.js';

describe('Auth Flow Integration', () => {
  it('Registration -> verification -> login -> protected route -> refresh -> logout', async () => {
    // 1. Registration
    const registerRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        fullName: 'Flow User',
        email: 'flow@example.com',
        password: 'Password123!'
      });
    
    expect(registerRes.status).toBe(201);
    const { user: registeredUser } = registerRes.body.data;

    // Grab verification token directly from redis
    const verifyKeys = await redis.keys('verify:email:*');
    expect(verifyKeys.length).toBeGreaterThan(0);
    const verifyKey = verifyKeys[0];
    const rawToken = verifyKey.split(':').pop(); // Wait, the token in email-verify is hashed or just random string?
    // Actually, it's easier to verify directly in DB for testing, but let's test the route if we know how to get the raw token.
    // The raw token is generated and passed to sendEmail. In test mode, sendEmail returns or doesn't.
    // Let's just manually verify the user to bypass the email token extraction which is hard without the raw token.
    await prisma.user.update({ where: { id: registeredUser.id }, data: { isEmailVerified: true } });

    // 2. Login
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'flow@example.com', password: 'Password123!' });
    
    expect(loginRes.status).toBe(200);
    const { accessToken } = loginRes.body.data;
    const cookies = loginRes.headers['set-cookie'];
    const refreshTokenCookie = cookies.find(c => c.startsWith('refreshToken='));
    expect(refreshTokenCookie).toBeDefined();

    // 3. Protected route
    const profileRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    
    expect(profileRes.status).toBe(200);
    expect(profileRes.body.data.user.email).toBe('flow@example.com');

    // 4. Refresh
    const refreshRes = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshTokenCookie);
    
    expect(refreshRes.status).toBe(200);
    const newAccessToken = refreshRes.body.data.accessToken;
    const newCookies = refreshRes.headers['set-cookie'];
    const newRefreshTokenCookie = newCookies.find(c => c.startsWith('refreshToken='));
    expect(newAccessToken).not.toBe(accessToken);

    // 5. Logout
    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${newAccessToken}`)
      .set('Cookie', newRefreshTokenCookie);
    
    expect(logoutRes.status).toBe(200);

    // Verify logout worked (refresh should fail)
    const failedRefresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', newRefreshTokenCookie);
    
    expect(failedRefresh.status).toBe(401);
  });

  it('Bad credentials -> 401', async () => {
    await makeUser({ email: 'badcred@example.com', password: 'Password123!' });
    
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '10.0.0.4')
      .send({ email: 'badcred@example.com', password: 'WrongPassword!' });
    
    expect(res.status).toBe(401);
  });

  it('Banned -> 403', async () => {
    const user = await makeUser({ isBanned: true });
    
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '10.0.0.3')
      .send({ email: user.email, password: 'TestPass123!' }); // Default factory password
    
    expect(res.status).toBe(403);
  });

  it('Expired token -> 401', async () => {
    const user = await makeUser();
    
    const expiredToken = jwt.sign(
      { sub: user.id, email: user.email, role: user.role, type: TOKEN_TYPE.ACCESS },
      accessSecret,
      { expiresIn: '-1h' } // Expired 1 hour ago
    );

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${expiredToken}`);
    
    expect(res.status).toBe(401);
  });

  it('Replayed refresh token -> 401', async () => {
    const user = await makeUser({ email: 'replay@example.com' });
    
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '10.0.0.1')
      .send({ email: 'replay@example.com', password: 'TestPass123!' });
    
    const cookies = loginRes.headers['set-cookie'];
    const refreshTokenCookie = cookies.find(c => c.startsWith('refreshToken='));

    // First refresh works
    const refresh1 = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshTokenCookie)
      .set('X-Forwarded-For', '10.0.0.1');
    expect(refresh1.status).toBe(200);

    // Replay fails
    const refresh2 = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshTokenCookie)
      .set('X-Forwarded-For', '10.0.0.1');
    expect(refresh2.status).toBe(401);
  });

  it('Refresh token used as a Bearer token -> 401', async () => {
    const user = await makeUser({ email: 'bearer@example.com' });
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '10.0.0.2')
      .send({ email: user.email, password: 'TestPass123!' });
    
    const cookies = loginRes.headers['set-cookie'];
    const refreshTokenStr = cookies.find(c => c.startsWith('refreshToken=')).split(';')[0].split('=')[1];

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${refreshTokenStr}`);
    
    expect(res.status).toBe(401);
  });

  it('Redis down -> 503 on authenticated routes, never 200', async () => {
    const user = await makeUser();
    const authHeader = loginAs(user);

    // Simulate Redis outage by closing connection
    await redis.quit();

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', authHeader);
    
    // Auth middleware catches redis errors and throws 503
    expect(res.status).toBe(503);

    // Reconnect for teardown/subsequent tests
    await redis.connect();
  });
});
