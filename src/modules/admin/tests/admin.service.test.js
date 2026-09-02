import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as adminService from '../admin.service.js';
import prisma from '../../../database/index.js';
import { deleteByPattern } from '../../../utils/cache-keys.js';
import { sendTakedownNotice } from '../../../integrations/email/index.js';

vi.mock('../../../utils/cache-keys.js', () => ({
  deleteByPattern: vi.fn()
}));

vi.mock('../../../integrations/email/index.js', () => ({
  sendTakedownNotice: vi.fn().mockResolvedValue()
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
});
