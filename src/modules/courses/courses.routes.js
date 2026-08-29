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
router.get(
  '/featured',
  coursesController.getFeaturedCourses
);

router.get(
  '/:slug',
  validate({ params: courseSlugParamSchema }),
  coursesController.getCourseBySlug
);

router.get(
  '/',
  validate({ query: getCoursesQuerySchema }),
  coursesController.getCourses
);

// ----------------------------------------------------------------------------
// Protected Routes
// ----------------------------------------------------------------------------

router.post(
  '/',
  requireAuth,
  requireVerifiedEmail,
  requireRole(['INSTRUCTOR', 'ADMIN']),
  validate({ body: createCourseSchema }),
  coursesController.createCourse
);

router.put(
  '/:id',
  requireAuth,
  requireRole(['INSTRUCTOR', 'ADMIN']),
  validate({ params: courseIdParamSchema, body: updateCourseSchema }),
  coursesController.updateCourse
);

router.delete(
  '/:id',
  requireAuth,
  requireRole(['INSTRUCTOR', 'ADMIN']),
  validate({ params: courseIdParamSchema }),
  coursesController.deleteCourse
);

export { router as coursesRoutes };
