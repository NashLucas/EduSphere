import { Router } from 'express';
import * as controller from './subjects.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { requireRole } from '../../middlewares/rbac.middleware.js';
import { UserRole } from '../../config/constants.js';
import {
  createSubjectSchema,
  updateSubjectSchema,
  subjectIdParamSchema,
  subjectSlugParamSchema,
  getSubjectsCoursesQuerySchema
} from './subjects.schema.js';

const router = Router();

router.get('/', controller.getSubjects);

router.get(
  '/:slug/courses',
  validate({ params: subjectSlugParamSchema, query: getSubjectsCoursesQuerySchema }),
  controller.getSubjectCourses
);

router.post(
  '/',
  validate({ body: createSubjectSchema }),
  requireAuth,
  requireRole([UserRole.ADMIN]),
  controller.createSubject
);

router.put(
  '/:id',
  validate({ params: subjectIdParamSchema, body: updateSubjectSchema }),
  requireAuth,
  requireRole([UserRole.ADMIN]),
  controller.updateSubject
);

router.delete(
  '/:id',
  validate({ params: subjectIdParamSchema }),
  requireAuth,
  requireRole([UserRole.ADMIN]),
  controller.deleteSubject
);

export default router;
