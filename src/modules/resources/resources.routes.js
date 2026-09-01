import { Router } from 'express';
import * as resourcesController from './resources.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { requireRole } from '../../middlewares/rbac.middleware.js';
import { uploadUrlSchema, confirmUploadSchema } from './resources.schema.js';

const router = Router();

/**
 * @openapi
 * /resources/upload-url:
 *   post:
 *     summary: Get pre-signed upload URL
 *     description: Generate a short-lived URL for direct-to-storage client uploads.
 *     tags: [Resources]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fileName, fileType, fileSize, courseId]
 *             properties:
 *               fileName:
 *                 type: string
 *               fileType:
 *                 type: string
 *                 example: 'video/mp4'
 *               fileSize:
 *                 type: integer
 *               courseId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: URL generated successfully
 *       400:
 *         description: Invalid input or file size exceeds limits
 *       403:
 *         description: Forbidden
 */
router.post(
  '/upload-url',
  requireAuth,
  requireRole(['INSTRUCTOR', 'ADMIN']),
  validate({ body: uploadUrlSchema }),
  resourcesController.getUploadUrl
);

/**
 * @openapi
 * /resources/confirm:
 *   post:
 *     summary: Confirm direct upload
 *     description: Confirms a completed direct upload and persists metadata. Re-verifies the object via HeadObject.
 *     tags: [Resources]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fileKey, title, category]
 *             properties:
 *               fileKey:
 *                 type: string
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               category:
 *                 type: string
 *               courseId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: Resource confirmed and saved
 *       400:
 *         description: Invalid input or file missing in staging
 *       403:
 *         description: Forbidden
 */
router.post(
  '/confirm',
  requireAuth,
  requireRole(['INSTRUCTOR', 'ADMIN']),
  validate({ body: confirmUploadSchema }),
  resourcesController.confirmUpload
);

export default router;
