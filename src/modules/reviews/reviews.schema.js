import { z } from 'zod';

export const createReviewSchema = {
  body: z.object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().min(5).max(2000),
  }),
};

export const updateReviewSchema = {
  body: z.object({
    rating: z.number().int().min(1).max(5).optional(),
    comment: z.string().min(5).max(2000).optional(),
  }),
};
