import { Router } from 'express';
import * as quizzesController from './quizzes.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { requireRole } from '../../middlewares/rbac.middleware.js';
import { createQuizSchema, updateQuizSchema, quizIdParamSchema } from './quizzes.schema.js';

const router = Router();

/**
 * @openapi
 * /quizzes:
 *   post:
 *     summary: Create a new quiz
 *     description: Creates a new quiz. Instructors can only create quizzes for their own courses.
 *     tags: [Quizzes]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateQuiz'
 *     responses:
 *       201:
 *         description: Quiz created successfully
 */
router.post(
  '/',
  requireAuth,
  requireRole(['INSTRUCTOR', 'ADMIN']),
  validate({ body: createQuizSchema }),
  quizzesController.createQuiz
);

/**
 * @openapi
 * /quizzes/{id}:
 *   put:
 *     summary: Update a quiz
 *     description: Updates a quiz. Instructors can only update their own quizzes.
 *     tags: [Quizzes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateQuiz'
 *     responses:
 *       200:
 *         description: Quiz updated successfully
 *       404:
 *         description: Quiz not found
 */
router.put(
  '/:id',
  requireAuth,
  requireRole(['INSTRUCTOR', 'ADMIN']),
  validate({ params: quizIdParamSchema, body: updateQuizSchema }),
  quizzesController.updateQuiz
);

/**
 * @openapi
 * /quizzes/{id}:
 *   delete:
 *     summary: Delete a quiz
 *     description: Deletes a quiz. Returns 409 if attempts exist, overridable with ?force=true.
 *     tags: [Quizzes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: force
 *         schema:
 *           type: boolean
 *         description: Force deletion of quiz with attempts
 *     responses:
 *       200:
 *         description: Quiz deleted successfully
 *       404:
 *         description: Quiz not found
 *       409:
 *         description: Cannot delete quiz with existing attempts
 */
router.delete(
  '/:id',
  requireAuth,
  requireRole(['INSTRUCTOR', 'ADMIN']),
  validate({ params: quizIdParamSchema }),
  quizzesController.deleteQuiz
);

export default router;
