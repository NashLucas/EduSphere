import * as subjectsService from './subjects.service.js';
import response from '../../utils/api-response.js';

export async function getSubjects(req, res, next) {
  try {
    const subjects = await subjectsService.getAllSubjects();
    return response.success(res, subjects, 'Subjects retrieved successfully');
  } catch (err) {
    next(err);
  }
}

export async function getSubjectCourses(req, res, next) {
  try {
    const { slug } = req.params;
    const { page, limit, sort } = req.query;
    
    const { courses, totalItems } = await subjectsService.getSubjectCourses(slug, { page, limit, sort });
    
    return response.paginated(res, courses, { page, limit, totalItems }, 'Courses retrieved successfully');
  } catch (err) {
    next(err);
  }
}

export async function createSubject(req, res, next) {
  try {
    const subject = await subjectsService.createSubject(req.body);
    return response.created(res, subject, 'Subject created successfully');
  } catch (err) {
    next(err);
  }
}

export async function updateSubject(req, res, next) {
  try {
    const { id } = req.params;
    const subject = await subjectsService.updateSubject(id, req.body);
    return response.success(res, subject, 'Subject updated successfully');
  } catch (err) {
    next(err);
  }
}

export async function deleteSubject(req, res, next) {
  try {
    const { id } = req.params;
    await subjectsService.deleteSubject(id);
    return response.success(res, null, 'Subject deleted successfully');
  } catch (err) {
    next(err);
  }
}
