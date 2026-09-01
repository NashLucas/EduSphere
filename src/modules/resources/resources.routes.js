import { Router } from 'express';
import * as resourcesController from './resources.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { requireRole } from '../../middlewares/rbac.middleware.js';
import { uploadUrlSchema, confirmUploadSchema, getResourcesSchema, createResourceSchema } from './resources.schema.js';

const router = Router();

router.get(
  '/',
  validate({ query: getResourcesSchema }),
  resourcesController.getResources
);

router.post(
  '/',
  requireAuth,
  requireRole(['INSTRUCTOR', 'ADMIN']),
  validate({ body: createResourceSchema }),
  resourcesController.createResource
);

router.post(
  '/upload-url',
  requireAuth,
  requireRole(['INSTRUCTOR', 'ADMIN']),
  validate({ body: uploadUrlSchema }),
  resourcesController.getUploadUrl
);

router.post(
  '/confirm',
  requireAuth,
  requireRole(['INSTRUCTOR', 'ADMIN']),
  validate({ body: confirmUploadSchema }),
  resourcesController.confirmUpload
);

router.delete(
  '/:id',
  requireAuth,
  requireRole(['INSTRUCTOR', 'ADMIN']),
  resourcesController.deleteResource
);

export default router;
