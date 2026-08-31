import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as enrollmentsService from '../enrollments.service.js';
import prisma from '../../../database/index.js';
import { createNotification } from '../../notifications/notifications.service.js';
import { NotFoundError, ConflictError, UnprocessableEntityError } from '../../../utils/app-error.js';

vi.mock('../../../database/index.js', () => ({
  default: {
    course: { findUnique: vi.fn(), update: vi.fn() },
    instructor: { update: vi.fn() },
    enrollment: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
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
});
