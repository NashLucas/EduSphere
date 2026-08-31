import { Router } from 'express';
import * as enrollmentsController from './enrollments.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { requireVerifiedEmail } from '../../middlewares/rbac.middleware.js';
import { enrollSchema, listEnrollmentsQuerySchema, courseIdParamSchema } from './enrollments.schema.js';

const router = Router();

router.use(requireAuth);

/**
 * @openapi
 * /enrollments/me:
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
  '/me',
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

/**
 * @openapi
 * /enrollments/{courseId}/progress:
 *   get:
 *     summary: Get enrollment progress detail
 *     description: Retrieves the lesson-by-lesson progress checklist for an enrollment.
 *     tags: [Enrollments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Progress detail grouped by module
 *       404:
 *         description: Enrollment not found
 */
router.get(
  '/:courseId/progress',
  validate({ params: courseIdParamSchema }),
  enrollmentsController.getProgressDetail
);

/**
 * @openapi
 * /enrollments/{courseId}/drop:
 *   patch:
 *     summary: Drop an enrollment
 *     description: Sets the enrollment status to DROPPED, preserving progress but skipping studentCount decrements.
 *     tags: [Enrollments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Enrollment dropped successfully
 *       404:
 *         description: Enrollment not found
 */
router.patch(
  '/:courseId/drop',
  validate({ params: courseIdParamSchema }),
  enrollmentsController.dropEnrollment
);

export default router;
