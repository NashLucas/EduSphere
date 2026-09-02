import apiResponse from '../../utils/api-response.js';
import * as resourcesService from './resources.service.js';

export const getUploadUrl = async (req, res, next) => {
  try {
    const result = await resourcesService.getUploadUrl(req.user, req.body);
    return response.success(res, result, 'Upload URL generated successfully');
  } catch (err) {
    next(err);
  }
};

export const confirmUpload = async (req, res, next) => {
  try {
    const result = await resourcesService.confirmUpload(req.user, req.body);
    return response.success(res, result, 'Upload confirmed successfully');
  } catch (err) {
    next(err);
  }
};

export const getResources = async (req, res, next) => {
  try {
    const result = await resourcesService.getResources(req.query);
    return response.success(res, result, 'Resources retrieved successfully');
  } catch (err) {
    next(err);
  }
};

export const createResource = async (req, res, next) => {
  try {
    const result = await resourcesService.createResource(req.user, req.body);
    return response.created(res, result, 'Resource created successfully');
  } catch (err) {
    next(err);
  }
};

export const deleteResource = async (req, res, next) => {
  try {
    await resourcesService.deleteResource(req.user, req.params.id);
    return response.success(res, null, 'Resource deleted successfully');
  } catch (err) {
    next(err);
  }
};
