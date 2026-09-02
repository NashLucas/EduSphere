import * as usersService from './users.service.js';
import * as apiResponse from '../../utils/api-response.js';
import { BadRequestError } from '../../utils/app-error.js';

export const uploadAvatar = async (req, res, next) => {
  try {
    if (!req.file) throw BadRequestError('No file provided');
    const updatedUser = await usersService.uploadAvatar(req.user.id, req.file.buffer);
    return response.success(res, { avatarUrl: updatedUser.avatarUrl }, 'Avatar updated successfully');
  } catch (err) {
    next(err);
  }
};

export const getStudentDashboard = async (req, res, next) => {
  try {
    const dashboardData = await usersService.getStudentDashboard(req.user.id);
    return response.success(res, dashboardData, 'Student dashboard retrieved successfully');
  } catch (err) {
    next(err);
  }
};

export const getUserProfile = async (req, res, next) => {
  try {
    const { id } = req.params;
    const profile = await usersService.getUserProfile(id);
    return response.success(res, profile, 'User profile retrieved successfully');
  } catch (err) {
    next(err);
  }
};

export const updateProfile = async (req, res, next) => {
  try {
    const updated = await usersService.updateUserProfile(req.user.id, req.body);
    return response.success(res, updated, 'Profile updated successfully');
  } catch (err) {
    next(err);
  }
};
