import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import prisma from '../../src/database/index.js';
import { makeUser, loginAs } from './factories.js';
import { execSync } from 'child_process';

describe('Aggregate Integrity Integration', () => {
  let student1, student2, student1Auth, student2Auth;
  let instructor, instructorAuth, instProfile;
  let course, subject;

  // Helper to create a course with at least one module and one lesson
  async function createCourseWithLesson(title, { isPublished = false } = {}) {
    const newCourse = await prisma.course.create({
      data: {
        title,
        slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
        description: 'Comprehensive course description that easily meets the validation requirements.',
        instructorId: instProfile.id,
        subjectId: subject.id,
        level: 'BEGINNER',
        price: 10.00,
        isPublished: false,
      }
    });

    const mod = await prisma.module.create({
      data: {
        courseId: newCourse.id,
        title: 'Module 1',
        orderIndex: 1,
      }
    });

    await prisma.lesson.create({
      data: {
        moduleId: mod.id,
        title: 'Lesson 1',
        orderIndex: 1,
        type: 'TEXT',
        content: 'Valid lesson content for aggregate testing.',
      }
    });

    if (isPublished) {
      await request(app)
        .put(`/api/v1/courses/${newCourse.id}`)
        .set('Authorization', instructorAuth)
        .send({ isPublished: true });
    }

    return newCourse;
  }

  beforeAll(async () => {
    student1 = await makeUser({ role: 'STUDENT', isEmailVerified: true });
    student1Auth = loginAs(student1);

    student2 = await makeUser({ role: 'STUDENT', isEmailVerified: true });
    student2Auth = loginAs(student2);

    instructor = await makeUser({ role: 'INSTRUCTOR', isEmailVerified: true });
    instructorAuth = loginAs(instructor);

    instProfile = await prisma.instructor.create({
      data: {
        userId: instructor.id,
        title: 'Aggregate Senior Instructor',
      }
    });

    subject = await prisma.subject.create({
      data: {
        name: 'Aggregates Subject ' + Date.now(),
        slug: 'aggregates-' + Date.now(),
        icon: 'code',
        color: '#6366F1',
      }
    });

    // Create a published course via helper + API so subject.courseCount is properly maintained
    course = await createCourseWithLesson('Aggregate Integrity Course', { isPublished: true });

    // Enroll students via API so course.studentCount and instructor.studentCount are properly incremented
    const enr1Res = await request(app)
      .post('/api/v1/enrollments')
      .set('Authorization', student1Auth)
      .send({ courseId: course.id });
    expect([200, 201]).toContain(enr1Res.status);

    const enr2Res = await request(app)
      .post('/api/v1/enrollments')
      .set('Authorization', student2Auth)
      .send({ courseId: course.id });
    expect([200, 201]).toContain(enr2Res.status);
  });

  describe('Review Aggregates', () => {
    let review1Id;

    it('moves course.rating and instructor.rating on create', async () => {
      const res = await request(app)
        .post(`/api/v1/courses/${course.id}/reviews`)
        .set('Authorization', student1Auth)
        .send({ rating: 4, comment: 'Good course' });

      expect(res.status).toBe(201);
      review1Id = res.body.data.id;

      const c = await prisma.course.findUnique({ where: { id: course.id } });
      const i = await prisma.instructor.findUnique({ where: { id: instProfile.id } });

      expect(c.reviewCount).toBe(1);
      expect(c.rating).toBe(4);
      expect(i.rating).toBe(4);
    });

    it('moves averages but leaves reviewCount fixed on update', async () => {
      const res = await request(app)
        .put(`/api/v1/reviews/${review1Id}`)
        .set('Authorization', student1Auth)
        .send({ rating: 2, comment: 'Changed my mind to lower' });

      expect(res.status).toBe(200);

      const c = await prisma.course.findUnique({ where: { id: course.id } });
      const i = await prisma.instructor.findUnique({ where: { id: instProfile.id } });

      expect(c.reviewCount).toBe(1);
      expect(c.rating).toBe(2);
      expect(i.rating).toBe(2);
    });

    it('updates correctly with multiple reviews', async () => {
      const res = await request(app)
        .post(`/api/v1/courses/${course.id}/reviews`)
        .set('Authorization', student2Auth)
        .send({ rating: 4, comment: 'Great course' });

      expect(res.status).toBe(201);

      const c = await prisma.course.findUnique({ where: { id: course.id } });
      const i = await prisma.instructor.findUnique({ where: { id: instProfile.id } });

      // Avg of 2 and 4 is 3
      expect(c.reviewCount).toBe(2);
      expect(c.rating).toBe(3);
      expect(i.rating).toBe(3);
    });

    it('moves ratings back when deleted', async () => {
      const res = await request(app)
        .delete(`/api/v1/reviews/${review1Id}`)
        .set('Authorization', student1Auth);

      expect(res.status).toBe(200);

      const c = await prisma.course.findUnique({ where: { id: course.id } });
      const i = await prisma.instructor.findUnique({ where: { id: instProfile.id } });

      // Only student2's review (rating 4) remains
      expect(c.reviewCount).toBe(1);
      expect(c.rating).toBe(4);
      expect(i.rating).toBe(4);
    });
  });

  describe('Course Publish / Subject CourseCount Aggregates', () => {
    let draftCourse;

    it('publish -> publish -> unpublish leaves subject.courseCount net zero', async () => {
      draftCourse = await createCourseWithLesson('Draft Course For Publish Test', { isPublished: false });

      const initialSubject = await prisma.subject.findUnique({ where: { id: subject.id } });
      const initialCount = initialSubject.courseCount; // Already 1 from `course` in beforeAll

      // 1. Publish: transitions to published -> increments subject.courseCount
      let res = await request(app)
        .put(`/api/v1/courses/${draftCourse.id}`)
        .set('Authorization', instructorAuth)
        .send({ isPublished: true });
      expect(res.status).toBe(200);

      let s = await prisma.subject.findUnique({ where: { id: subject.id } });
      expect(s.courseCount).toBe(initialCount + 1);

      // 2. Publish again: already published -> no-op on count
      res = await request(app)
        .put(`/api/v1/courses/${draftCourse.id}`)
        .set('Authorization', instructorAuth)
        .send({ isPublished: true });
      expect(res.status).toBe(200);

      s = await prisma.subject.findUnique({ where: { id: subject.id } });
      expect(s.courseCount).toBe(initialCount + 1);

      // 3. Unpublish: transitions to draft -> decrements subject.courseCount
      res = await request(app)
        .put(`/api/v1/courses/${draftCourse.id}`)
        .set('Authorization', instructorAuth)
        .send({ isPublished: false });
      expect(res.status).toBe(200);

      s = await prisma.subject.findUnique({ where: { id: subject.id } });
      expect(s.courseCount).toBe(initialCount);
    });

    it('instructor soft-delete of a published course decrements it', async () => {
      const pubCourse = await createCourseWithLesson('Published Course To Delete', { isPublished: true });

      const beforeS = await prisma.subject.findUnique({ where: { id: subject.id } });

      const res = await request(app)
        .delete(`/api/v1/courses/${pubCourse.id}`)
        .set('Authorization', instructorAuth);
      expect(res.status).toBe(200);

      const afterS = await prisma.subject.findUnique({ where: { id: subject.id } });
      expect(afterS.courseCount).toBe(beforeS.courseCount - 1);
    });

    it('instructor soft-delete of a draft course does not decrement subject.courseCount', async () => {
      const beforeS = await prisma.subject.findUnique({ where: { id: subject.id } });

      const res = await request(app)
        .delete(`/api/v1/courses/${draftCourse.id}`)
        .set('Authorization', instructorAuth);
      expect(res.status).toBe(200);

      const afterS = await prisma.subject.findUnique({ where: { id: subject.id } });
      expect(afterS.courseCount).toBe(beforeS.courseCount);
    });
  });

  describe('Reconciliation Script', () => {
    it('asserts zero drift at the end of the suite', () => {
      const stdout = execSync('npm run db:reconcile', { encoding: 'utf-8', env: process.env });
      expect(stdout).toMatch(/Divergences found: 0/);
    });
  });
});
