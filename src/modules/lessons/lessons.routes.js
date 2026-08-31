import { Router } from 'express';
import * as lessonsController from './lessons.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { requireAuth, optionalAuth } from '../../middlewares/auth.middleware.js';
import { requireRole } from '../../middlewares/rbac.middleware.js';
import { updateLessonSchema, lessonIdParamSchema } from './lessons.schema.js';

const router = Router();

// GET /lessons/:id
/**
 * @openapi
 * /lessons/{id}:
 *   get:
 *     summary: Get a lesson
 *     tags: [Lessons]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lesson details
 */
router.get(
  '/:id',
  optionalAuth,
  validate({ params: lessonIdParamSchema }),
  lessonsController.getLesson
);

// PUT /lessons/:id
/**
 * @openapi
 * /lessons/{id}:
 *   put:
 *     summary: Update a lesson
 *     tags: [Lessons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [VIDEO, TEXT, CODE, QUIZ]
 *               content:
 *                 type: string
 *               videoUrl:
 *                 type: string
 *                 nullable: true
 *               codeSnippet:
 *                 type: string
 *                 nullable: true
 *               durationMinutes:
 *                 type: integer
 *               orderIndex:
 *                 type: integer
 *               isFreePreview:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Lesson updated successfully
 */
router.put(
  '/:id',
  requireAuth,
  requireRole(['INSTRUCTOR', 'ADMIN']),
  validate({ params: lessonIdParamSchema, body: updateLessonSchema }),
  lessonsController.updateLesson
);

// DELETE /lessons/:id
/**
 * @openapi
 * /lessons/{id}:
 *   delete:
 *     summary: Delete a lesson
 *     tags: [Lessons]
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
 *         description: Lesson deleted successfully
 */
router.delete(
  '/:id',
  requireAuth,
  requireRole(['INSTRUCTOR', 'ADMIN']),
  validate({ params: lessonIdParamSchema }),
  lessonsController.deleteLesson
);

export default router;
