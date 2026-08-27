import { Router } from 'express';
import * as coursesController from './courses.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { getCoursesQuerySchema, courseSlugParamSchema } from './courses.schema.js';

const router = Router();

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

export { router as coursesRoutes };
