import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as quizzesService from '../quizzes.service.js';
import prisma from '../../../database/index.js';
import { verifyCourseOwnership } from '../../courses/courses.service.js';

const mockTx = {
  quiz: {
    delete: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
};

vi.mock('../../../database/index.js', () => ({
  default: {
    quiz: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    quizAttempt: {
      count: vi.fn(),
    },
    enrollment: {
      findUnique: vi.fn(),
    },
    quizQuestion: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      createMany: vi.fn(),
      createManyAndReturn: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(async (cb) => cb(mockTx)),
  },
}));

vi.mock('../../courses/courses.service.js', () => ({
  verifyCourseOwnership: vi.fn(),
}));

vi.mock('../../lessons/lessons.service.js', () => ({
  calculateNextAccessibleLessonId: vi.fn(),
}));

describe('Quizzes Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createQuiz', () => {
    it('creates a quiz and defaults maxAttempts to 3 when lessonId is present', async () => {
      verifyCourseOwnership.mockResolvedValue(true);
      prisma.quiz.create.mockResolvedValue({ id: 'q1', maxAttempts: 3 });

      const result = await quizzesService.createQuiz('u1', 'INSTRUCTOR', {
        courseId: 'c1',
        lessonId: 'l1',
        title: 'Quiz 1'
      });

      expect(verifyCourseOwnership).toHaveBeenCalledWith('c1', 'u1', 'INSTRUCTOR');
      expect(result).toHaveProperty('id', 'q1');
      expect(prisma.quiz.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ maxAttempts: 3, passingScore: 70 })
      }));
    });

    it('creates a quiz and defaults maxAttempts to null when lessonId is null', async () => {
      verifyCourseOwnership.mockResolvedValue(true);
      prisma.quiz.create.mockResolvedValue({ id: 'q2', maxAttempts: null });

      const result = await quizzesService.createQuiz('u1', 'INSTRUCTOR', {
        courseId: 'c1',
        title: 'Quiz 2'
      });

      expect(verifyCourseOwnership).toHaveBeenCalledWith('c1', 'u1', 'INSTRUCTOR');
      expect(result).toHaveProperty('id', 'q2');
      expect(prisma.quiz.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ maxAttempts: null })
      }));
    });
  });

  describe('updateQuiz', () => {
    it('updates a quiz successfully if user owns course', async () => {
      prisma.quiz.findUnique.mockResolvedValue({
        id: 'q1',
        course: { instructorId: 'u1' }
      });
      prisma.quiz.update.mockResolvedValue({ id: 'q1', title: 'New Title' });

      const result = await quizzesService.updateQuiz({ id: 'u1', role: 'INSTRUCTOR' }, 'q1', { title: 'New Title' });
      
      expect(result.title).toBe('New Title');
    });

    it('throws 403 if instructor does not own course', async () => {
      prisma.quiz.findUnique.mockResolvedValue({
        id: 'q1',
        course: { instructorId: 'u2' }
      });

      await expect(quizzesService.updateQuiz({ id: 'u1', role: 'INSTRUCTOR' }, 'q1', {}))
        .rejects.toMatchObject({ statusCode: 403 });
    });

    it('throws 409 if changing passingScore and attempts exist', async () => {
      prisma.quiz.findUnique.mockResolvedValue({
        id: 'q1',
        passingScore: 70,
        course: { instructorId: 'u1' }
      });
      prisma.quizAttempt.count.mockResolvedValue(1);

      await expect(quizzesService.updateQuiz({ id: 'u1', role: 'INSTRUCTOR' }, 'q1', { passingScore: 80 }))
        .rejects.toMatchObject({ statusCode: 409 });
    });

    it('allows changing passingScore if attempts do not exist', async () => {
      prisma.quiz.findUnique.mockResolvedValue({
        id: 'q1',
        passingScore: 70,
        course: { instructorId: 'u1' }
      });
      prisma.quizAttempt.count.mockResolvedValue(0);
      prisma.quiz.update.mockResolvedValue({ id: 'q1', passingScore: 80 });

      const result = await quizzesService.updateQuiz({ id: 'u1', role: 'INSTRUCTOR' }, 'q1', { passingScore: 80 });

      expect(result.passingScore).toBe(80);
      expect(prisma.quiz.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ passingScore: 80 })
      }));
    });

    it('allows updating title even if attempts exist', async () => {
      prisma.quiz.findUnique.mockResolvedValue({
        id: 'q1',
        passingScore: 70,
        course: { instructorId: 'u1' }
      });
      // count is not even called because passingScore doesn't change
      prisma.quiz.update.mockResolvedValue({ id: 'q1', title: 'New Title' });

      const result = await quizzesService.updateQuiz({ id: 'u1', role: 'INSTRUCTOR' }, 'q1', { title: 'New Title' });

      expect(result.title).toBe('New Title');
      expect(prisma.quizAttempt.count).not.toHaveBeenCalled();
    });
  });

  describe('deleteQuiz', () => {
    it('deletes quiz successfully if no attempts exist', async () => {
      prisma.quiz.findUnique.mockResolvedValue({
        id: 'q1',
        course: { instructorId: 'u1' }
      });
      prisma.quizAttempt.count.mockResolvedValue(0);
      mockTx.quiz.delete.mockResolvedValue({ id: 'q1' });

      await quizzesService.deleteQuiz({ id: 'u1', role: 'INSTRUCTOR' }, 'q1');

      expect(mockTx.quiz.delete).toHaveBeenCalledWith({ where: { id: 'q1' } });
      expect(mockTx.auditLog.create).not.toHaveBeenCalled();
    });

    it('throws 409 if attempts exist and force is false', async () => {
      prisma.quiz.findUnique.mockResolvedValue({
        id: 'q1',
        course: { instructorId: 'u1' }
      });
      prisma.quizAttempt.count.mockResolvedValue(1);

      await expect(quizzesService.deleteQuiz({ id: 'u1', role: 'INSTRUCTOR' }, 'q1'))
        .rejects.toMatchObject({ statusCode: 409 });
    });

    it('deletes quiz and creates audit log if attempts exist and force is true', async () => {
      prisma.quiz.findUnique.mockResolvedValue({
        id: 'q1',
        course: { instructorId: 'u1' }
      });
      prisma.quizAttempt.count.mockResolvedValue(1);
      mockTx.quiz.delete.mockResolvedValue({ id: 'q1' });

      await quizzesService.deleteQuiz({ id: 'u1', role: 'INSTRUCTOR' }, 'q1', true);

      expect(mockTx.quiz.delete).toHaveBeenCalled();
      expect(mockTx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ actionType: 'QUIZ_DELETED', targetType: 'QUIZ' })
      }));
    });
  });

  describe('addQuestions', () => {
    it('throws 409 if attempts exist', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ id: 'q1', course: { instructorId: 'u1' } });
      prisma.quizAttempt.count.mockResolvedValue(1);

      await expect(quizzesService.addQuestions({ id: 'u1', role: 'INSTRUCTOR' }, 'q1', []))
        .rejects.toMatchObject({ statusCode: 409 });
    });

    it('creates questions successfully if no attempts exist', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ id: 'q1', course: { instructorId: 'u1' } });
      prisma.quizAttempt.count.mockResolvedValue(0);
      prisma.quizQuestion.createManyAndReturn.mockResolvedValue([{ id: 'qq1' }, { id: 'qq2' }]);

      const result = await quizzesService.addQuestions({ id: 'u1', role: 'INSTRUCTOR' }, 'q1', [{
        questionText: 'Q1', options: ['A', 'B'], correctAnswerIndex: 0, orderIndex: 1
      }]);

      expect(result).toEqual([{ id: 'qq1' }, { id: 'qq2' }]);
      expect(prisma.quizQuestion.createManyAndReturn).toHaveBeenCalled();
    });
  });

  describe('updateQuestion', () => {
    it('throws 409 if structural changes requested and attempts exist', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ id: 'q1', course: { instructorId: 'u1' } });
      prisma.quizQuestion.findUnique.mockResolvedValue({ id: 'q2', quizId: 'q1', options: ['A', 'B'], correctAnswerIndex: 0, type: 'MULTIPLE_CHOICE' });
      prisma.quizAttempt.count.mockResolvedValue(1);

      await expect(quizzesService.updateQuestion({ id: 'u1', role: 'INSTRUCTOR' }, 'q1', 'q2', { options: ['A', 'B', 'C'] }))
        .rejects.toMatchObject({ statusCode: 409 });
    });

    it('allows updating text even if attempts exist', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ id: 'q1', course: { instructorId: 'u1' } });
      prisma.quizQuestion.findUnique.mockResolvedValue({ id: 'q2', quizId: 'q1', options: ['A', 'B'], correctAnswerIndex: 0, type: 'MULTIPLE_CHOICE' });
      prisma.quizAttempt.count.mockResolvedValue(1);
      prisma.quizQuestion.update.mockResolvedValue({ id: 'q2', questionText: 'New text' });

      await quizzesService.updateQuestion({ id: 'u1', role: 'INSTRUCTOR' }, 'q1', 'q2', { questionText: 'New text' });

      expect(prisma.quizQuestion.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ questionText: 'New text' })
      }));
    });

    it('throws 409 if TRUE_FALSE type and options not 2', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ id: 'q1', course: { instructorId: 'u1' } });
      prisma.quizQuestion.findUnique.mockResolvedValue({ id: 'q2', quizId: 'q1', options: ['A', 'B', 'C'], correctAnswerIndex: 0, type: 'MULTIPLE_CHOICE' });
      prisma.quizAttempt.count.mockResolvedValue(0);

      await expect(quizzesService.updateQuestion({ id: 'u1', role: 'INSTRUCTOR' }, 'q1', 'q2', { type: 'TRUE_FALSE' }))
        .rejects.toMatchObject({ statusCode: 409 });
    });
  });

  describe('deleteQuestion', () => {
    it('throws 409 if attempts exist', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ id: 'q1', course: { instructorId: 'u1' } });
      prisma.quizQuestion.findUnique.mockResolvedValue({ id: 'q2', quizId: 'q1' });
      prisma.quizAttempt.count.mockResolvedValue(1);

      await expect(quizzesService.deleteQuestion({ id: 'u1', role: 'INSTRUCTOR' }, 'q1', 'q2'))
        .rejects.toMatchObject({ statusCode: 409 });
    });

    it('deletes question successfully if no attempts exist', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ id: 'q1', course: { instructorId: 'u1' } });
      prisma.quizQuestion.findUnique.mockResolvedValue({ id: 'q2', quizId: 'q1' });
      prisma.quizAttempt.count.mockResolvedValue(0);

      await quizzesService.deleteQuestion({ id: 'u1', role: 'INSTRUCTOR' }, 'q1', 'q2');

      expect(prisma.quizQuestion.delete).toHaveBeenCalledWith({ where: { id: 'q2' } });
    });
  });

  describe('getQuiz', () => {
    it('returns quiz with correctAnswerIndex for owner', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ id: 'q1', courseId: 'c1', course: { instructorId: 'u1' } });
      prisma.quizQuestion.findMany.mockResolvedValue([{ id: 'q1', correctAnswerIndex: 0 }]);
      prisma.quizAttempt.count.mockResolvedValue(1);

      const result = await quizzesService.getQuiz({ id: 'u1', role: 'INSTRUCTOR' }, 'q1');

      expect(result.questions[0]).toHaveProperty('correctAnswerIndex');
      expect(prisma.quizQuestion.findMany).toHaveBeenCalledWith(expect.objectContaining({
        select: expect.objectContaining({ correctAnswerIndex: true })
      }));
    });

    it('returns quiz without correctAnswerIndex for enrolled student', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ id: 'q1', courseId: 'c1', course: { instructorId: 'u1' } });
      prisma.enrollment.findUnique.mockResolvedValue({ status: 'ACTIVE' });
      prisma.quizQuestion.findMany.mockResolvedValue([{ id: 'q1' }]);
      prisma.quizAttempt.count.mockResolvedValue(1);

      const result = await quizzesService.getQuiz({ id: 'u2', role: 'STUDENT' }, 'q1');

      expect(result.questions[0]).not.toHaveProperty('correctAnswerIndex');
      expect(prisma.quizQuestion.findMany).toHaveBeenCalledWith(expect.objectContaining({
        select: expect.not.objectContaining({ correctAnswerIndex: true })
      }));
    });

    it('throws 403 if lesson is locked for student', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ id: 'q1', courseId: 'c1', lessonId: 'l2', course: { instructorId: 'u1' } });
      prisma.enrollment.findUnique.mockResolvedValue({ id: 'e1', status: 'ACTIVE' });
      
      const { calculateNextAccessibleLessonId } = await import('../../lessons/lessons.service.js');
      calculateNextAccessibleLessonId.mockResolvedValue({
        nextAccessibleLessonId: 'l1',
        allLessons: [{ id: 'l1' }, { id: 'l2' }] // l2 is after l1
      });

      await expect(quizzesService.getQuiz({ id: 'u2', role: 'STUDENT' }, 'q1'))
        .rejects.toMatchObject({ statusCode: 403, message: 'This quiz belongs to a locked lesson' });
    });
  });
});
