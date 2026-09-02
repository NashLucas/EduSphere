import * as adminService from './admin.service.js';
import response from '../../utils/api-response.js';

export const getCourses = async (req, res, next) => {
  try {
    const { page, limit, isPublished, deleted, search, sort } = req.query;
    
    const filters = { isPublished, deleted, search };
    const { courses, totalItems } = await adminService.getCourses(filters, { page, limit, sort });
    
    response.paginated(res, courses, { page, limit, totalItems });
  } catch (error) {
    next(error);
  }
};
