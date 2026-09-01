import apiResponse from '../../utils/api-response.js';
import * as resourcesService from './resources.service.js';

export const getUploadUrl = async (req, res, next) => {
  try {
    const result = await resourcesService.getUploadUrl(req.user, req.body);
    return apiResponse.success(res, result, 'Upload URL generated successfully');
  } catch (err) {
    next(err);
  }
};

export const confirmUpload = async (req, res, next) => {
  try {
    const result = await resourcesService.confirmUpload(req.user, req.body);
    return apiResponse.success(res, result, 'Upload confirmed successfully');
  } catch (err) {
    next(err);
  }
};
