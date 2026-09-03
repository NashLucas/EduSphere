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

export const restoreCourse = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.user.id;
    
    await adminService.restoreCourse(id, reason, adminId);
    response.success(res, null, 'Course successfully restored');
  } catch (error) {
    next(error);
  }
};

export const getUsers = async (req, res, next) => {
  try {
    const { page, limit, role, isBanned, deleted, search, sort } = req.query;
    
    const filters = { role, isBanned, deleted, search };
    const { users, totalItems } = await adminService.getUsers(filters, { page, limit, sort });
    
    response.paginated(res, users, { page, limit, totalItems });
  } catch (error) {
    next(error);
  }
};

export const updateUserRole = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    const force = req.query.force;
    const adminId = req.user.id;
    
    const result = await adminService.updateUserRole(id, role, force, adminId);
    response.success(res, result, 'User role updated successfully');
  } catch (error) {
    next(error);
  }
};

export const banUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.user.id;
    
    const result = await adminService.banUser(id, reason, adminId);
    response.success(res, result, 'User banned successfully');
  } catch (error) {
    next(error);
  }
};

export const unbanUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.user.id;
    
    await adminService.unbanUser(id, reason, adminId);
    response.success(res, null, 'User unbanned successfully');
  } catch (error) {
    next(error);
  }
};

export const createAchievement = async (req, res, next) => {
  try {
    const data = req.body;
    
    const result = await adminService.createAchievement(data);
    response.created(res, result, 'Achievement created successfully');
  } catch (error) {
    next(error);
  }
};

export const updateAchievement = async (req, res, next) => {
  try {
    const { id } = req.params;
    const data = req.body;
    
    const result = await adminService.updateAchievement(id, data);
    response.success(res, result, 'Achievement updated successfully');
  } catch (error) {
    next(error);
  }
};

export const deleteAchievement = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    await adminService.deleteAchievement(id);
    response.success(res, null, 'Achievement deleted successfully');
  } catch (error) {
    next(error);
  }
};

export const getAnalytics = async (req, res, next) => {
  try {
    const result = await adminService.getAnalytics();
    response.success(res, result, 'Analytics retrieved successfully');
  } catch (error) {
    next(error);
  }
};
