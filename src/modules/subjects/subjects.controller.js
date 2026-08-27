import * as subjectsService from './subjects.service.js';
import response from '../../utils/api-response.js';
import { MESSAGES } from '../../config/system_messages.js';

export async function getSubjects(req, res, next) {
  try {
    const subjects = await subjectsService.getAllSubjects();
    return response.success(res, subjects, MESSAGES.SUBJECTS.RETRIEVED);
  } catch (err) {
    next(err);
  }
}

export async function getSubjectCourses(req, res, next) {
  try {
    const { slug } = req.params;
    const { page, limit, sort } = req.query;
    
    const { courses, totalItems } = await subjectsService.getSubjectCourses(slug, { page, limit, sort });
    
    return response.paginated(res, courses, { page, limit, totalItems }, MESSAGES.SUBJECTS.COURSES_RETRIEVED);
  } catch (err) {
    next(err);
  }
}

export async function createSubject(req, res, next) {
  try {
    const subject = await subjectsService.createSubject(req.body);
    return response.created(res, subject, MESSAGES.SUBJECTS.CREATED);
  } catch (err) {
    next(err);
  }
}

export async function updateSubject(req, res, next) {
  try {
    const { id } = req.params;
    const subject = await subjectsService.updateSubject(id, req.body);
    return response.success(res, subject, MESSAGES.SUBJECTS.UPDATED);
  } catch (err) {
    next(err);
  }
}

export async function deleteSubject(req, res, next) {
  try {
    const { id } = req.params;
    await subjectsService.deleteSubject(id);
    return response.success(res, null, MESSAGES.SUBJECTS.DELETED);
  } catch (err) {
    next(err);
  }
}
