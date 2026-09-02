import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as lessonsService from '../lessons.service.js';
import prisma from '../../../database/index.js';
import { verifyCourseOwnership } from '../../courses/courses.service.js';

vi.mock('../../achievements/achievements.service.js', () => ({
  evaluateAchievements: vi.fn().mockResolvedValue([]),
}));

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
  lessonProgress: {
    upsert: vi.fn(),
    count: vi.fn(),
  },
  userStreak: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  enrollment: {
    update: vi.fn(),
    count: vi.fn(),
  },
  certificate: {
    create: vi.fn(),
  },
  achievement: {
    findMany: vi.fn(),
  },
  userAchievement: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
};

vi.mock('../../../database/index.js', () => ({
  default: {
    module: {
      findUnique: vi.fn(),
    },
    lesson: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    lessonProgress: {
      findMany: vi.fn(),
    },
    enrollment: {
      findUnique: vi.fn(),
    },
    quiz: {
      findUnique: vi.fn(),
    },
    quizAttempt: {
      count: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(async (cb) => cb(mockTx)),
  },
}));

vi.mock('../../courses/courses.service.js', () => ({
  verifyCourseOwnership: vi.fn(),
}));

vi.mock('../../notifications/notifications.service.js', () => ({
  createNotification: vi.fn(),
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

  describe('completeLesson', () => {
    it('throws 403 if enrollment is missing or inactive', async () => {
      prisma.lesson.findUnique.mockResolvedValueOnce({ id: 'l1', module: { courseId: 'c1' } });
      prisma.enrollment.findUnique.mockResolvedValueOnce(null);

      await expect(lessonsService.completeLesson('u1', 'l1'))
        .rejects.toMatchObject({ statusCode: 403 });
    });

    it('throws 423 if lesson is locked', async () => {
      prisma.lesson.findUnique.mockResolvedValueOnce({ id: 'l1', module: { courseId: 'c1' } });
      prisma.enrollment.findUnique.mockResolvedValueOnce({ id: 'e1', status: 'ACTIVE' });
      prisma.lesson.findMany.mockResolvedValueOnce([
        { id: 'l0', type: 'VIDEO' },
        { id: 'l1', type: 'VIDEO' }
      ]);
      prisma.lessonProgress.findMany.mockResolvedValueOnce([]); // l0 is not completed

      await expect(lessonsService.completeLesson('u1', 'l1'))
        .rejects.toMatchObject({ statusCode: 423 });
    });

    it('completes the lesson, sets progress, and increments streak with 100% side effects', async () => {
      prisma.lesson.findUnique.mockResolvedValueOnce({ id: 'l1', module: { courseId: 'c1', course: { title: 'Test Course' } } });
      prisma.enrollment.findUnique.mockResolvedValueOnce({ id: 'e1', status: 'ACTIVE' });
      prisma.lesson.findMany.mockResolvedValueOnce([
        { id: 'l1', type: 'VIDEO' }
      ]);
      prisma.lessonProgress.findMany.mockResolvedValueOnce([]);
      
      mockTx.$queryRaw.mockResolvedValueOnce([{ id: 'e1', status: 'ACTIVE' }]);
      mockTx.lessonProgress.upsert.mockResolvedValueOnce({ id: 'lp1' });
      mockTx.lessonProgress.count.mockResolvedValueOnce(1); // 1 / 1 = 100%

      mockTx.userStreak.findUnique.mockResolvedValueOnce({
        userId: 'u1', currentStreak: 1, longestStreak: 1, lastActiveDate: new Date(Date.now() - 24 * 60 * 60 * 1000)
      });
      const now = new Date();
      const yesterdayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
      mockTx.userStreak.findUnique.mockReset();
      mockTx.userStreak.findUnique.mockResolvedValueOnce({
        userId: 'u1', currentStreak: 1, longestStreak: 1, lastActiveDate: yesterdayStart
      });

      mockTx.enrollment.count.mockResolvedValueOnce(4); // 4 completed courses before this one + 1 = 5
      mockTx.achievement.findMany.mockResolvedValueOnce([
        { id: 'ach1', title: '5 Courses Completed', criteriaType: 'COURSES_COMPLETED', criteriaValue: 5 }
      ]);
      mockTx.userAchievement.findMany.mockResolvedValueOnce([]);

      await lessonsService.completeLesson('u1', 'l1');

      expect(mockTx.lessonProgress.upsert).toHaveBeenCalled();
      expect(mockTx.enrollment.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'e1' },
        data: expect.objectContaining({ progressPercent: 100.0, status: 'COMPLETED' })
      }));
      expect(mockTx.userStreak.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { userId: 'u1' },
        data: expect.objectContaining({ currentStreak: 2 })
      }));
      expect(mockTx.certificate.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ userId: 'u1', courseId: 'c1' })
      }));
      
      const { evaluateAchievements } = await import('../../achievements/achievements.service.js');
      expect(evaluateAchievements).toHaveBeenCalledWith('u1', mockTx);
      
      const { createNotification } = await import('../../notifications/notifications.service.js');
      expect(createNotification).toHaveBeenCalledWith('u1', 'CERTIFICATE', 'Course Completed', expect.stringContaining('Test Course'), mockTx);
    });
  });
});
