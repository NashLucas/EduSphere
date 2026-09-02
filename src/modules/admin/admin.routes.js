import { Router } from 'express';
import * as adminController from './admin.controller.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { requireRole } from '../../middlewares/rbac.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { getAdminCoursesQuerySchema } from './admin.schema.js';

const router = Router();

// All admin routes require ADMIN role
router.use(requireAuth, requireRole(['ADMIN']));

/**
 * @openapi
 * /admin/courses:
 *   get:
 *     summary: Paginated search across all platform courses
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: isPublished
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: deleted
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [popular, rating, newest, price-low, price-high]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Paginated course list
 */
router.get(
  '/courses',
  validate({ query: getAdminCoursesQuerySchema }),
  adminController.getCourses
);

import { adminRateLimiter } from '../../middlewares/rate-limit.middleware.js';
import { adminCourseReasonBodySchema } from './admin.schema.js';

/**
 * @openapi
 * /admin/courses/{id}/unpublish:
 *   patch:
 *     summary: Unpublish a violating course with a reason
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Course successfully unpublished
 */
router.patch(
  '/courses/:id/unpublish',
  adminRateLimiter,
  validate({ body: adminCourseReasonBodySchema }),
  adminController.unpublishCourse
);

/**
 * @openapi
 * /admin/courses/{id}/republish:
 *   patch:
 *     summary: Republish a taken-down course
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Course successfully republished
 */
router.patch(
  '/courses/:id/republish',
  adminRateLimiter,
  validate({ body: adminCourseReasonBodySchema }),
  adminController.republishCourse
);

/**
 * @openapi
 * /admin/courses/{id}:
 *   delete:
 *     summary: Soft-delete a course
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Course successfully soft-deleted
 *       404:
 *         description: Course not found
 */
router.delete(
  '/courses/:id',
  adminRateLimiter,
  validate({ body: adminCourseReasonBodySchema }),
  adminController.softDeleteCourse
);

export default router;
