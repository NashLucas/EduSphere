import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as coursesService from '../courses.service.js';
import prisma from '../../../database/index.js';
import { getJSON, setWithTTL } from '../../../utils/cache-keys.js';

vi.mock('../../../database/index.js', () => {
  const prismaMock = {
    course: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    instructor: {
      findUnique: vi.fn(),
    },
    subject: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    module: {
      findMany: vi.fn(),
    },
  };
  prismaMock.$transaction = vi.fn(async (args) => {
    if (typeof args === 'function') {
      return args(prismaMock);
    }
    const res = [];
    for (const arg of args) {
      res.push(await arg);
    }
    return res;
  });
  return {
    default: prismaMock
  };
});

vi.mock('../../../utils/cache-keys.js', async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    getJSON: vi.fn(),
    setWithTTL: vi.fn().mockResolvedValue(true),
    deleteByPattern: vi.fn().mockResolvedValue(true),
  };
});

describe('Courses Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getCourses', () => {
    it('applies filters correctly', async () => {
      prisma.course.findMany.mockResolvedValueOnce([]);
      prisma.course.count.mockResolvedValueOnce(0);

      const filters = { subject: 'sub1', level: 'BEGINNER', priceMax: '20', search: 'test' };
      const pagination = { page: 1, limit: 10, sort: 'popular' };

      const res = await coursesService.getCourses(filters, pagination);
      expect(res.courses).toEqual([]);
      expect(res.totalItems).toBe(0);
      expect(prisma.course.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          subjectId: 'sub1',
          level: 'BEGINNER',
          price: { lte: 20 },
          OR: [
            { title: { contains: 'test', mode: 'insensitive' } },
            { description: { contains: 'test', mode: 'insensitive' } },
          ],
        }),
        orderBy: { studentCount: 'desc' },
      }));
    });

    it('ignores empty filters', async () => {
      prisma.course.findMany.mockResolvedValueOnce([]);
      prisma.course.count.mockResolvedValueOnce(0);

      await coursesService.getCourses({ level: 'ALL_LEVELS' }, { page: 1, limit: 10, sort: 'newest' });
      expect(prisma.course.findMany).toHaveBeenCalledWith(expect.objectContaining({
        orderBy: { createdAt: 'desc' },
      }));
    });
    
    it('sorts by rating', async () => {
      prisma.course.findMany.mockResolvedValueOnce([]);
      prisma.course.count.mockResolvedValueOnce(0);
      await coursesService.getCourses({}, { page: 1, limit: 10, sort: 'rating' });
      expect(prisma.course.findMany).toHaveBeenCalledWith(expect.objectContaining({
        orderBy: { rating: 'desc' },
      }));
    });

    it('sorts by price-low', async () => {
      prisma.course.findMany.mockResolvedValueOnce([]);
      prisma.course.count.mockResolvedValueOnce(0);
      await coursesService.getCourses({}, { page: 1, limit: 10, sort: 'price-low' });
      expect(prisma.course.findMany).toHaveBeenCalledWith(expect.objectContaining({
        orderBy: { price: 'asc' },
      }));
    });

    it('sorts by price-high', async () => {
      prisma.course.findMany.mockResolvedValueOnce([]);
      prisma.course.count.mockResolvedValueOnce(0);
      await coursesService.getCourses({}, { page: 1, limit: 10, sort: 'price-high' });
      expect(prisma.course.findMany).toHaveBeenCalledWith(expect.objectContaining({
        orderBy: { price: 'desc' },
      }));
    });
  });

  describe('getFeaturedCourses', () => {
    it('returns cached if available', async () => {
      getJSON.mockResolvedValueOnce([{ id: '1' }]);
      const res = await coursesService.getFeaturedCourses();
      expect(res).toEqual([{ id: '1' }]);
      expect(prisma.course.findMany).not.toHaveBeenCalled();
    });

    it('queries and caches if missing', async () => {
      getJSON.mockResolvedValueOnce(null);
      prisma.course.findMany.mockResolvedValueOnce([{ id: '2' }]);
      const res = await coursesService.getFeaturedCourses();
      expect(res).toEqual([{ id: '2' }]);
      expect(prisma.course.findMany).toHaveBeenCalled();
      expect(setWithTTL).toHaveBeenCalled();
    });
  });

  describe('getCourseBySlug', () => {
    it('throws 404 if not found', async () => {
      prisma.course.findFirst.mockResolvedValueOnce(null);
      await expect(coursesService.getCourseBySlug('test')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('strips sensitive fields from non-preview lessons for anonymous users', async () => {
      const mockCourse = {
        id: '1',
        instructor: { userId: 'inst-1' },
        modules: [
          {
            lessons: [
              { id: 'l1', isFreePreview: true, content: 'secret1', videoUrl: 'v1' },
              { id: 'l2', isFreePreview: false, content: 'secret2', videoUrl: 'v2', codeSnippet: 'code' },
            ]
          }
        ]
      };
      prisma.course.findFirst.mockResolvedValueOnce(mockCourse);

      const res = await coursesService.getCourseBySlug('test', null);
      
      expect(res.modules[0].lessons[0].content).toBe('secret1');
      expect(res.modules[0].lessons[1].content).toBeUndefined();
      expect(res.modules[0].lessons[1].videoUrl).toBeUndefined();
      expect(res.modules[0].lessons[1].codeSnippet).toBeUndefined();
      expect(res.modules[0].lessons[1].id).toBe('l2');
    });

    it('does not strip sensitive fields for the course instructor', async () => {
      const mockCourse = {
        id: '1',
        instructor: { userId: 'inst-1' },
        modules: [
          {
            lessons: [
              { id: 'l2', isFreePreview: false, content: 'secret2', videoUrl: 'v2' },
            ]
          }
        ]
      };
      prisma.course.findFirst.mockResolvedValueOnce(mockCourse);

      const res = await coursesService.getCourseBySlug('test', { id: 'inst-1', role: 'INSTRUCTOR' });
      expect(res.modules[0].lessons[0].content).toBe('secret2');
    });
  });

  describe('Write Operations', () => {
    it('createCourse works', async () => {
      prisma.instructor.findUnique.mockResolvedValueOnce({ id: 'inst-1' });
      prisma.course.findFirst.mockResolvedValueOnce(null);
      prisma.subject.findUnique.mockResolvedValueOnce({ id: 'sub-1' });
      prisma.course.create.mockResolvedValueOnce({ id: 'course-1' });
      
      const res = await coursesService.createCourse('user-1', { title: 'Test', price: '10', subjectId: 'sub-1' });
      expect(res.id).toBe('course-1');
      expect(prisma.course.create).toHaveBeenCalled();
    });

    it('updateCourse works', async () => {
      prisma.course.findUnique.mockResolvedValueOnce({ id: 'c1', instructor: { userId: 'u1' }, isPublished: false });
      prisma.course.update.mockResolvedValueOnce({ id: 'c1' });
      await coursesService.updateCourse('u1', 'INSTRUCTOR', 'c1', { title: 'New' });
      expect(prisma.course.update).toHaveBeenCalled();
    });

    it('updateCourse publish throws 422 if no lessons', async () => {
      prisma.course.findUnique.mockResolvedValueOnce({ id: 'c1', instructor: { userId: 'u1' }, isPublished: false });
      prisma.course.findUnique.mockResolvedValueOnce({ id: 'c1', isPublished: false, subjectId: 's1' });
      prisma.module.findMany.mockResolvedValueOnce([]); // no modules
      await expect(coursesService.updateCourse('u1', 'INSTRUCTOR', 'c1', { isPublished: true }))
        .rejects.toMatchObject({ statusCode: 422 });
    });

    it('updateCourse publish works', async () => {
      prisma.course.findUnique.mockResolvedValueOnce({ id: 'c1', instructor: { userId: 'u1' }, isPublished: false });
      // fresh course
      prisma.course.findUnique.mockResolvedValueOnce({ id: 'c1', isPublished: false, subjectId: 's1' });
      prisma.module.findMany.mockResolvedValueOnce([{ lessons: [{ id: 'l1' }] }]);
      prisma.course.update.mockResolvedValueOnce({ id: 'c1', isPublished: true });
      await coursesService.updateCourse('u1', 'INSTRUCTOR', 'c1', { isPublished: true });
      expect(prisma.course.update).toHaveBeenCalled();
      expect(prisma.subject.update).toHaveBeenCalled();
    });

    it('updateCourse unpublish works', async () => {
      prisma.course.findUnique.mockResolvedValueOnce({ id: 'c1', instructor: { userId: 'u1' }, isPublished: true });
      prisma.course.findUnique.mockResolvedValueOnce({ id: 'c1', isPublished: true, subjectId: 's1' });
      prisma.subject.findUnique.mockResolvedValueOnce({ id: 's1', courseCount: 1 });
      prisma.course.update.mockResolvedValueOnce({ id: 'c1', isPublished: false });
      await coursesService.updateCourse('u1', 'INSTRUCTOR', 'c1', { isPublished: false });
      expect(prisma.course.update).toHaveBeenCalled();
      expect(prisma.subject.update).toHaveBeenCalled();
    });

    it('deleteCourse works for unpublished course', async () => {
      prisma.course.findUnique.mockResolvedValueOnce({ id: 'c1', instructor: { userId: 'u1' } });
      prisma.course.findUnique.mockResolvedValueOnce({ id: 'c1', isPublished: false, subjectId: 's1' });
      prisma.course.update.mockResolvedValueOnce({ id: 'c1' });
      await coursesService.deleteCourse('u1', 'INSTRUCTOR', 'c1');
      expect(prisma.course.update).toHaveBeenCalled();
    });

    it('deleteCourse works for published course', async () => {
      prisma.course.findUnique.mockResolvedValueOnce({ id: 'c1', instructor: { userId: 'u1' } });
      prisma.course.findUnique.mockResolvedValueOnce({ id: 'c1', isPublished: true, subjectId: 's1' });
      prisma.subject.findUnique.mockResolvedValueOnce({ id: 's1', courseCount: 1 });
      prisma.course.update.mockResolvedValueOnce({ id: 'c1' });
      await coursesService.deleteCourse('u1', 'INSTRUCTOR', 'c1');
      expect(prisma.course.update).toHaveBeenCalled();
      expect(prisma.subject.update).toHaveBeenCalled();
    });
  });

  describe('verifyCourseOwnership', () => {
    it('throws 404 if course does not exist', async () => {
      prisma.course.findUnique.mockResolvedValueOnce(null);
      await expect(coursesService.verifyCourseOwnership('c1', 'u1', 'INSTRUCTOR'))
        .rejects.toMatchObject({ statusCode: 404 });
    });

    it('throws 404 if course is soft-deleted', async () => {
      prisma.course.findUnique.mockResolvedValueOnce({ id: 'c1', deletedAt: new Date(), instructor: { userId: 'u1' } });
      await expect(coursesService.verifyCourseOwnership('c1', 'u1', 'INSTRUCTOR'))
        .rejects.toMatchObject({ statusCode: 404 });
    });

    it('throws 403 if user is not the owner and not admin', async () => {
      prisma.course.findUnique.mockResolvedValueOnce({ id: 'c1', deletedAt: null, instructor: { userId: 'owner-id' } });
      await expect(coursesService.verifyCourseOwnership('c1', 'u1', 'INSTRUCTOR'))
        .rejects.toMatchObject({ statusCode: 403 });
    });

    it('resolves successfully for the course owner', async () => {
      const mockCourse = { id: 'c1', deletedAt: null, instructor: { userId: 'owner-id' } };
      prisma.course.findUnique.mockResolvedValueOnce(mockCourse);
      const res = await coursesService.verifyCourseOwnership('c1', 'owner-id', 'INSTRUCTOR');
      expect(res).toEqual(mockCourse);
    });

    it('resolves successfully for an ADMIN even if not the owner', async () => {
      const mockCourse = { id: 'c1', deletedAt: null, instructor: { userId: 'owner-id' } };
      prisma.course.findUnique.mockResolvedValueOnce(mockCourse);
      const res = await coursesService.verifyCourseOwnership('c1', 'admin-id', 'ADMIN');
      expect(res).toEqual(mockCourse);
    });
  });
});
