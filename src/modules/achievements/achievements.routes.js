import { Router } from 'express';
import * as achievementsController from './achievements.controller.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';

const router = Router();

router.get('/', achievementsController.listAchievements);
router.get('/me', requireAuth, achievementsController.getMyAchievements);

export default router;
