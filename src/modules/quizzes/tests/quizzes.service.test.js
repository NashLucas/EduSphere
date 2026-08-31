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
    $transaction: vi.fn(async (cb) => cb(mockTx)),
  },
}));

vi.mock('../../courses/courses.service.js', () => ({
  verifyCourseOwnership: vi.fn(),
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
});
