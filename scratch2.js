import request from 'supertest';
import app from './src/app.js';
import { makeUser, makeCourse, makeEnrollment, loginAs } from './tests/integration/factories.js';
import prisma from './src/database/index.js';

async function run() {
  const student = await makeUser({ role: 'STUDENT' });
  const authHeader = loginAs(student);

  const course = await makeCourse({ isPublished: true });

  const module = await prisma.module.create({
    data: { title: 'Module 1', courseId: course.id, orderIndex: 0 }
  });

  const lesson1 = await prisma.lesson.create({
    data: { title: 'Lesson 1', moduleId: module.id, type: 'TEXT', content: 'Content 1', orderIndex: 0 }
  });

  const enrollment = await makeEnrollment(student.id, course.id);

  const res = await request(app)
    .post(`/api/v1/lessons/${lesson1.id}/complete`)
    .set('Authorization', authHeader);

  console.log('STATUS:', res.status);
  console.log('BODY:', JSON.stringify(res.body, null, 2));
}

run().catch(console.error);
