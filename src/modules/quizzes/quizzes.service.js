import prisma from '../../database/index.js';
import { NotFoundError, UnauthorizedError, ForbiddenError, ConflictError, TooManyRequestsError } from '../../utils/app-error.js';
import { verifyCourseOwnership } from '../courses/courses.service.js';
import { calculateNextAccessibleLessonId } from '../lessons/lessons.service.js';

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

export const getQuiz = async (user, quizId) => {
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: {
      course: true,
    }
  });

  if (!quiz) throw NotFoundError('Quiz not found');

  const isOwnerOrAdmin = user.role === 'ADMIN' || quiz.course.instructorId === user.id;

  if (!isOwnerOrAdmin) {
    const enrollment = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId: user.id, courseId: quiz.courseId } }
    });

    if (!enrollment || enrollment.status !== 'ACTIVE') {
      throw ForbiddenError('You must be actively enrolled to access this quiz');
    }

    if (quiz.lessonId) {
      const { nextAccessibleLessonId, allLessons } = await calculateNextAccessibleLessonId(quiz.courseId, user.id, enrollment.id);
      
      const requestedIndex = allLessons.findIndex(l => l.id === quiz.lessonId);
      const nextAccessibleIndex = allLessons.findIndex(l => l.id === nextAccessibleLessonId);

      if (nextAccessibleIndex !== -1 && requestedIndex > nextAccessibleIndex) {
        throw ForbiddenError('This quiz belongs to a locked lesson');
      }
    }
  }

  const selectCols = {
    id: true,
    quizId: true,
    questionText: true,
    type: true,
    options: true,
    orderIndex: true,
    createdAt: true,
    updatedAt: true,
  };

  if (isOwnerOrAdmin) {
    selectCols.correctAnswerIndex = true;
  }

  const questions = await prisma.quizQuestion.findMany({
    where: { quizId },
    select: selectCols,
    orderBy: { orderIndex: 'asc' }
  });

  const attemptsUsed = await prisma.quizAttempt.count({
    where: { quizId, userId: user.id }
  });

  const attemptsRemaining = quiz.maxAttempts !== null 
    ? Math.max(0, quiz.maxAttempts - attemptsUsed) 
    : null;

  return {
    ...quiz,
    attemptsUsed,
    attemptsRemaining,
    questions
  };
};

export const submitQuiz = async (user, quizId, answersData) => {
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: { course: true }
  });

  if (!quiz) throw NotFoundError('Quiz not found');

  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: user.id, courseId: quiz.courseId } }
  });

  if (!enrollment || enrollment.status !== 'ACTIVE') {
    throw ForbiddenError('You must be actively enrolled to submit this quiz');
  }

  const attemptsUsed = await prisma.quizAttempt.count({
    where: { quizId, userId: user.id }
  });

  if (quiz.maxAttempts !== null && attemptsUsed >= quiz.maxAttempts) {
    throw TooManyRequestsError('Maximum attempts reached for this quiz', { attemptsRemaining: 0 });
  }

  const questions = await prisma.quizQuestion.findMany({
    where: { quizId }
  });

  if (questions.length === 0) {
    throw ConflictError('Cannot submit a quiz with no questions');
  }

  let totalCorrect = 0;
  const breakdown = [];

  for (const question of questions) {
    const submittedAnswer = answersData.find(a => a.questionId === question.id);
    const selectedIndex = submittedAnswer ? submittedAnswer.selectedIndex : -1;
    const isCorrect = selectedIndex === question.correctAnswerIndex;

    if (isCorrect) totalCorrect += 1;

    breakdown.push({
      questionId: question.id,
      isCorrect,
      correctAnswerIndex: question.correctAnswerIndex // Handled by 7.7 logic next
    });
  }

  const score = (totalCorrect / questions.length) * 100;
  const isPassed = score >= quiz.passingScore;
  const newAttemptsUsed = attemptsUsed + 1;

  const attempt = await prisma.quizAttempt.create({
    data: {
      userId: user.id,
      quizId,
      score,
      isPassed,
      attemptNumber: newAttemptsUsed,
      totalQuestions: questions.length,
      answers: answersData,
    }
  });

  const attemptsRemaining = quiz.maxAttempts !== null ? quiz.maxAttempts - newAttemptsUsed : null;

  if (isPassed && quiz.lessonId) {
    const { completeLesson } = await import('../lessons/lessons.service.js');
    try {
      await completeLesson(user.id, quiz.lessonId);
    } catch (err) {
      // Ignore conflict errors if lesson is already completed
      if (err.statusCode !== 409) {
        throw err;
      }
    }
  }

  // Task 7.7 Graduated Answer Disclosure
  let finalBreakdown;
  if (isPassed || attemptsRemaining === 0) {
    // Leave full breakdown including correctAnswerIndex
    finalBreakdown = breakdown;
  } else {
    // Omit the breakdown entirely so it cannot be used as an oracle
    finalBreakdown = undefined;
  }

  return {
    score,
    passed: isPassed,
    ...(finalBreakdown && { breakdown: finalBreakdown }),
    attemptsRemaining,
  };
};
