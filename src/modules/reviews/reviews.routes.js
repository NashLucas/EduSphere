import { Router } from 'express';
import * as reviewsController from './reviews.controller.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { updateReviewSchema } from './reviews.schema.js';

const router = Router();

router.put(
  '/:id',
  requireAuth,
  validate({ body: updateReviewSchema.body }),
  reviewsController.updateReview
);

router.delete(
  '/:id',
  requireAuth,
  reviewsController.deleteReview
);

export default router;
