import { Router } from 'express';
import * as webhooksController from './webhooks.controller.js';

const router = Router();

/**
 * @openapi
 * /webhooks/email:
 *   post:
 *     summary: Handle incoming email provider webhooks
 *     tags: [Webhooks]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Webhook received successfully
 */
router.post('/email', webhooksController.handleEmailWebhook);

export default router;
