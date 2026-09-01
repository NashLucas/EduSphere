import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as resourcesService from '../resources.service.js';
import * as coursesService from '../../courses/courses.service.js';
import * as storage from '../../../integrations/storage/index.js';

vi.mock('../../courses/courses.service.js', () => ({
  verifyCourseOwnership: vi.fn(),
}));

vi.mock('../../../integrations/storage/index.js', () => ({
  generatePresignedUrl: vi.fn(),
  headObject: vi.fn(),
  moveObject: vi.fn(),
  deleteObject: vi.fn(),
}));

vi.mock('../../../database/index.js', () => ({
  default: {
    resource: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import prisma from '../../../database/index.js';
import { AppError, ForbiddenError, NotFoundError } from '../../../utils/app-error.js';

describe('Resources Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getResources', () => {
    it('returns resources and pagination metadata', async () => {
      prisma.resource.findMany.mockResolvedValue([{ id: 'r1' }]);
      prisma.resource.count.mockResolvedValue(1);
      const result = await resourcesService.getResources({ category: 'VIDEO', courseId: 'c1', page: 2, limit: 5 });
      expect(result).toEqual({ resources: [{ id: 'r1' }], total: 1, page: 2, limit: 5, totalPages: 1 });
      expect(prisma.resource.findMany).toHaveBeenCalledWith({
        where: { category: 'VIDEO', courseId: 'c1' },
        skip: 5,
        take: 5,
        orderBy: { createdAt: 'desc' }
      });
    });
  });

  describe('createResource', () => {
    it('verifies ownership and creates resource', async () => {
      prisma.resource.create.mockResolvedValue({ id: 'r1' });
      const result = await resourcesService.createResource({ id: 'u1', role: 'INSTRUCTOR' }, { title: 'Doc', category: 'PDF', fileType: 'pdf', fileUrl: 'http', courseId: 'c1' });
      expect(coursesService.verifyCourseOwnership).toHaveBeenCalledWith('c1', 'u1', 'INSTRUCTOR');
      expect(prisma.resource.create).toHaveBeenCalled();
    });
  });

  describe('deleteResource', () => {
    it('deletes db row and storage object if owned', async () => {
      prisma.resource.findUnique.mockResolvedValue({ id: 'r1', uploadedBy: 'u1', fileUrl: 'permanent/f1' });
      await resourcesService.deleteResource({ id: 'u1', role: 'INSTRUCTOR' }, 'r1');
      expect(prisma.resource.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
      expect(storage.deleteObject).toHaveBeenCalledWith('permanent/f1');
    });

    it('throws NotFound if resource not found', async () => {
      prisma.resource.findUnique.mockResolvedValue(null);
      await expect(resourcesService.deleteResource({ id: 'u1', role: 'INSTRUCTOR' }, 'r1')).rejects.toThrow(AppError);
    });

    it('throws Forbidden if user is not owner and not admin', async () => {
      prisma.resource.findUnique.mockResolvedValue({ id: 'r1', uploadedBy: 'u2' });
      await expect(resourcesService.deleteResource({ id: 'u1', role: 'INSTRUCTOR' }, 'r1')).rejects.toThrow(AppError);
    });
  });
});


describe('Resources Service - Old Tests', () => {
  describe('getUploadUrl', () => {
    it('generates a presigned url with staging prefix for valid input', async () => {
      coursesService.verifyCourseOwnership.mockResolvedValue(true);
      storage.generatePresignedUrl.mockResolvedValue({ uploadUrl: 'http://upload' });
      const result = await resourcesService.getUploadUrl(
        { id: 'u1', role: 'INSTRUCTOR' },
        { fileName: 'video.mp4', fileType: 'video/mp4', fileSize: 1000, courseId: 'c1' }
      );
      expect(result.uploadUrl).toBe('http://upload');
      expect(coursesService.verifyCourseOwnership).toHaveBeenCalledWith('c1', 'u1', 'INSTRUCTOR');
      expect(storage.generatePresignedUrl).toHaveBeenCalledWith(expect.stringMatching(/^staging\/course-c1\/[0-9a-f-]+\-video\.mp4$/), 'video/mp4', 1000);
    });
  });

  describe('confirmUpload', () => {
    it('heads object, moves it, and creates resource', async () => {
      coursesService.verifyCourseOwnership.mockResolvedValue(true);
      storage.headObject.mockResolvedValue({ contentLength: 500, contentType: 'application/pdf' });
      storage.moveObject.mockResolvedValue();
      prisma.resource.create.mockResolvedValue({ id: 'r1' });
      const result = await resourcesService.confirmUpload(
        { id: 'u1', role: 'INSTRUCTOR' },
        { fileKey: 'staging/course-c1/file.pdf', title: 'Doc', category: 'PDF', courseId: 'c1' }
      );
      expect(result.id).toBe('r1');
      expect(storage.headObject).toHaveBeenCalledWith('staging/course-c1/file.pdf');
      expect(storage.moveObject).toHaveBeenCalledWith('staging/course-c1/file.pdf', 'permanent/course-c1/file.pdf');
    });
  });
});
