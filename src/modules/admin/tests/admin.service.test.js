import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as adminService from '../admin.service.js';
import prisma from '../../../database/index.js';
import redis from '../../../config/redis.js';
import { createInstructorProfile } from '../../instructors/instructors.service.js';

vi.mock('../../../utils/cache-keys.js', () => ({
  deleteByPattern: vi.fn(),
  userState: (id) => 'user:state:' + id, session: (id) => 'session:' + id, sessionIndex: (id) => 'session:index:' + id,
  TTL: { userState: 900 }
}));

vi.mock('../../../config/redis.js', () => ({
  default: { set: vi.fn(), smembers: vi.fn(), unlink: vi.fn() }
}));

vi.mock('../../../integrations/email/index.js', () => ({
  sendTakedownNotice: vi.fn().mockResolvedValue(), sendAccountStatusEmail: vi.fn().mockResolvedValue()
}));

vi.mock('../../notifications/notifications.service.js', () => ({
  createNotification: vi.fn().mockResolvedValue()
}));

vi.mock('../../instructors/instructors.service.js', () => ({
  createInstructorProfile: vi.fn().mockResolvedValue()
}));

vi.mock('../../../database/index.js', () => ({
  default: {
    course: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: {
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
    instructor: {
      create: vi.fn(),
    },
    $transaction: vi.fn().mockImplementation(async (cb) => {
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
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      prisma.user.count.mockResolvedValue(1);

      const result = await adminService.getUsers({}, { page: 1, limit: 10 });
      expect(result.users).toHaveLength(1);
      expect(result.totalItems).toBe(1);
      expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {}
      }));
    });

    it('filters by role, isBanned, and deleted', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      prisma.user.count.mockResolvedValue(1);

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
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      prisma.user.count.mockResolvedValue(1);

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


  describe('updateUserRole', () => {
    it('promotes user to INSTRUCTOR and creates profile', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        role: 'STUDENT',
        isBanned: false,
        isEmailVerified: true,
        deletedAt: null
      });

      prisma.user.update.mockResolvedValue({
        id: 'u1',
        role: 'INSTRUCTOR',
        isBanned: false,
        isEmailVerified: true,
        deletedAt: null
      });

      const result = await adminService.updateUserRole('u1', 'INSTRUCTOR', false, 'admin1');
      
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { role: 'INSTRUCTOR' }
      });
      expect(createInstructorProfile).toHaveBeenCalledWith('u1', expect.anything());
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ actionType: 'ROLE_CHANGED' })
      });
      expect(redis.set).toHaveBeenCalledWith(
        'user:state:u1',
        expect.any(String),
        'EX',
        900
      );
      expect(result.role).toBe('INSTRUCTOR');
    });

    it('throws 409 when demoting instructor with published courses', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        role: 'INSTRUCTOR',
        instructorProfile: {
          courses: [{ id: 'c1' }]
        }
      });

      await expect(adminService.updateUserRole('u1', 'STUDENT', false, 'admin1')).rejects.toThrow('User owns published courses');
    });

    it('demotes instructor and unpublishes courses when force=true', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        role: 'INSTRUCTOR',
        isBanned: false,
        isEmailVerified: true,
        deletedAt: null,
        instructorProfile: {
          courses: [{ id: 'c1', subjectId: 's1', slug: 'c1-slug' }]
        }
      });

      prisma.user.update.mockResolvedValue({
        id: 'u1',
        role: 'STUDENT',
        isBanned: false,
        isEmailVerified: true,
        deletedAt: null
      });

      await adminService.updateUserRole('u1', 'STUDENT', true, 'admin1');
      
      expect(prisma.course.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { isPublished: false }
      });
      expect(prisma.subject.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { courseCount: { decrement: 1 } }
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { role: 'STUDENT' }
      });
    });
  });


  describe('banUser', () => {
    it('bans user, revokes sessions, updates state and sends email', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        isBanned: false,
        email: 'test@test.com',
        fullName: 'Test User'
      });

      prisma.user.update.mockResolvedValue({
        id: 'u1',
        role: 'STUDENT',
        isBanned: true,
        isEmailVerified: true,
        deletedAt: null,
        email: 'test@test.com',
        fullName: 'Test User'
      });

      prisma.auditLog = { create: vi.fn() };
      
      const redis = (await import('../../../config/redis.js')).default;
      redis.smembers.mockResolvedValue(['session1', 'session2']);
      redis.unlink.mockResolvedValue();

      const { sendAccountStatusEmail } = await import('../../../integrations/email/index.js');

      const result = await adminService.banUser('u1', 'violation', 'admin1');
      
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { isBanned: true }
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ actionType: 'USER_BANNED', reason: 'violation' })
      });
      expect(redis.smembers).toHaveBeenCalledWith('session:index:u1');
      expect(redis.unlink).toHaveBeenCalledWith('session:session1', 'session:session2');
      expect(redis.unlink).toHaveBeenCalledWith('session:index:u1');
      expect(redis.set).toHaveBeenCalledWith(
        'user:state:u1',
        expect.stringContaining('"isBanned":true'),
        'EX',
        900
      );
      expect(sendAccountStatusEmail).toHaveBeenCalledWith({
        to: 'test@test.com',
        fullName: 'Test User',
        status: 'BANNED',
        reason: 'violation'
      });
      expect(result.revokedSessions).toBe(2);
    });

    it('returns 0 revokedSessions if already banned', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        isBanned: true
      });
      
      prisma.user.update.mockClear();

      const result = await adminService.banUser('u1', 'violation', 'admin1');
      
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(result.revokedSessions).toBe(0);
    });
  });


  describe('unbanUser', () => {
    it('unbans user, updates state and sends email', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        isBanned: true,
        email: 'test@test.com',
        fullName: 'Test User'
      });

      prisma.user.update.mockResolvedValue({
        id: 'u1',
        role: 'STUDENT',
        isBanned: false,
        isEmailVerified: true,
        deletedAt: null,
        email: 'test@test.com',
        fullName: 'Test User'
      });

      prisma.auditLog = { create: vi.fn() };
      
      const redis = (await import('../../../config/redis.js')).default;
      const { sendAccountStatusEmail } = await import('../../../integrations/email/index.js');

      await adminService.unbanUser('u1', 'appeal accepted', 'admin1');
      
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { isBanned: false }
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ actionType: 'USER_UNBANNED', reason: 'appeal accepted' })
      });
      expect(redis.set).toHaveBeenCalledWith(
        'user:state:u1',
        expect.stringContaining('"isBanned":false'),
        'EX',
        900
      );
      expect(sendAccountStatusEmail).toHaveBeenCalledWith({
        to: 'test@test.com',
        fullName: 'Test User',
        status: 'UNBANNED',
        reason: 'appeal accepted'
      });
    });

    it('returns early if already unbanned', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        isBanned: false
      });
      
      prisma.user.update.mockClear();
      const redis = (await import('../../../config/redis.js')).default;
      redis.set.mockClear();

      await adminService.unbanUser('u1', 'appeal accepted', 'admin1');
      
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });
  });


  describe('Achievements', () => {
    beforeEach(() => {
      prisma.achievement = {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      };
    });

    it('createAchievement creates achievement', async () => {
      prisma.achievement.findUnique.mockResolvedValue(null);
      prisma.achievement.create.mockResolvedValue({ id: 'a1', title: 'Test' });

      const result = await adminService.createAchievement({ title: 'Test', description: 'Desc', icon: 'http://icon', criteriaType: 'COURSES_COMPLETED', criteriaValue: 1 });
      
      expect(prisma.achievement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ title: 'Test' })
      });
      expect(result.id).toBe('a1');
    });

    it('updateAchievement updates achievement', async () => {
      prisma.achievement.findUnique.mockResolvedValueOnce({ id: 'a1', title: 'Old' }).mockResolvedValueOnce(null);
      prisma.achievement.update.mockResolvedValue({ id: 'a1', title: 'New' });

      const result = await adminService.updateAchievement('a1', { title: 'New' });
      
      expect(prisma.achievement.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { title: 'New' }
      });
      expect(result.title).toBe('New');
    });

    it('deleteAchievement deletes achievement', async () => {
      prisma.achievement.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.achievement.delete.mockResolvedValue({ id: 'a1' });

      await adminService.deleteAchievement('a1');
      
      expect(prisma.achievement.delete).toHaveBeenCalledWith({
        where: { id: 'a1' }
      });
    });
  });
});
