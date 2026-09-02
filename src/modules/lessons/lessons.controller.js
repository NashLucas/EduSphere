import * as lessonsService from './lessons.service.js';
import response from '../../utils/api-response.js';

export const createLesson = async (req, res, next) => {
  try {
    const moduleId = req.params.moduleId;
    const userId = req.user.id;
    const userRole = req.user.role;
    
    const lesson = await lessonsService.createLesson(userId, userRole, moduleId, req.body);
    return res.status(201).json(response.created(lesson, 'Lesson created successfully'));
  } catch (err) {
    next(err);
  }
};

export const getLesson = async (req, res, next) => {
  try {
    const lessonId = req.params.id;
    const lesson = await lessonsService.getLesson(req.user, lessonId);
    return res.status(200).json(response.success(lesson, 'Lesson fetched successfully'));
  } catch (err) {
    next(err);
  }
};

export const updateLesson = async (req, res, next) => {
  try {
    const lessonId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;

    const lesson = await lessonsService.updateLesson(userId, userRole, lessonId, req.body);
    return res.status(200).json(response.success(lesson, 'Lesson updated successfully'));
  } catch (err) {
    next(err);
  }
};

export const deleteLesson = async (req, res, next) => {
  try {
    const lessonId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;

    await lessonsService.deleteLesson(userId, userRole, lessonId);
    return res.status(200).json(response.success(null, 'Lesson deleted successfully'));
  } catch (err) {
    next(err);
  }
};

export const completeLesson = async (req, res, next) => {
  try {
    const lessonId = req.params.id;
    const userId = req.user.id;
    const progress = await lessonsService.completeLesson(userId, lessonId);
    return res.status(200).json(response.success(progress, 'Lesson completed successfully'));
  } catch (err) {
    next(err);
  }
};
