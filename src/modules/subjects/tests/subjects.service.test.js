import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as subjectsService from '../subjects.service.js';
import prisma from '../../../database/index.js';
import { getJSON, setWithTTL, deleteByPattern } from '../../../utils/cache-keys.js';
import { ConflictError, NotFoundError } from '../../../utils/app-error.js';

vi.mock('../../../database/index.js', () => ({
  default: {
    subject: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    course: {
      findMany: vi.fn(),
      count: vi.fn(),
    }
  }
}));

vi.mock('../../../utils/cache-keys.js', async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    getJSON: vi.fn(),
    setWithTTL: vi.fn().mockResolvedValue(true),
    deleteByPattern: vi.fn().mockResolvedValue(true),
  };
});

describe('Subjects Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAllSubjects', () => {
    it('returns cached subjects if available', async () => {
      getJSON.mockResolvedValueOnce([{ id: '1', name: 'Cached' }]);
      const res = await subjectsService.getAllSubjects();
      expect(res).toEqual([{ id: '1', name: 'Cached' }]);
      expect(prisma.subject.findMany).not.toHaveBeenCalled();
    });

    it('queries DB if cache miss', async () => {
      getJSON.mockResolvedValueOnce(null);
      prisma.subject.findMany.mockResolvedValueOnce([{ id: '2', name: 'DB' }]);
      const res = await subjectsService.getAllSubjects();
      expect(res).toEqual([{ id: '2', name: 'DB' }]);
      expect(prisma.subject.findMany).toHaveBeenCalled();
      expect(setWithTTL).toHaveBeenCalled();
    });
  });

  describe('getSubjectCourses', () => {
    it('throws NotFoundError if subject does not exist', async () => {
      prisma.subject.findFirst.mockResolvedValueOnce(null);
      await expect(subjectsService.getSubjectCourses('missing', { page: 1, limit: 10, sort: 'newest' }))
        .rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns courses and total items', async () => {
      prisma.subject.findFirst.mockResolvedValueOnce({ id: 'subj-1' });
      prisma.course.findMany.mockResolvedValueOnce([{ id: 'c1' }]);
      prisma.course.count.mockResolvedValueOnce(1);

      const res = await subjectsService.getSubjectCourses('slug', { page: 1, limit: 10, sort: 'popular' });
      expect(res.courses).toEqual([{ id: 'c1' }]);
      expect(res.totalItems).toBe(1);
    });
  });

  describe('createSubject', () => {
    it('generates slug and creates subject', async () => {
      prisma.subject.create.mockResolvedValueOnce({ id: '1', slug: 'test' });
      const res = await subjectsService.createSubject({ name: 'Test' });
      expect(res.slug).toBe('test');
      expect(prisma.subject.create).toHaveBeenCalledWith({ data: { name: 'Test', slug: 'test' } });
      expect(deleteByPattern).toHaveBeenCalledWith('cache:subjects:*');
    });

    it('throws ConflictError on P2002', async () => {
      prisma.subject.create.mockRejectedValueOnce({ code: 'P2002' });
      await expect(subjectsService.createSubject({ name: 'Dup' })).rejects.toMatchObject({ statusCode: 409 });
    });
  });

  describe('updateSubject', () => {
    it('throws NotFoundError if not found', async () => {
      prisma.subject.findUnique.mockResolvedValueOnce(null);
      await expect(subjectsService.updateSubject('1', {})).rejects.toMatchObject({ statusCode: 404 });
    });

    it('updates slug if name changes', async () => {
      prisma.subject.findUnique.mockResolvedValueOnce({ id: '1', name: 'Old', slug: 'old' });
      prisma.subject.update.mockResolvedValueOnce({ id: '1', slug: 'new' });
      const res = await subjectsService.updateSubject('1', { name: 'New' });
      expect(res.slug).toBe('new');
      expect(prisma.subject.update).toHaveBeenCalledWith({ where: { id: '1' }, data: { name: 'New', slug: 'new' } });
      expect(deleteByPattern).toHaveBeenCalledWith('cache:courses:*');
    });

    it('throws ConflictError on P2002', async () => {
      prisma.subject.findUnique.mockResolvedValueOnce({ id: '1', name: 'Old', slug: 'old' });
      prisma.subject.update.mockRejectedValueOnce({ code: 'P2002' });
      await expect(subjectsService.updateSubject('1', { name: 'Dup' })).rejects.toMatchObject({ statusCode: 409 });
    });
  });

  describe('deleteSubject', () => {
    it('deletes successfully', async () => {
      prisma.subject.delete.mockResolvedValueOnce(true);
      await subjectsService.deleteSubject('1');
      expect(prisma.subject.delete).toHaveBeenCalledWith({ where: { id: '1' } });
      expect(deleteByPattern).toHaveBeenCalledWith('cache:subjects:*');
    });

    it('throws ConflictError on P2003', async () => {
      prisma.subject.delete.mockRejectedValueOnce({ code: 'P2003' });
      prisma.course.count.mockResolvedValueOnce(5);
      await expect(subjectsService.deleteSubject('1')).rejects.toMatchObject({ statusCode: 409 });
      
      prisma.subject.delete.mockRejectedValueOnce({ code: 'P2003' });
      prisma.course.count.mockResolvedValueOnce(5);
      await expect(subjectsService.deleteSubject('1')).rejects.toThrow('5 courses');
    });
  });
});
