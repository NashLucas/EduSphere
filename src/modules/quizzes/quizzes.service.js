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
  const quiz = await verifyQuizOwnership(user, id);

  if (data.passingScore !== undefined && data.passingScore !== quiz.passingScore) {
    const attemptCount = await prisma.quizAttempt.count({ where: { quizId: id } });
    if (attemptCount > 0) {
      throw ConflictError('Cannot change passingScore after attempts have been made');
    }
  }

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

export const addQuestions = async (user, quizId, questionsData) => {
  await verifyQuizOwnership(user, quizId);

  const attemptCount = await prisma.quizAttempt.count({ where: { quizId } });
  if (attemptCount > 0) {
    throw ConflictError('Cannot add questions after attempts have been made');
  }

  const createdQuestions = await prisma.quizQuestion.createManyAndReturn({
    data: questionsData.map(q => ({
      quizId,
      questionText: q.questionText,
      type: q.type,
      options: q.options,
      correctAnswerIndex: q.correctAnswerIndex,
      orderIndex: q.orderIndex
    }))
  });

  return createdQuestions;
};

export const updateQuestion = async (user, quizId, questionId, data) => {
  await verifyQuizOwnership(user, quizId);

  const question = await prisma.quizQuestion.findUnique({
    where: { id: questionId }
  });

  if (!question || question.quizId !== quizId) {
    throw NotFoundError('Question not found in this quiz');
  }

  const attemptCount = await prisma.quizAttempt.count({ where: { quizId } });

  const isStructuralChange = data.options !== undefined || data.correctAnswerIndex !== undefined || data.type !== undefined;

  if (attemptCount > 0 && isStructuralChange) {
    throw ConflictError('Cannot change question structure after attempts have been made');
  }

  const newOptions = data.options || question.options;
  const newAnswerIndex = data.correctAnswerIndex !== undefined ? data.correctAnswerIndex : question.correctAnswerIndex;
  const newType = data.type || question.type;

  if (newType === 'TRUE_FALSE' && newOptions.length !== 2) {
    throw ConflictError('TRUE_FALSE questions must have exactly 2 options');
  }

  if (newAnswerIndex >= newOptions.length) {
    throw ConflictError('correctAnswerIndex must be within options bounds');
  }

  return await prisma.quizQuestion.update({
    where: { id: questionId },
    data
  });
};

export const deleteQuestion = async (user, quizId, questionId) => {
  await verifyQuizOwnership(user, quizId);

  const question = await prisma.quizQuestion.findUnique({
    where: { id: questionId }
  });

  if (!question || question.quizId !== quizId) {
    throw NotFoundError('Question not found in this quiz');
  }

  const attemptCount = await prisma.quizAttempt.count({ where: { quizId } });
  if (attemptCount > 0) {
    throw ConflictError('Cannot delete questions after attempts have been made');
  }

  return await prisma.quizQuestion.delete({
    where: { id: questionId }
  });
};
