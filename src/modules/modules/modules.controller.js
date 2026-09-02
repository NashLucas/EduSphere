import * as modulesService from './modules.service.js';
import response from '../../utils/api-response.js';

export const createModule = async (req, res, next) => {
  try {
    const courseId = req.params.courseId;
    const userId = req.user.id;
    const userRole = req.user.role;
    
    const mod = await modulesService.createModule(userId, userRole, courseId, req.body);
    return res.status(201).json(response.created(mod, 'Module created successfully'));
  } catch (err) {
    next(err);
  }
};

export const updateModule = async (req, res, next) => {
  try {
    const moduleId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;

    const mod = await modulesService.updateModule(userId, userRole, moduleId, req.body);
    return res.status(200).json(response.success(mod, 'Module updated successfully'));
  } catch (err) {
    next(err);
  }
};

export const deleteModule = async (req, res, next) => {
  try {
    const moduleId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;

    await modulesService.deleteModule(userId, userRole, moduleId);
    return res.status(200).json(response.success(null, 'Module deleted successfully'));
  } catch (err) {
    next(err);
  }
};
