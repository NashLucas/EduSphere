import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as coursesController from '../courses.controller.js';
import * as coursesService from '../courses.service.js';
import response from '../../../utils/api-response.js';
import { MESSAGES } from '../../../config/system_messages.js';

vi.mock('../courses.service.js');
vi.mock('../../../utils/api-response.js', () => ({
  default: {
    success: vi.fn(),
    paginated: vi.fn(),
    error: vi.fn(),
  }
}));

describe('Courses Controller', () => {
  let req, res, next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = { params: {}, query: {}, body: {} };
    res = {};
    next = vi.fn();
  });

  it('getCourses calls paginated', async () => {
    req.query = { page: 1, limit: 10, sort: 'newest' };
    coursesService.getCourses.mockResolvedValueOnce({ courses: [], totalItems: 0 });
    await coursesController.getCourses(req, res, next);
    expect(response.paginated).toHaveBeenCalledWith(res, [], { page: 1, limit: 10, totalItems: 0 }, MESSAGES.COURSES.RETRIEVED);
  });

  it('getFeaturedCourses calls success', async () => {
    coursesService.getFeaturedCourses.mockResolvedValueOnce([]);
    await coursesController.getFeaturedCourses(req, res, next);
    expect(response.success).toHaveBeenCalledWith(res, [], MESSAGES.COURSES.RETRIEVED);
  });

  it('getCourseBySlug calls success', async () => {
    req.params.slug = 'test';
    coursesService.getCourseBySlug.mockResolvedValueOnce({ id: '1' });
    await coursesController.getCourseBySlug(req, res, next);
    expect(response.success).toHaveBeenCalledWith(res, { id: '1' }, MESSAGES.COURSES.RETRIEVED_SINGLE);
  });

  it('catches errors', async () => {
    const err = new Error('Test');
    coursesService.getFeaturedCourses.mockRejectedValueOnce(err);
    await coursesController.getFeaturedCourses(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});
