import { z } from 'zod';
import { paginationSchema } from '../../middlewares/validate.middleware.js';

export const getCoursesQuerySchema = paginationSchema.extend({
  subject: z.string().uuid().optional(),
  level: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'ALL_LEVELS']).optional(),
  priceMax: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  search: z.string().optional(),
  sort: z.enum(['newest', 'popular', 'rating', 'price-low', 'price-high']).optional(),
}).strict();

export const courseSlugParamSchema = z.object({
  slug: z.string().min(1).max(100),
}).strict();
