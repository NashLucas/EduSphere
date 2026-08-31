import { Router } from 'express';
import * as enrollmentsController from './enrollments.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { requireVerifiedEmail } from '../../middlewares/rbac.middleware.js';
import { enrollSchema } from './enrollments.schema.js';

const router = Router();

router.use(requireAuth);

/**
 * @openapi
 * /enrollments:
 *   post:
 *     summary: Enroll in a course
 *     description: Enrolls the authenticated user in the specified course. Requires a verified email.
 *     tags: [Enrollments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - courseId
 *             properties:
 *               courseId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: Successfully enrolled
 *       403:
 *         description: Unverified email
 *       404:
 *         description: Course not found or not published
 *       409:
 *         description: Already enrolled
 *       422:
 *         description: Instructor cannot enroll in own course
 */
router.post(
  '/',
  requireVerifiedEmail,
  validate({ body: enrollSchema }),
  enrollmentsController.enrollInCourse
);

export default router;
