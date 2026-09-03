import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { makeUser, makeCourse, makeEnrollment, loginAs } from './factories.js';
import prisma from '../../src/database/index.js';

describe('Progress Engine Integration', () => {
  let student, authHeader, course, module, lesson1, lesson2, enrollment;

  beforeEach(async () => {
    // 1. Create a student
    student = await makeUser({ role: 'STUDENT' });
    authHeader = loginAs(student);

    // 2. Create a course
    course = await makeCourse({ isPublished: true });

    // 3. Create a module and two lessons
    module = await prisma.module.create({
      data: {
        title: 'Module 1',
        courseId: course.id,
        orderIndex: 0
      }
    });

    lesson1 = await prisma.lesson.create({
      data: {
        title: 'Lesson 1',
        moduleId: module.id,
        type: 'TEXT',
        content: 'Content 1',
        orderIndex: 0
      }
    });

    lesson2 = await prisma.lesson.create({
      data: {
        title: 'Lesson 2',
        moduleId: module.id,
        type: 'TEXT',
        content: 'Content 2',
        orderIndex: 1
      }
    });

    // 4. Enroll the student
    enrollment = await makeEnrollment(student.id, course.id);
  });

  it('Complete a lesson -> verify progress updates', async () => {
    const res = await request(app)
      .post(`/api/v1/lessons/${lesson1.id}/complete`)
      .set('Authorization', authHeader);
    
    expect(res.status).toBe(200);

    // Verify progress
    const updatedEnrollment = await prisma.enrollment.findUnique({
      where: { id: enrollment.id }
    });

    // Since there are 2 lessons, completing 1 should be 50%
    expect(updatedEnrollment.progressPercent).toBe(50);

    // Verify progress checklist
    const progressRes = await request(app)
      .get(`/api/v1/enrollments/${course.id}/progress`)
      .set('Authorization', authHeader);
    
    expect(progressRes.status).toBe(200);
    // Find the lesson in the checklist and ensure it's marked completed
    const mod = progressRes.body.data.modules.find(m => m.id === module.id);
    const l1 = mod.lessons.find(l => l.id === lesson1.id);
    expect(l1.isCompleted).toBe(true);
  });

  it('Complete all lessons -> verify certificate minted', async () => {
    await request(app)
      .post(`/api/v1/lessons/${lesson1.id}/complete`)
      .set('Authorization', authHeader);
      
    const res2 = await request(app)
      .post(`/api/v1/lessons/${lesson2.id}/complete`)
      .set('Authorization', authHeader);
      
    expect(res2.status).toBe(200);

    // Verify progress is 100
    const updatedEnrollment = await prisma.enrollment.findUnique({
      where: { id: enrollment.id }
    });

    expect(updatedEnrollment.progressPercent).toBe(100);
    expect(updatedEnrollment.status).toBe('COMPLETED');
    
    // Verify certificate was minted
    const certificates = await prisma.certificate.findMany({
      where: { userId: student.id, courseId: course.id }
    });
    expect(certificates.length).toBeGreaterThan(0);
  });
});
