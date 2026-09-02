import { Router } from 'express';
import * as bookmarksController from './bookmarks.controller.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { toggleBookmarkSchema } from './bookmarks.schema.js';

const router = Router();

router.post('/toggle', requireAuth, validate(toggleBookmarkSchema), bookmarksController.toggleBookmark);
router.get('/', requireAuth, bookmarksController.listBookmarks);

export default router;
