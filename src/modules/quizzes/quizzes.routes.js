import { Router } from 'express';
import * as quizzesController from './quizzes.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { requireRole } from '../../middlewares/rbac.middleware.js';
import { createQuizSchema, updateQuizSchema, quizIdParamSchema, batchCreateQuestionsSchema, updateQuestionSchema, questionIdParamSchema } from './quizzes.schema.js';

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
 *   get:
 *     summary: Get a quiz
 *     description: Fetch quiz metadata and questions. Strips correctAnswerIndex for students.
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
 *     responses:
 *       200:
 *         description: Quiz retrieved successfully
 *       403:
 *         description: Forbidden (not enrolled or lesson locked)
 *       404:
 *         description: Quiz not found
 */
router.get(
  '/:id',
  requireAuth,
  validate({ params: quizIdParamSchema }),
  quizzesController.getQuiz
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

/**
 * @openapi
 * /quizzes/{id}/questions:
 *   post:
 *     summary: Add questions to a quiz
 *     description: Batch creates questions. Returns 409 if attempts exist.
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
 *             $ref: '#/components/schemas/BatchCreateQuestions'
 *     responses:
 *       201:
 *         description: Questions added successfully
 *       404:
 *         description: Quiz not found
 *       409:
 *         description: Cannot add questions if attempts exist
 */
router.post(
  '/:id/questions',
  requireAuth,
  requireRole(['INSTRUCTOR', 'ADMIN']),
  validate({ params: quizIdParamSchema, body: batchCreateQuestionsSchema }),
  quizzesController.addQuestions
);

/**
 * @openapi
 * /quizzes/{id}/questions/{questionId}:
 *   put:
 *     summary: Update a question
 *     description: Updates a question. Structural changes (options, correctAnswerIndex, type) return 409 if attempts exist.
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
 *       - in: path
 *         name: questionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateQuestion'
 *     responses:
 *       200:
 *         description: Question updated successfully
 *       404:
 *         description: Question or Quiz not found
 *       409:
 *         description: Cannot change question structure if attempts exist
 */
router.put(
  '/:id/questions/:questionId',
  requireAuth,
  requireRole(['INSTRUCTOR', 'ADMIN']),
  validate({ params: questionIdParamSchema, body: updateQuestionSchema }),
  quizzesController.updateQuestion
);

/**
 * @openapi
 * /quizzes/{id}/questions/{questionId}:
 *   delete:
 *     summary: Remove a question
 *     description: Removes a question from a quiz. Returns 409 if attempts exist.
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
 *       - in: path
 *         name: questionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Question deleted successfully
 *       404:
 *         description: Question or Quiz not found
 *       409:
 *         description: Cannot delete question if attempts exist
 */
router.delete(
  '/:id/questions/:questionId',
  requireAuth,
  requireRole(['INSTRUCTOR', 'ADMIN']),
  validate({ params: questionIdParamSchema }),
  quizzesController.deleteQuestion
);

export default router;
