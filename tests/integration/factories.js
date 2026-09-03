import prisma from '../../src/database/index.js';
import bcrypt from 'bcryptjs';
import { signAccessToken } from '../../src/modules/auth/auth.service.js';

export async function makeUser(overrides = {}) {
  const email = overrides.email || `user-${Date.now()}-${Math.random()}@test.com`;
  const password = overrides.password || 'TestPass123!';
  const passwordHash = await bcrypt.hash(password, 4);

  return await prisma.user.create({
    data: {
      fullName: overrides.fullName || 'Test User',
      email,
      passwordHash,
      role: overrides.role || 'STUDENT',
      isEmailVerified: overrides.isEmailVerified !== undefined ? overrides.isEmailVerified : true,
      ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== 'password'))
    }
  });
}

export async function makeCourse(overrides = {}) {
  // Find a subject if none provided
  let subjectId = overrides.subjectId;
  if (!subjectId) {
    const subject = await prisma.subject.findFirst();
    subjectId = subject.id;
  }

  // Find or create instructor if none provided
  let instructorId = overrides.instructorId;
  if (!instructorId) {
    const user = await makeUser({ role: 'INSTRUCTOR' });
    const instructor = await prisma.instructor.create({
      data: { userId: user.id, title: 'Test Instructor' }
    });
    instructorId = instructor.id;
  }

  return await prisma.course.create({
    data: {
      title: overrides.title || `Course ${Date.now()}`,
      slug: overrides.slug || `course-${Date.now()}`,
      description: overrides.description || 'Test course description',
      subjectId,
      instructorId,
      isPublished: overrides.isPublished !== undefined ? overrides.isPublished : true,
      price: overrides.price || 0,
      ...overrides
    }
  });
}

export async function makeEnrollment(userId, courseId, overrides = {}) {
  return await prisma.enrollment.create({
    data: {
      userId,
      courseId,
      status: overrides.status || 'ACTIVE',
      progressPercent: overrides.progressPercent || 0,
      ...overrides
    }
  });
}

export async function makeQuiz(courseId, moduleId, overrides = {}) {
  return await prisma.quiz.create({
    data: {
      courseId,
      moduleId,
      title: overrides.title || 'Test Quiz',
      timeLimitMinutes: overrides.timeLimitMinutes || 10,
      passingScore: overrides.passingScore || 80,
      maxAttempts: overrides.maxAttempts || 3,
      ...overrides
    }
  });
}

export function loginAs(user) {
  const accessToken = signAccessToken(user);
  return `Bearer ${accessToken}`;
}
