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

/**
 * @openapi
 * /subjects:
 *   get:
 *     summary: List all subjects
 *     tags: [Subjects]
 *     responses:
 *       200:
 *         description: A list of subjects
 */
router.get('/', controller.getSubjects);

/**
 * @openapi
 * /subjects/{slug}/courses:
 *   get:
 *     summary: Get courses for a subject
 *     tags: [Subjects]
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: A list of courses for the subject
 */
router.get(
  '/:slug/courses',
  validate({ params: subjectSlugParamSchema, query: getSubjectsCoursesQuerySchema }),
  controller.getSubjectCourses
);

/**
 * @openapi
 * /subjects:
 *   post:
 *     summary: Create a new subject
 *     tags: [Subjects]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Subject created successfully
 */
router.post(
  '/',
  validate({ body: createSubjectSchema }),
  requireAuth,
  requireRole([UserRole.ADMIN]),
  controller.createSubject
);

/**
 * @openapi
 * /subjects/{id}:
 *   put:
 *     summary: Update a subject
 *     tags: [Subjects]
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
 *         description: Subject updated successfully
 */
router.put(
  '/:id',
  validate({ params: subjectIdParamSchema, body: updateSubjectSchema }),
  requireAuth,
  requireRole([UserRole.ADMIN]),
  controller.updateSubject
);

/**
 * @openapi
 * /subjects/{id}:
 *   delete:
 *     summary: Delete a subject
 *     tags: [Subjects]
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
 *         description: Subject deleted successfully
 */
router.delete(
  '/:id',
  validate({ params: subjectIdParamSchema }),
  requireAuth,
  requireRole([UserRole.ADMIN]),
  controller.deleteSubject
);

export default router;
