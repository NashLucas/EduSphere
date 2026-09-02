import * as achievementsService from './achievements.service.js';
import response from '../../utils/api-response.js';

export const listAchievements = async (req, res, next) => {
  try {
    const achievements = await achievementsService.listAchievements();
    return response.success(res, achievements, 'Achievements retrieved successfully');
  } catch (err) {
    next(err);
  }
};

export const getMyAchievements = async (req, res, next) => {
  try {
    const myAchievements = await achievementsService.getMyAchievements(req.user.id);
    return response.success(res, myAchievements, 'User achievements retrieved successfully');
  } catch (err) {
    next(err);
  }
};
