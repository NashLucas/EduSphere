import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as coursesController from '../courses.controller.js';
import * as coursesService from '../courses.service.js';
import response from '../../../utils/api-response.js';
import { MESSAGES } from '../../../config/system_messages.js';

vi.mock('../courses.service.js');
vi.mock('../../../utils/api-response.js', () => ({
  default: {
    success: vi.fn(),
    created: vi.fn(),
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

  describe('Write Operations', () => {
    beforeEach(() => {
      req.user = { id: 'user-1', role: 'INSTRUCTOR' };
    });

    it('createCourse calls created', async () => {
      req.body = { title: 'New Course' };
      coursesService.createCourse.mockResolvedValueOnce({ id: '2' });
      await coursesController.createCourse(req, res, next);
      expect(response.created).toHaveBeenCalledWith(res, { id: '2' }, MESSAGES.COURSES.CREATED);
      expect(coursesService.createCourse).toHaveBeenCalledWith('user-1', { title: 'New Course' });
    });

    it('updateCourse calls success', async () => {
      req.params.id = 'course-1';
      req.body = { title: 'Updated' };
      coursesService.updateCourse.mockResolvedValueOnce({ id: 'course-1' });
      await coursesController.updateCourse(req, res, next);
      expect(response.success).toHaveBeenCalledWith(res, { id: 'course-1' }, MESSAGES.COURSES.UPDATED);
      expect(coursesService.updateCourse).toHaveBeenCalledWith('user-1', 'INSTRUCTOR', 'course-1', { title: 'Updated' });
    });

    it('deleteCourse calls success', async () => {
      req.params.id = 'course-1';
      coursesService.deleteCourse.mockResolvedValueOnce();
      await coursesController.deleteCourse(req, res, next);
      expect(response.success).toHaveBeenCalledWith(res, null, MESSAGES.COURSES.DELETED);
      expect(coursesService.deleteCourse).toHaveBeenCalledWith('user-1', 'INSTRUCTOR', 'course-1');
    });
  });
});
