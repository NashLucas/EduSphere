import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as lessonsService from '../lessons.service.js';
import prisma from '../../../database/index.js';
import { verifyCourseOwnership } from '../../courses/courses.service.js';

const mockTx = {
  lesson: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  course: {
    update: vi.fn(),
  },
  $executeRaw: vi.fn(),
};

vi.mock('../../../database/index.js', () => ({
  default: {
    module: {
      findUnique: vi.fn(),
    },
    lesson: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(async (cb) => cb(mockTx)),
  },
}));

vi.mock('../../courses/courses.service.js', () => ({
  verifyCourseOwnership: vi.fn(),
}));

describe('Lessons Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.lesson.count.mockResolvedValue(10);
  });

  describe('createLesson', () => {
    it('creates a lesson and recalculates progress/duration', async () => {
      prisma.module.findUnique.mockResolvedValue({ id: 'mod-1', courseId: 'course-1' });
      verifyCourseOwnership.mockResolvedValue({ id: 'course-1' });
      mockTx.lesson.create.mockResolvedValue({ id: 'les-1', title: 'Les 1' });

      const result = await lessonsService.createLesson('user-1', 'INSTRUCTOR', 'mod-1', { title: 'Les 1', type: 'VIDEO', content: '...', orderIndex: 0, durationMinutes: 15 });

      expect(prisma.module.findUnique).toHaveBeenCalledWith({ where: { id: 'mod-1' } });
      expect(verifyCourseOwnership).toHaveBeenCalledWith('course-1', 'user-1', 'INSTRUCTOR');
      
      expect(mockTx.lesson.create).toHaveBeenCalledWith({
        data: { moduleId: 'mod-1', title: 'Les 1', type: 'VIDEO', content: '...', orderIndex: 0, durationMinutes: 15 },
      });
      expect(mockTx.course.update).toHaveBeenCalledWith({
        where: { id: 'course-1' },
        data: { durationMinutes: { increment: 15 } },
      });
      expect(mockTx.$executeRaw).toHaveBeenCalled();
      expect(result.id).toBe('les-1');
    });
  });

  describe('getLesson', () => {
    it('returns immediately if lesson is free preview', async () => {
      prisma.lesson.findUnique.mockResolvedValue({ id: 'les-1', title: 'Les 1', isFreePreview: true });
      const result = await lessonsService.getLesson(null, 'les-1');
      expect(result.title).toBe('Les 1');
    });

    it('throws Unauthorized if no token and not free', async () => {
      prisma.lesson.findUnique.mockResolvedValue({ id: 'les-1', isFreePreview: false });
      await expect(lessonsService.getLesson(null, 'les-1')).rejects.toThrow('Authentication required');
    });
  });

  describe('updateLesson', () => {
    it('updates a lesson and recalculates duration if changed', async () => {
      prisma.lesson.findUnique.mockResolvedValue({ id: 'les-1', durationMinutes: 10, module: { courseId: 'course-1' } });
      verifyCourseOwnership.mockResolvedValue({ id: 'course-1' });
      mockTx.lesson.update.mockResolvedValue({ id: 'les-1', title: 'Les 1 Updated' });

      const result = await lessonsService.updateLesson('user-1', 'INSTRUCTOR', 'les-1', { title: 'Les 1 Updated', durationMinutes: 25 });

      expect(prisma.lesson.findUnique).toHaveBeenCalledWith({ where: { id: 'les-1' }, include: { module: true } });
      expect(verifyCourseOwnership).toHaveBeenCalledWith('course-1', 'user-1', 'INSTRUCTOR');
      
      expect(mockTx.lesson.update).toHaveBeenCalledWith({
        where: { id: 'les-1' },
        data: { title: 'Les 1 Updated', durationMinutes: 25 },
      });
      expect(mockTx.course.update).toHaveBeenCalledWith({
        where: { id: 'course-1' },
        data: { durationMinutes: { increment: 15 } }, // 25 - 10
      });
      expect(result.title).toBe('Les 1 Updated');
    });
  });

  describe('deleteLesson', () => {
    it('deletes a lesson and recalculates progress/duration', async () => {
      prisma.lesson.findUnique.mockResolvedValue({ id: 'les-1', durationMinutes: 10, module: { courseId: 'course-1' } });
      verifyCourseOwnership.mockResolvedValue({ id: 'course-1' });
      mockTx.lesson.delete.mockResolvedValue({ id: 'les-1' });

      await lessonsService.deleteLesson('user-1', 'INSTRUCTOR', 'les-1');

      expect(prisma.lesson.findUnique).toHaveBeenCalledWith({ where: { id: 'les-1' }, include: { module: true } });
      expect(verifyCourseOwnership).toHaveBeenCalledWith('course-1', 'user-1', 'INSTRUCTOR');
      
      expect(mockTx.course.update).toHaveBeenCalledWith({
        where: { id: 'course-1' },
        data: { durationMinutes: { decrement: 10 } },
      });
      expect(mockTx.lesson.delete).toHaveBeenCalledWith({ where: { id: 'les-1' } });
      expect(mockTx.$executeRaw).toHaveBeenCalled();
    });
  });
});
