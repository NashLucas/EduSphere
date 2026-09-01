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
}));

vi.mock('../../../database/index.js', () => ({
  prisma: {
    resource: {
      create: vi.fn(),
    },
  },
}));

import { prisma } from '../../../database/index.js';
import { AppError } from '../../../utils/app-error.js';

describe('Resources Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
      expect(prisma.resource.create).toHaveBeenCalledWith({
        data: {
          title: 'Doc',
          description: undefined,
          category: 'PDF',
          fileType: 'application/pdf',
          fileUrl: 'permanent/course-c1/file.pdf',
          fileSize: 500,
          courseId: 'c1',
          uploadedBy: 'u1',
        },
      });
    });

    it('throws BadRequestError if file not found in staging', async () => {
      const error = new Error('Not found');
      error.name = 'NotFound';
      storage.headObject.mockRejectedValue(error);

      await expect(resourcesService.confirmUpload(
        { id: 'u1', role: 'INSTRUCTOR' },
        { fileKey: 'staging/file.pdf', title: 'Doc', category: 'PDF' }
      )).rejects.toThrow(AppError);
    });
  });
});
