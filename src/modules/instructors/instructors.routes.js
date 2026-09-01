import { Router } from 'express';
import * as instructorsController from './instructors.controller.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { requireRole } from '../../middlewares/rbac.middleware.js';

const router = Router();

router.get('/me/dashboard', requireAuth, requireRole(['INSTRUCTOR']), instructorsController.getInstructorDashboard);
router.get('/me/courses', requireAuth, requireRole(['INSTRUCTOR']), instructorsController.getInstructorCourses);
router.get('/:id', instructorsController.getInstructorProfile);

export default router;
