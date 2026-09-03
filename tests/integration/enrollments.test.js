import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { makeUser, makeCourse, loginAs, makeEnrollment } from './factories.js';
import prisma from '../../src/database/index.js';

describe('Enrollment Edge Cases Integration', () => {
  let student, studentAuth, course, instructor, instructorAuth;

  beforeEach(async () => {
    student = await makeUser({ role: 'STUDENT', isEmailVerified: true });
    studentAuth = loginAs(student);

    instructor = await makeUser({ role: 'INSTRUCTOR', isEmailVerified: true });
    instructorAuth = loginAs(instructor);

    // Create the instructor profile for the user
    const instProfile = await prisma.instructor.create({
      data: { userId: instructor.id, title: 'Test Instructor' }
    });

    course = await makeCourse({ isPublished: true, instructorId: instProfile.id });
  });

  it('rejects unverified email', async () => {
    const unverifiedStudent = await makeUser({ role: 'STUDENT', isEmailVerified: false });
    const unverifiedAuth = loginAs(unverifiedStudent);

    const res = await request(app)
      .post('/api/v1/enrollments')
      .set('Authorization', unverifiedAuth)
      .send({ courseId: course.id });

    expect(res.status).toBe(403);
  });

  it('rejects self-enrollment by the instructor', async () => {
    const res = await request(app)
      .post('/api/v1/enrollments')
      .set('Authorization', instructorAuth)
      .send({ courseId: course.id });

    expect(res.status).toBe(422);
  });

  it('rejects enrollment in unpublished or soft-deleted course', async () => {
    const draftCourse = await makeCourse({ isPublished: false });

    const res = await request(app)
      .post('/api/v1/enrollments')
      .set('Authorization', studentAuth)
      .send({ courseId: draftCourse.id });

    expect(res.status).toBe(404);
  });

  it('rejects duplicate active enrollment', async () => {
    // First enrollment
    await request(app)
      .post('/api/v1/enrollments')
      .set('Authorization', studentAuth)
      .send({ courseId: course.id });

    // Second enrollment
    const res = await request(app)
      .post('/api/v1/enrollments')
      .set('Authorization', studentAuth)
      .send({ courseId: course.id });

    expect(res.status).toBe(409);
  });

  it('drops enrollment preserving progress and does not decrement studentCount', async () => {
    // First enrollment
    await request(app)
      .post('/api/v1/enrollments')
      .set('Authorization', studentAuth)
      .send({ courseId: course.id });

    const c1 = await prisma.course.findUnique({ where: { id: course.id } });
    expect(c1.studentCount).toBe(1);

    // Drop enrollment
    const dropRes = await request(app)
      .patch(`/api/v1/enrollments/${course.id}/drop`)
      .set('Authorization', studentAuth);
    
    expect(dropRes.status).toBe(200);
    expect(dropRes.body.data.status).toBe('DROPPED');

    const c2 = await prisma.course.findUnique({ where: { id: course.id } });
    expect(c2.studentCount).toBe(1); // Does not decrement!
  });

  it('reactivates dropped enrollment without incrementing studentCount', async () => {
    // 1. Enroll
    await request(app)
      .post('/api/v1/enrollments')
      .set('Authorization', studentAuth)
      .send({ courseId: course.id });

    // 2. Drop
    await request(app)
      .patch(`/api/v1/enrollments/${course.id}/drop`)
      .set('Authorization', studentAuth);

    const c1 = await prisma.course.findUnique({ where: { id: course.id } });
    expect(c1.studentCount).toBe(1);

    // 3. Re-enroll
    const res = await request(app)
      .post('/api/v1/enrollments')
      .set('Authorization', studentAuth)
      .send({ courseId: course.id });

    expect(res.status).toBe(200);

    const c2 = await prisma.course.findUnique({ where: { id: course.id } });
    expect(c2.studentCount).toBe(1); // Did not increment again!
  });
});
