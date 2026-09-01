import * as usersService from './users.service.js';
import * as apiResponse from '../../utils/api-response.js';
import { BadRequestError } from '../../utils/app-error.js';

export const uploadAvatar = async (req, res, next) => {
  try {
    if (!req.file) throw BadRequestError('No file provided');
    const updatedUser = await usersService.uploadAvatar(req.user.id, req.file.buffer);
    return apiResponse.success(res, { avatarUrl: updatedUser.avatarUrl }, 'Avatar updated successfully');
  } catch (err) {
    next(err);
  }
};
