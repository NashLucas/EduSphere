import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as enrollmentsService from '../enrollments.service.js';
import prisma from '../../../database/index.js';
import { createNotification } from '../../notifications/notifications.service.js';
import { NotFoundError, ConflictError, UnprocessableEntityError } from '../../../utils/app-error.js';

vi.mock('../../../database/index.js', () => ({
  default: {
    course: { findUnique: vi.fn(), update: vi.fn() },
    instructor: { update: vi.fn() },
    enrollment: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    module: { findMany: vi.fn() },
    lessonProgress: { findMany: vi.fn() },
    quizAttempt: { groupBy: vi.fn() },
    $transaction: vi.fn(async (cb) => {
      return cb({
        enrollment: prisma.enrollment,
        course: prisma.course,
        instructor: prisma.instructor,
      });
    }),
  }
}));

vi.mock('../../notifications/notifications.service.js', () => ({
  createNotification: vi.fn()
}));

describe('Enrollments Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('enrollInCourse', () => {
    it('throws 404 if course does not exist', async () => {
      prisma.course.findUnique.mockResolvedValueOnce(null);
      await expect(enrollmentsService.enrollInCourse('u1', 'c1'))
        .rejects.toMatchObject({ statusCode: 404 });
    });

    it('throws 404 if course is deleted', async () => {
      prisma.course.findUnique.mockResolvedValueOnce({ deletedAt: new Date() });
      await expect(enrollmentsService.enrollInCourse('u1', 'c1'))
        .rejects.toMatchObject({ statusCode: 404 });
    });

    it('throws 404 if course is unpublished', async () => {
      prisma.course.findUnique.mockResolvedValueOnce({ isPublished: false, deletedAt: null });
      await expect(enrollmentsService.enrollInCourse('u1', 'c1'))
        .rejects.toMatchObject({ statusCode: 404 });
    });

    it('throws 422 if instructor enrolls in own course', async () => {
      prisma.course.findUnique.mockResolvedValueOnce({ 
        isPublished: true, deletedAt: null, instructor: { userId: 'u1' } 
      });
      await expect(enrollmentsService.enrollInCourse('u1', 'c1'))
        .rejects.toMatchObject({ statusCode: 422 });
    });

    it('throws 409 if already enrolled and ACTIVE', async () => {
      prisma.course.findUnique.mockResolvedValueOnce({ 
        isPublished: true, deletedAt: null, instructor: { userId: 'u2' } 
      });
      prisma.enrollment.findUnique.mockResolvedValueOnce({ status: 'ACTIVE' });
      await expect(enrollmentsService.enrollInCourse('u1', 'c1'))
        .rejects.toMatchObject({ statusCode: 409 });
    });

    it('throws 409 if already enrolled and COMPLETED', async () => {
      prisma.course.findUnique.mockResolvedValueOnce({ 
        isPublished: true, deletedAt: null, instructor: { userId: 'u2' } 
      });
      prisma.enrollment.findUnique.mockResolvedValueOnce({ status: 'COMPLETED' });
      await expect(enrollmentsService.enrollInCourse('u1', 'c1'))
        .rejects.toMatchObject({ statusCode: 409 });
    });

    it('reactivates DROPPED enrollment without incrementing counters', async () => {
      prisma.course.findUnique.mockResolvedValueOnce({ 
        isPublished: true, deletedAt: null, instructor: { userId: 'u2' }, title: 'Test Course' 
      });
      prisma.enrollment.findUnique.mockResolvedValueOnce({ id: 'e1', status: 'DROPPED' });
      prisma.enrollment.update.mockResolvedValueOnce({ id: 'e1', status: 'ACTIVE' });
      
      const res = await enrollmentsService.enrollInCourse('u1', 'c1');
      expect(res.id).toBe('e1');
      expect(prisma.enrollment.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { status: 'ACTIVE' }
      });
      expect(prisma.course.update).not.toHaveBeenCalled();
      expect(createNotification).toHaveBeenCalled();
    });

    it('creates a new enrollment and increments counters', async () => {
      prisma.course.findUnique.mockResolvedValueOnce({ 
        id: 'c1', isPublished: true, deletedAt: null, instructor: { userId: 'u2' }, instructorId: 'inst1', title: 'Test' 
      });
      prisma.enrollment.findUnique.mockResolvedValueOnce(null);
      prisma.enrollment.create.mockResolvedValueOnce({ id: 'e1', status: 'ACTIVE' });
      
      const res = await enrollmentsService.enrollInCourse('u1', 'c1');
      expect(res.id).toBe('e1');
      expect(prisma.enrollment.create).toHaveBeenCalled();
      expect(prisma.course.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { studentCount: { increment: 1 } }
      });
      expect(prisma.instructor.update).toHaveBeenCalledWith({
        where: { id: 'inst1' },
        data: { studentCount: { increment: 1 } }
      });
      expect(createNotification).toHaveBeenCalled();
    });
  });

  describe('listEnrollments', () => {
    it('returns a paginated list of enrollments', async () => {
      const mockEnrollments = [{ id: 'e1', courseId: 'c1', course: { title: 'Test' } }];
      prisma.enrollment.findMany.mockResolvedValueOnce(mockEnrollments);
      prisma.enrollment.count.mockResolvedValueOnce(1);

      const res = await enrollmentsService.listEnrollments('u1', { page: 1, limit: 10 });
      expect(res.data).toEqual(mockEnrollments);
      expect(res.meta.total).toBe(1);
      expect(res.meta.totalPages).toBe(1);
      
      expect(prisma.enrollment.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { userId: 'u1' },
        skip: 0,
        take: 10,
        orderBy: { createdAt: 'desc' },
      }));
    });

    it('filters by status if provided', async () => {
      prisma.enrollment.findMany.mockResolvedValueOnce([]);
      prisma.enrollment.count.mockResolvedValueOnce(0);

      await enrollmentsService.listEnrollments('u1', { status: 'ACTIVE', page: 2, limit: 5 });
      
      expect(prisma.enrollment.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { userId: 'u1', status: 'ACTIVE' },
        skip: 5,
        take: 5,
      }));
    });
  });

  describe('getProgressDetail', () => {
    it('throws 404 if enrollment does not exist', async () => {
      prisma.enrollment.findUnique.mockResolvedValueOnce(null);
      await expect(enrollmentsService.getProgressDetail('u1', 'c1'))
        .rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns structured progress detail with lock state', async () => {
      prisma.enrollment.findUnique.mockResolvedValueOnce({ id: 'e1', progressPercent: 50.0 });
      prisma.module.findMany.mockResolvedValueOnce([
        {
          id: 'm1', title: 'Module 1', orderIndex: 1,
          lessons: [
            { id: 'l1', title: 'Lesson 1', type: 'VIDEO', orderIndex: 1 },
            { id: 'l2', title: 'Lesson 2', type: 'QUIZ', orderIndex: 2, quiz: { id: 'q1', maxAttempts: 3 } },
            { id: 'l3', title: 'Lesson 3', type: 'VIDEO', orderIndex: 3 }
          ]
        }
      ]);
      prisma.lessonProgress.findMany.mockResolvedValueOnce([
        { lessonId: 'l1', isCompleted: true, updatedAt: new Date('2023-01-01') }
      ]);
      prisma.quizAttempt.groupBy = vi.fn().mockResolvedValueOnce([
        { quizId: 'q1', _count: { _all: 3 } }
      ]);

      const res = await enrollmentsService.getProgressDetail('u1', 'c1');
      expect(res.courseId).toBe('c1');
      expect(res.progressPercent).toBe(50.0);
      expect(res.nextAccessibleLessonId).toBe('l3');
      expect(res.modules).toHaveLength(1);

      const lessons = res.modules[0].lessons;
      
      // l1 is explicitly completed
      expect(lessons[0].id).toBe('l1');
      expect(lessons[0].isCompleted).toBe(true);
      expect(lessons[0].isLocked).toBe(false);

      // l2 is a quiz with max attempts exhausted (effectively completed for unlock purposes, but isCompleted remains false)
      expect(lessons[1].id).toBe('l2');
      expect(lessons[1].isCompleted).toBe(false);
      expect(lessons[1].isLocked).toBe(false);

      // l3 is the next accessible lesson, should be unlocked
      expect(lessons[2].id).toBe('l3');
      expect(lessons[2].isCompleted).toBe(false);
      expect(lessons[2].isLocked).toBe(false); // since l2 counts as passed, l3 is next accessible
    });
  });

  describe('dropEnrollment', () => {
    it('throws 404 if enrollment does not exist', async () => {
      prisma.enrollment.findUnique.mockResolvedValueOnce(null);
      await expect(enrollmentsService.dropEnrollment('u1', 'c1'))
        .rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns idempotently if already dropped', async () => {
      const mockEnrollment = { id: 'e1', status: 'DROPPED' };
      prisma.enrollment.findUnique.mockResolvedValueOnce(mockEnrollment);

      const res = await enrollmentsService.dropEnrollment('u1', 'c1');
      
      expect(res).toEqual(mockEnrollment);
      expect(prisma.enrollment.update).not.toHaveBeenCalled();
    });

    it('sets status to DROPPED without decrementing counts', async () => {
      prisma.enrollment.findUnique.mockResolvedValueOnce({ id: 'e1', status: 'ACTIVE' });
      prisma.enrollment.update.mockResolvedValueOnce({ id: 'e1', status: 'DROPPED' });

      await enrollmentsService.dropEnrollment('u1', 'c1');

      expect(prisma.enrollment.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { status: 'DROPPED' }
      });
      expect(prisma.course.update).not.toHaveBeenCalled();
      expect(prisma.instructor.update).not.toHaveBeenCalled();
    });
  });
});
