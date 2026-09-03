import request from 'supertest';
import app from './src/app.js';
import { makeUser, makeCourse, makeEnrollment, loginAs } from './tests/integration/factories.js';
import prisma from './src/database/index.js';

async function run() {
  console.log('1. creating student');
  const student = await makeUser({ role: 'STUDENT' });
  const authHeader = loginAs(student);

  console.log('2. creating course');
  const course = await makeCourse({ isPublished: true });

  console.log('3. creating module');
  const module = await prisma.module.create({
    data: { title: 'Module 1', courseId: course.id, orderIndex: 0 }
  });

  console.log('4. creating lesson 1');
  const lesson1 = await prisma.lesson.create({
    data: { title: 'Lesson 1', moduleId: module.id, type: 'TEXT', content: 'Content 1', orderIndex: 0 }
  });
  console.log('5. creating lesson 2');
  const lesson2 = await prisma.lesson.create({
    data: { title: 'Lesson 2', moduleId: module.id, type: 'TEXT', content: 'Content 2', orderIndex: 1 }
  });

  console.log('6. creating enrollment');
  const enrollment = await makeEnrollment(student.id, course.id);

  console.log('7. completing lesson 1');
  const res = await request(app)
    .post(`/api/v1/lessons/${lesson1.id}/complete`)
    .set('Authorization', authHeader);

  console.log('STATUS 1:', res.status);
  if (res.status !== 200) console.log(res.body);
  
  console.log('8. completing lesson 2');
  const res2 = await request(app)
    .post(`/api/v1/lessons/${lesson2.id}/complete`)
    .set('Authorization', authHeader);

  console.log('STATUS 2:', res2.status);
  if (res2.status !== 200) console.log(res2.body);

  const updatedEnrollment = await prisma.enrollment.findUnique({
    where: { id: enrollment.id }
  });
  console.log('Progress:', updatedEnrollment.progressPercent);
  console.log('Status:', updatedEnrollment.status);

  const certificates = await prisma.certificate.findMany({
    where: { userId: student.id, courseId: course.id }
  });
  console.log('Certs:', certificates.length);
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
