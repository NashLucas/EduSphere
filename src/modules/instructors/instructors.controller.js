import * as instructorsService from './instructors.service.js';
import { apiResponse } from '../../utils/api-response.js';

export const getInstructorDashboard = async (req, res, next) => {
  try {
    const dashboard = await instructorsService.getInstructorDashboard(req.user.id);
    return apiResponse.success(res, dashboard, 'Instructor dashboard retrieved successfully');
  } catch (err) {
    next(err);
  }
};

export const getInstructorCourses = async (req, res, next) => {
  try {
    const { sort } = req.query;
    const courses = await instructorsService.getInstructorCourses(req.user.id, sort);
    return apiResponse.success(res, courses, 'Instructor courses retrieved successfully');
  } catch (err) {
    next(err);
  }
};

export const getInstructorProfile = async (req, res, next) => {
  try {
    const { id } = req.params;
    const profile = await instructorsService.getInstructorProfile(id);
    return apiResponse.success(res, profile, 'Instructor profile retrieved successfully');
  } catch (err) {
    next(err);
  }
};
