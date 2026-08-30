import { Router } from 'express';
import * as modulesController from './modules.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { requireRole } from '../../middlewares/rbac.middleware.js';
import { updateModuleSchema, moduleIdParamSchema } from './modules.schema.js';
import * as lessonsController from '../lessons/lessons.controller.js';
import { createLessonSchema } from '../lessons/lessons.schema.js';

const router = Router();

// ----------------------------------------------------------------------------
// Lessons (Nested under modules)
// ----------------------------------------------------------------------------
/**
 * @openapi
 * /modules/{moduleId}/lessons:
 *   post:
 *     summary: Create a new lesson
 *     tags: [Lessons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: moduleId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - type
 *               - content
 *               - orderIndex
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
 *               codeSnippet:
 *                 type: string
 *               durationMinutes:
 *                 type: integer
 *               orderIndex:
 *                 type: integer
 *               isFreePreview:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Lesson created successfully
 */
router.post(
  '/:moduleId/lessons',
  requireAuth,
  requireRole(['INSTRUCTOR', 'ADMIN']),
  validate({ params: moduleIdParamSchema, body: createLessonSchema }),
  lessonsController.createLesson
);

// PUT /modules/:id
/**
 * @openapi
 * /modules/{id}:
 *   put:
 *     summary: Update a module
 *     tags: [Modules]
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
 *               orderIndex:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Module updated successfully
 */
router.put(
  '/:id',
  requireAuth,
  requireRole(['INSTRUCTOR', 'ADMIN']),
  validate({ params: moduleIdParamSchema, body: updateModuleSchema }),
  modulesController.updateModule
);

// DELETE /modules/:id
/**
 * @openapi
 * /modules/{id}:
 *   delete:
 *     summary: Delete a module
 *     tags: [Modules]
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
 *         description: Module deleted successfully
 */
router.delete(
  '/:id',
  requireAuth,
  requireRole(['INSTRUCTOR', 'ADMIN']),
  validate({ params: moduleIdParamSchema }),
  modulesController.deleteModule
);

export default router;
