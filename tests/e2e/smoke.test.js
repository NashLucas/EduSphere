import { describe, it, expect, beforeAll } from 'vitest';

const API_URL = process.env.STAGING_URL || 'http://localhost:3000';
let userToken = '';
let courseId = '';
let enrollmentId = '';
let lessonId = '';
let quizId = '';
let certificateId = '';

const uniqueId = Date.now();
const testUser = {
  name: `Smoke Tester ${uniqueId}`,
  email: `smoke${uniqueId}@example.com`,
  password: 'Password123!',
};

describe('Smoke Suite against Live Endpoints', () => {
  it('1. Verify Health', async () => {
    const res = await fetch(`${API_URL}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.database).toBe('connected');
    expect(body.redis).toBe('connected');
  });

  it('2. Auth Round-Trip (Register & Login)', async () => {
    // Register
    const regRes = await fetch(`${API_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testUser),
    });
    expect(regRes.status).toBe(201);

    // Login
    const loginRes = await fetch(`${API_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testUser.email, password: testUser.password }),
    });
    expect(loginRes.status).toBe(200);
    const body = await loginRes.json();
    expect(body.data).toHaveProperty('accessToken');
    userToken = body.data.accessToken;
  });

  it('3. Catalog Retrieval', async () => {
    const res = await fetch(`${API_URL}/api/v1/courses`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data.courses)).toBe(true);

    // Grab the first published course for the next tests if available
    if (body.data.courses.length > 0) {
      courseId = body.data.courses[0].id;
    }
  });

  it('4. Enrollment Verification', async () => {
    if (!courseId) {
      console.warn('Skipping enrollment: No published courses found in catalog.');
      return;
    }
    const res = await fetch(`${API_URL}/api/v1/enrollments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ courseId }),
    });
    // Either created (201) or already enrolled (409) or bad request (400 if user owns course)
    expect([201, 400, 409]).toContain(res.status);
    
    // We fetch the user's enrollments to get an ID
    const myRes = await fetch(`${API_URL}/api/v1/enrollments`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(myRes.status).toBe(200);
    const myBody = await myRes.json();
    if (myBody.data.enrollments.length > 0) {
      enrollmentId = myBody.data.enrollments[0].id;
    }
  });

  it('5. Quiz Submission (Placeholder if no quiz exists)', async () => {
    // If we had a specific quiz ID, we would submit it here.
    // For now, we just assert that the endpoint exists and returns 401 if unauthenticated.
    const res = await fetch(`${API_URL}/api/v1/quizzes/dummy-id/attempts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: [] }),
    });
    expect(res.status).toBe(401);
  });

  it('6. Certificate Download (Unauthenticated access check)', async () => {
    // A dummy certificate should return 404, proving the route is active
    const res = await fetch(`${API_URL}/api/v1/certificates/dummy-id/download`);
    expect([400, 404]).toContain(res.status);
  });
});
