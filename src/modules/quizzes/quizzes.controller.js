import * as quizzesService from './quizzes.service.js';
import apiResponse from '../../utils/api-response.js';

export const createQuiz = async (req, res, next) => {
  try {
    const quiz = await quizzesService.createQuiz(req.user.id, req.user.role, req.body);
    return apiResponse.created(res, quiz, 'Quiz created successfully');
  } catch (err) {
    next(err);
  }
};

export const updateQuiz = async (req, res, next) => {
  try {
    const quizId = req.params.id;
    const quiz = await quizzesService.updateQuiz(req.user, quizId, req.body);
    return apiResponse.success(res, quiz, 'Quiz updated successfully');
  } catch (err) {
    next(err);
  }
};

export const deleteQuiz = async (req, res, next) => {
  try {
    const quizId = req.params.id;
    const force = req.query.force === 'true';
    await quizzesService.deleteQuiz(req.user, quizId, force);
    return apiResponse.success(res, null, 'Quiz deleted successfully');
  } catch (err) {
    next(err);
  }
};
