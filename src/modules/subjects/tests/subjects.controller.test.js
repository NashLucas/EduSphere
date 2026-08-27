import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as subjectsController from '../subjects.controller.js';
import * as subjectsService from '../subjects.service.js';
import response from '../../../utils/api-response.js';
import { MESSAGES } from '../../../config/system_messages.js';

vi.mock('../subjects.service.js');
vi.mock('../../../utils/api-response.js', () => ({
  default: {
    success: vi.fn(),
    paginated: vi.fn(),
    created: vi.fn(),
    error: vi.fn(),
  }
}));

describe('Subjects Controller', () => {
  let req, res, next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = { params: {}, query: {}, body: {} };
    res = {};
    next = vi.fn();
  });

  it('getSubjects calls success', async () => {
    subjectsService.getAllSubjects.mockResolvedValueOnce([]);
    await subjectsController.getSubjects(req, res, next);
    expect(response.success).toHaveBeenCalledWith(res, [], MESSAGES.SUBJECTS.RETRIEVED);
  });

  it('getSubjectCourses calls paginated', async () => {
    req.params.slug = 'test';
    req.query = { page: 1, limit: 10, sort: 'newest' };
    subjectsService.getSubjectCourses.mockResolvedValueOnce({ courses: [], totalItems: 0 });
    await subjectsController.getSubjectCourses(req, res, next);
    expect(response.paginated).toHaveBeenCalledWith(res, [], { page: 1, limit: 10, totalItems: 0 }, MESSAGES.SUBJECTS.COURSES_RETRIEVED);
  });

  it('createSubject calls created', async () => {
    req.body = { name: 'test' };
    subjectsService.createSubject.mockResolvedValueOnce({ id: '1' });
    await subjectsController.createSubject(req, res, next);
    expect(response.created).toHaveBeenCalledWith(res, { id: '1' }, MESSAGES.SUBJECTS.CREATED);
  });

  it('updateSubject calls success', async () => {
    req.params.id = '1';
    req.body = { name: 'test' };
    subjectsService.updateSubject.mockResolvedValueOnce({ id: '1' });
    await subjectsController.updateSubject(req, res, next);
    expect(response.success).toHaveBeenCalledWith(res, { id: '1' }, MESSAGES.SUBJECTS.UPDATED);
  });

  it('deleteSubject calls success', async () => {
    req.params.id = '1';
    subjectsService.deleteSubject.mockResolvedValueOnce(true);
    await subjectsController.deleteSubject(req, res, next);
    expect(response.success).toHaveBeenCalledWith(res, null, MESSAGES.SUBJECTS.DELETED);
  });

  it('catches errors', async () => {
    const err = new Error('Test');
    subjectsService.getAllSubjects.mockRejectedValueOnce(err);
    await subjectsController.getSubjects(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});
