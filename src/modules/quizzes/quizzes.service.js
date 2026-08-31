import prisma from '../../database/index.js';
import { NotFoundError, UnauthorizedError, ForbiddenError, ConflictError } from '../../utils/app-error.js';
import { verifyCourseOwnership } from '../courses/courses.service.js';

export const verifyQuizOwnership = async (user, quizId) => {
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: { course: true }
  });

  if (!quiz) {
    throw NotFoundError('Quiz not found');
  }

  if (user.role === 'ADMIN') {
    return quiz;
  }

  if (quiz.course.instructorId !== user.id) {
    throw ForbiddenError('You do not have permission to modify this quiz');
  }

  return quiz;
};

export const createQuiz = async (userId, userRole, data) => {
  await verifyCourseOwnership(data.courseId, userId, userRole);

  let maxAttempts = data.maxAttempts;
  if (data.lessonId && data.maxAttempts === undefined) {
    maxAttempts = 3;
  } else if (!data.lessonId && data.maxAttempts === undefined) {
    maxAttempts = null;
  }

  return await prisma.quiz.create({
    data: {
      courseId: data.courseId,
      lessonId: data.lessonId || null,
      title: data.title,
      passingScore: data.passingScore ?? 70,
      maxAttempts: maxAttempts,
    }
  });
};

export const updateQuiz = async (user, id, data) => {
  await verifyQuizOwnership(user, id);

  return await prisma.quiz.update({
    where: { id },
    data: {
      title: data.title,
      passingScore: data.passingScore,
      maxAttempts: data.maxAttempts,
    }
  });
};

export const deleteQuiz = async (user, id, force = false) => {
  const quiz = await verifyQuizOwnership(user, id);

  const attemptCount = await prisma.quizAttempt.count({
    where: { quizId: id }
  });

  if (attemptCount > 0 && !force) {
    throw ConflictError('Cannot delete quiz with existing attempts. Use ?force=true to override.');
  }

  return await prisma.$transaction(async (tx) => {
    const deletedQuiz = await tx.quiz.delete({
      where: { id }
    });

    if (force) {
      await tx.auditLog.create({
        data: {
          adminId: user.id,
          actionType: 'QUIZ_DELETED',
          targetType: 'QUIZ',
          targetId: id,
          reason: 'Forced deletion of quiz with attempts',
        }
      });
    }

    return deletedQuiz;
  });
};
