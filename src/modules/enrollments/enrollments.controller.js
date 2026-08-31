import * as enrollmentsService from './enrollments.service.js';
import * as response from '../../utils/api-response.js';

export const enrollInCourse = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { courseId } = req.body;

    const enrollment = await enrollmentsService.enrollInCourse(userId, courseId);
    
    // We'll just return CREATED for standard HTTP conventions
    response.success(res, enrollment, 'Successfully enrolled in course', 201);
  } catch (error) {
    next(error);
  }
};

export const listEnrollments = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const enrollments = await enrollmentsService.listEnrollments(userId, req.query);
    response.success(res, enrollments, 'Enrollments retrieved successfully');
  } catch (error) {
    next(error);
  }
};

export const getProgressDetail = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { courseId } = req.params;
    const progress = await enrollmentsService.getProgressDetail(userId, courseId);
    response.success(res, progress, 'Progress retrieved successfully');
  } catch (error) {
    next(error);
  }
};
