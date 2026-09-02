import { Router } from 'express';
import * as notificationsController from './notifications.controller.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';

// If there's a schema for query pagination, we'll assume it exists in schema file or we use a common one.
// The user has common schemas in `src/utils/pagination.schema.js` maybe? No, TRD says list endpoints accept ?page=&limit=.
// Let's check `notifications.schema.js`. Wait, it's empty right now. We can add a basic `getNotificationsQuerySchema`.

const router = Router();

// Apply auth to all notification routes
router.use(requireAuth);

/**
 * @openapi
 * /notifications:
 *   get:
 *     summary: Get user notifications
 *     tags: [Notifications]
 */
router.get(
  '/',
  notificationsController.getNotifications
);

/**
 * @openapi
 * /notifications/read-all:
 *   patch:
 *     summary: Mark all notifications as read
 *     tags: [Notifications]
 */
router.patch(
  '/read-all',
  notificationsController.markAllAsRead
);

/**
 * @openapi
 * /notifications/{id}/read:
 *   patch:
 *     summary: Mark a notification as read
 *     tags: [Notifications]
 */
router.patch(
  '/:id/read',
  notificationsController.markAsRead
);

export default router;
