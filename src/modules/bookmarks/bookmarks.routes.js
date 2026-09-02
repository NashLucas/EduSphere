import { Router } from 'express';
import * as bookmarksController from './bookmarks.controller.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { toggleBookmarkSchema } from './bookmarks.schema.js';

const router = Router();

/**
 * @openapi
 * /bookmarks/toggle:
 *   post:
 *     summary: Toggle a bookmark
 *     tags: [Bookmarks]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               courseId:
 *                 type: string
 *               lessonId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Bookmark toggled
 */
router.post('/toggle', requireAuth, validate(toggleBookmarkSchema), bookmarksController.toggleBookmark);

/**
 * @openapi
 * /bookmarks:
 *   get:
 *     summary: List user bookmarks
 *     tags: [Bookmarks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
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
 *         description: List of bookmarks
 */
router.get('/', requireAuth, bookmarksController.listBookmarks);

export default router;
