import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as resourcesService from '../resources.service.js';
import * as coursesService from '../../courses/courses.service.js';
import * as storage from '../../../integrations/storage/index.js';

vi.mock('../../courses/courses.service.js', () => ({
  verifyCourseOwnership: vi.fn(),
}));

vi.mock('../../../integrations/storage/index.js', () => ({
  generatePresignedUrl: vi.fn(),
}));

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
});
