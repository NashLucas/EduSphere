import * as coursesService from './courses.service.js';
import response from '../../utils/api-response.js';
import { MESSAGES } from '../../config/system_messages.js';

export const getCourses = async (req, res, next) => {
  try {
    const { page, limit, subject, level, priceMax, search, sort } = req.query;
    const filters = { subject, level, priceMax, search };
    
    const { courses, totalItems } = await coursesService.getCourses(filters, { page, limit, sort });
    
    response.paginated(res, courses, { page, limit, totalItems }, MESSAGES.COURSES.RETRIEVED);
  } catch (error) {
    next(error);
  }
};

export const getFeaturedCourses = async (req, res, next) => {
  try {
    const courses = await coursesService.getFeaturedCourses();
    response.success(res, courses, MESSAGES.COURSES.RETRIEVED);
  } catch (error) {
    next(error);
  }
};

export const getCourseBySlug = async (req, res, next) => {
  try {
    const course = await coursesService.getCourseBySlug(req.params.slug);
    response.success(res, course, MESSAGES.COURSES.RETRIEVED_SINGLE);
  } catch (error) {
    next(error);
  }
};
