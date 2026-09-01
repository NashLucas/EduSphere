import { Router } from 'express';
import * as certificatesController from './certificates.controller.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';

const router = Router();

// Public verification endpoint
router.get('/:certificateNo', certificatesController.verifyCertificate);

// Owner-only download endpoint
router.get('/:id/download', requireAuth, certificatesController.downloadCertificate);

export default router;
