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

export const getResources = async (req, res, next) => {
  try {
    const result = await resourcesService.getResources(req.query);
    return apiResponse.success(res, result, 'Resources retrieved successfully');
  } catch (err) {
    next(err);
  }
};

export const createResource = async (req, res, next) => {
  try {
    const result = await resourcesService.createResource(req.user, req.body);
    return apiResponse.created(res, result, 'Resource created successfully');
  } catch (err) {
    next(err);
  }
};

export const deleteResource = async (req, res, next) => {
  try {
    await resourcesService.deleteResource(req.user, req.params.id);
    return apiResponse.success(res, null, 'Resource deleted successfully');
  } catch (err) {
    next(err);
  }
};
