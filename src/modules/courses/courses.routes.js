import { Router } from 'express';
import * as coursesController from './courses.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { requireRole, requireVerifiedEmail } from '../../middlewares/rbac.middleware.js';
import { getCoursesQuerySchema, courseSlugParamSchema, courseIdParamSchema, createCourseSchema, updateCourseSchema } from './courses.schema.js';

const router = Router();

// ----------------------------------------------------------------------------
// Public Routes
// ----------------------------------------------------------------------------
// IMPORTANT: /featured must be registered BEFORE /:slug to avoid shadowing
/**
 * @openapi
 * /courses/featured:
 *   get:
 *     summary: Get featured courses
 *     tags: [Courses]
 *     responses:
 *       200:
 *         description: A list of featured courses
 */
router.get(
  '/featured',
  coursesController.getFeaturedCourses
);

/**
 * @openapi
 * /courses/{slug}:
 *   get:
 *     summary: Get course by slug
 *     tags: [Courses]
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Course details
 */
router.get(
  '/:slug',
  validate({ params: courseSlugParamSchema }),
  coursesController.getCourseBySlug
);

/**
 * @openapi
 * /courses:
 *   get:
 *     summary: List all courses
 *     tags: [Courses]
 *     responses:
 *       200:
 *         description: A list of courses
 */
router.get(
  '/',
  validate({ query: getCoursesQuerySchema }),
  coursesController.getCourses
);

// ----------------------------------------------------------------------------
// Protected Routes
// ----------------------------------------------------------------------------

/**
 * @openapi
 * /courses:
 *   post:
 *     summary: Create a new course
 *     tags: [Courses]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Course created successfully
 */
router.post(
  '/',
  requireAuth,
  requireVerifiedEmail,
  requireRole(['INSTRUCTOR', 'ADMIN']),
  validate({ body: createCourseSchema }),
  coursesController.createCourse
);

/**
 * @openapi
 * /courses/{id}:
 *   put:
 *     summary: Update a course
 *     tags: [Courses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Course updated successfully
 */
router.put(
  '/:id',
  requireAuth,
  requireRole(['INSTRUCTOR', 'ADMIN']),
  validate({ params: courseIdParamSchema, body: updateCourseSchema }),
  coursesController.updateCourse
);

/**
 * @openapi
 * /courses/{id}:
 *   delete:
 *     summary: Soft delete a course
 *     tags: [Courses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Course deleted successfully
 */
router.delete(
  '/:id',
  requireAuth,
  requireRole(['INSTRUCTOR', 'ADMIN']),
  validate({ params: courseIdParamSchema }),
  coursesController.deleteCourse
);

export { router as coursesRoutes };
