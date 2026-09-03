import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { makeUser, makeCourse, makeEnrollment, makeQuiz, loginAs } from './factories.js';
import prisma from '../../src/database/index.js';

describe('Quizzes Integration', () => {
  let student, authHeader, course, module, lesson, quiz, q1, q2;

  beforeEach(async () => {
    student = await makeUser({ role: 'STUDENT' });
    authHeader = loginAs(student);
    course = await makeCourse({ isPublished: true });

    module = await prisma.module.create({
      data: { title: 'Module 1', courseId: course.id, orderIndex: 0 }
    });

    lesson = await prisma.lesson.create({
      data: { title: 'Quiz Lesson', moduleId: module.id, type: 'QUIZ', orderIndex: 0, content: 'Quiz' }
    });

    quiz = await makeQuiz(course.id, lesson.id, { maxAttempts: 2, passingScore: 50 });

    q1 = await prisma.quizQuestion.create({
      data: {
        quizId: quiz.id,
        questionText: 'Q1',
        options: ['A', 'B', 'C'],
        correctAnswerIndex: 0, // A
        orderIndex: 0
      }
    });

    q2 = await prisma.quizQuestion.create({
      data: {
        quizId: quiz.id,
        questionText: 'Q2',
        options: ['X', 'Y', 'Z'],
        correctAnswerIndex: 1, // Y
        orderIndex: 1
      }
    });

    await makeEnrollment(student.id, course.id);
  });

  it('calculates score correctly on submission', async () => {
    const res = await request(app)
      .post(`/api/v1/quizzes/${quiz.id}/submit`)
      .set('Authorization', authHeader)
      .send({
        answers: [
          { questionId: q1.id, selectedIndex: 0 }, // Correct
          { questionId: q2.id, selectedIndex: 0 }  // Incorrect
        ]
      });

    expect(res.status).toBe(200);
    expect(res.body.data.score).toBe(50); // 1 out of 2 correct
    expect(res.body.data.passed).toBe(true); // passingScore is 50
  });

  it('enforces max attempts', async () => {
    // Attempt 1
    const res1 = await request(app)
      .post(`/api/v1/quizzes/${quiz.id}/submit`)
      .set('Authorization', authHeader)
      .send({
        answers: [{ questionId: q1.id, selectedIndex: 2 }, { questionId: q2.id, selectedIndex: 2 }]
      });
    expect(res1.status).toBe(200);
    expect(res1.body.data.score).toBe(0);

    // Attempt 2
    const res2 = await request(app)
      .post(`/api/v1/quizzes/${quiz.id}/submit`)
      .set('Authorization', authHeader)
      .send({
        answers: [{ questionId: q1.id, selectedIndex: 2 }, { questionId: q2.id, selectedIndex: 2 }]
      });
    expect(res2.status).toBe(200);

    // Attempt 3 (Should fail, maxAttempts is 2)
    const res3 = await request(app)
      .post(`/api/v1/quizzes/${quiz.id}/submit`)
      .set('Authorization', authHeader)
      .send({
        answers: [{ questionId: q1.id, selectedIndex: 0 }, { questionId: q2.id, selectedIndex: 1 }]
      });
    expect(res3.status).toBe(429); // or 403, depending on what they implemented. Let's assume 429 based on swagger
  });
});
