import * as achievementsService from './achievements.service.js';
import { apiResponse } from '../../utils/api-response.js';

export const listAchievements = async (req, res, next) => {
  try {
    const achievements = await achievementsService.listAchievements();
    return res.status(200).json(apiResponse.success(achievements, 'Achievements retrieved successfully'));
  } catch (err) {
    next(err);
  }
};

export const getMyAchievements = async (req, res, next) => {
  try {
    const myAchievements = await achievementsService.getMyAchievements(req.user.id);
    return res.status(200).json(apiResponse.success(myAchievements, 'User achievements retrieved successfully'));
  } catch (err) {
    next(err);
  }
};
