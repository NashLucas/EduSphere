import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as adminService from '../admin.service.js';
import prisma from '../../../database/index.js';

vi.mock('../../../database/index.js', () => ({
  default: {
    course: {
      findMany: vi.fn(),
      count: vi.fn(),
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
});
