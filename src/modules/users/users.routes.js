import { Router } from 'express';
import multer from 'multer';
import * as usersController from './users.controller.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

/**
 * @openapi
 * /users/me/avatar:
 *   post:
 *     summary: Upload user avatar
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               avatar:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Avatar uploaded successfully
 */
router.post('/me/avatar', requireAuth, upload.single('avatar'), usersController.uploadAvatar);

import * as achievementsController from '../achievements/achievements.controller.js';
router.get('/me/achievements', requireAuth, achievementsController.getMyAchievements);

import * as certificatesController from '../certificates/certificates.controller.js';
router.get('/me/certificates', requireAuth, certificatesController.getMyCertificates);

router.get('/me/dashboard', requireAuth, usersController.getStudentDashboard);

export default router;
