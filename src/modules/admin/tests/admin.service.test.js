import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as adminService from '../admin.service.js';
import prisma from '../../../database/index.js';
import { deleteByPattern } from '../../../utils/cache-keys.js';
import { sendTakedownNotice } from '../../../integrations/email/index.js';
import { createNotification } from '../../notifications/notifications.service.js';

vi.mock('../../../utils/cache-keys.js', () => ({
  deleteByPattern: vi.fn()
}));

vi.mock('../../../integrations/email/index.js', () => ({
  sendTakedownNotice: vi.fn().mockResolvedValue()
}));

vi.mock('../../notifications/notifications.service.js', () => ({
  createNotification: vi.fn().mockResolvedValue()
}));

vi.mock('../../../database/index.js', () => ({
  default: {
    course: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    subject: {
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (cb) => {
      // If cb is an array of promises, await Promise.all
      if (Array.isArray(cb)) {
        return Promise.all(cb);
      }
      return cb(prisma);
    }),
  }
}));

describe('Admin Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getCourses', () => {
    it('returns both deleted and live courses if deleted is not provided', async () => {
      prisma.course.findMany.mockResolvedValue([{ id: 'c1' }]);
      prisma.course.count.mockResolvedValue(1);

      const result = await adminService.getCourses({}, { page: 1, limit: 10 });
      expect(result.courses).toHaveLength(1);
      expect(prisma.course.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {}
      }));
    });

    it('filters by deleted=true', async () => {
      prisma.course.findMany.mockResolvedValue([{ id: 'c1' }]);
      prisma.course.count.mockResolvedValue(1);

      await adminService.getCourses({ deleted: true }, { page: 1, limit: 10 });
      expect(prisma.course.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { deletedAt: { not: null } }
      }));
    });

    it('filters by deleted=false', async () => {
      prisma.course.findMany.mockResolvedValue([{ id: 'c1' }]);
      prisma.course.count.mockResolvedValue(1);

      await adminService.getCourses({ deleted: false }, { page: 1, limit: 10 });
      expect(prisma.course.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { deletedAt: null }
      }));
    });

    it('filters by isPublished', async () => {
      prisma.course.findMany.mockResolvedValue([{ id: 'c1' }]);
      prisma.course.count.mockResolvedValue(1);

      await adminService.getCourses({ isPublished: true }, { page: 1, limit: 10 });
      expect(prisma.course.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { isPublished: true }
      }));
    });
  });

  describe('unpublishCourse', () => {
    it('unpublishes course, decrements subject count, and logs audit', async () => {
      prisma.course.findUnique.mockResolvedValue({
        id: 'c1',
        isPublished: true,
        subjectId: 's1',
        slug: 'test-course',
        title: 'Test Course',
        instructor: { user: { email: 'a@b.com', fullName: 'A B' } }
      });
      
      prisma.course.update = vi.fn().mockResolvedValue({ id: 'c1', isPublished: false });
      prisma.subject = { update: vi.fn() };
      prisma.auditLog = { create: vi.fn() };

      const result = await adminService.unpublishCourse('c1', 'violation', 'admin1');
      
      expect(prisma.course.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { isPublished: false }
      });
      expect(prisma.subject.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { courseCount: { decrement: 1 } }
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          adminId: 'admin1',
          actionType: 'COURSE_REJECTED',
          targetType: 'COURSE',
          targetId: 'c1',
          reason: 'violation'
        }
      });
      expect(result.isPublished).toBe(false);
    });

    it('returns course early if already unpublished', async () => {
      prisma.course.findUnique.mockResolvedValue({
        id: 'c1',
        isPublished: false,
      });

      prisma.course.update = vi.fn();
      
      const result = await adminService.unpublishCourse('c1', 'violation', 'admin1');
      expect(prisma.course.update).not.toHaveBeenCalled();
      expect(result.isPublished).toBe(false);
    });
  });

  describe('republishCourse', () => {
    it('republishes course, increments subject count, and logs audit', async () => {
      prisma.course.findUnique.mockResolvedValue({
        id: 'c1',
        isPublished: false,
        subjectId: 's1',
        slug: 'test-course',
        title: 'Test Course',
        instructor: { user: { email: 'a@b.com', fullName: 'A B' }, userId: 'u1' }
      });
      
      prisma.course.update = vi.fn().mockResolvedValue({ id: 'c1', isPublished: true });
      prisma.subject = { update: vi.fn() };
      prisma.auditLog = { create: vi.fn() };

      const result = await adminService.republishCourse('c1', 'fixed', 'admin1');
      
      expect(prisma.course.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { isPublished: true }
      });
      expect(prisma.subject.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { courseCount: { increment: 1 } }
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          adminId: 'admin1',
          actionType: 'COURSE_REPUBLISHED',
          targetType: 'COURSE',
          targetId: 'c1',
          reason: 'fixed'
        }
      });
      expect(result.isPublished).toBe(true);
    });

    it('returns course early if already published', async () => {
      prisma.course.findUnique.mockResolvedValue({
        id: 'c1',
        isPublished: true,
      });

      prisma.course.update = vi.fn();
      
      const result = await adminService.republishCourse('c1', 'fixed', 'admin1');
      expect(prisma.course.update).not.toHaveBeenCalled();
      expect(result.isPublished).toBe(true);
    });
  });

  describe('softDeleteCourse', () => {
    it('soft-deletes course, decrements subject count if published, logs audit', async () => {
      prisma.course.findUnique.mockResolvedValue({
        id: 'c1',
        isPublished: true,
        deletedAt: null,
        subjectId: 's1',
        slug: 'test-course',
        title: 'Test Course',
        instructor: { user: { email: 'a@b.com', fullName: 'A B' }, userId: 'u1' }
      });
      
      prisma.course.update = vi.fn().mockResolvedValue({ id: 'c1', isPublished: false, deletedAt: new Date() });
      prisma.subject = { update: vi.fn() };
      prisma.auditLog = { create: vi.fn() };

      const result = await adminService.softDeleteCourse('c1', 'violation', 'admin1');
      
      expect(prisma.course.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { isPublished: false, deletedAt: expect.any(Date) }
      });
      expect(prisma.subject.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { courseCount: { decrement: 1 } }
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          adminId: 'admin1',
          actionType: 'COURSE_DELETED',
          targetType: 'COURSE',
          targetId: 'c1',
          reason: 'violation'
        }
      });
      expect(result.deletedAt).toBeDefined();
    });

    it('soft-deletes course but does not decrement subject if already unpublished', async () => {
      prisma.course.findUnique.mockResolvedValue({
        id: 'c1',
        isPublished: false,
        deletedAt: null,
        subjectId: 's1',
        slug: 'test-course',
        title: 'Test Course',
        instructor: { user: { email: 'a@b.com', fullName: 'A B' }, userId: 'u1' }
      });
      
      prisma.course.update = vi.fn().mockResolvedValue({ id: 'c1', isPublished: false, deletedAt: new Date() });
      prisma.subject = { update: vi.fn() };
      prisma.auditLog = { create: vi.fn() };

      await adminService.softDeleteCourse('c1', 'violation', 'admin1');
      
      expect(prisma.subject.update).not.toHaveBeenCalled();
    });
  });

  describe('restoreCourse', () => {
    it('restores course, clears deletedAt but remains unpublished, logs audit', async () => {
      prisma.course.findUnique.mockResolvedValue({
        id: 'c1',
        isPublished: false,
        deletedAt: new Date(),
        subjectId: 's1',
        slug: 'test-course',
        title: 'Test Course',
        instructor: { user: { email: 'a@b.com', fullName: 'A B' }, userId: 'u1' }
      });
      
      prisma.course.update = vi.fn().mockResolvedValue({ id: 'c1', isPublished: false, deletedAt: null });
      prisma.auditLog = { create: vi.fn() };

      const result = await adminService.restoreCourse('c1', 'fixed', 'admin1');
      
      expect(prisma.course.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { deletedAt: null }
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          adminId: 'admin1',
          actionType: 'COURSE_RESTORED',
          targetType: 'COURSE',
          targetId: 'c1',
          reason: 'fixed'
        }
      });
      expect(result.deletedAt).toBeNull();
      expect(result.isPublished).toBe(false);
    });

    it('returns course early if already restored (deletedAt is null)', async () => {
      prisma.course.findUnique.mockResolvedValue({
        id: 'c1',
        isPublished: false,
        deletedAt: null,
      });

      prisma.course.update = vi.fn();
      
      await adminService.restoreCourse('c1', 'fixed', 'admin1');
      expect(prisma.course.update).not.toHaveBeenCalled();
    });
  });


  describe('getUsers', () => {
    it('returns users and total count', async () => {
      prisma.user = { 
        findMany: vi.fn().mockResolvedValue([{ id: 'u1' }]),
        count: vi.fn().mockResolvedValue(1)
      };

      const result = await adminService.getUsers({}, { page: 1, limit: 10 });
      expect(result.users).toHaveLength(1);
      expect(result.totalItems).toBe(1);
      expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {}
      }));
    });

    it('filters by role, isBanned, and deleted', async () => {
      prisma.user = { 
        findMany: vi.fn().mockResolvedValue([{ id: 'u1' }]),
        count: vi.fn().mockResolvedValue(1)
      };

      await adminService.getUsers({ role: 'INSTRUCTOR', isBanned: true, deleted: true }, { page: 1, limit: 10 });
      expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { 
          role: 'INSTRUCTOR',
          isBanned: true,
          deletedAt: { not: null }
        }
      }));
    });

    it('filters by search', async () => {
      prisma.user = { 
        findMany: vi.fn().mockResolvedValue([{ id: 'u1' }]),
        count: vi.fn().mockResolvedValue(1)
      };

      await adminService.getUsers({ search: 'john' }, { page: 1, limit: 10 });
      expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { 
          OR: [
            { fullName: { contains: 'john', mode: 'insensitive' } },
            { email: { contains: 'john', mode: 'insensitive' } }
          ]
        }
      }));
    });
  });
});
