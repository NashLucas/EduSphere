import { Router } from 'express';
import * as enrollmentsController from './enrollments.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { requireVerifiedEmail } from '../../middlewares/rbac.middleware.js';
import { enrollSchema, listEnrollmentsQuerySchema } from './enrollments.schema.js';

const router = Router();

router.use(requireAuth);

/**
 * @openapi
 * /enrollments:
 *   get:
 *     summary: List user enrollments
 *     description: Retrieves the authenticated user's enrollments.
 *     tags: [Enrollments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ACTIVE, COMPLETED, DROPPED]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *     responses:
 *       200:
 *         description: A paginated list of enrollments
 */
router.get(
  '/',
  validate({ query: listEnrollmentsQuerySchema }),
  enrollmentsController.listEnrollments
);

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
