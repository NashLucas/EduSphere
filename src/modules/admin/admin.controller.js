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

export const unpublishCourse = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.user.id;
    
    await adminService.unpublishCourse(id, reason, adminId);
    response.success(res, null, 'Course successfully unpublished');
  } catch (error) {
    next(error);
  }
};

export const republishCourse = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.user.id;
    
    await adminService.republishCourse(id, reason, adminId);
    response.success(res, null, 'Course successfully republished');
  } catch (error) {
    next(error);
  }
};
export const softDeleteCourse = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.user.id;
    
    await adminService.softDeleteCourse(id, reason, adminId);
    response.success(res, null, 'Course successfully soft-deleted');
  } catch (error) {
    next(error);
  }
};
