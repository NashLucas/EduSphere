import { z } from 'zod';
import { paginationSchema } from '../../middlewares/validate.middleware.js';

export const getAdminCoursesQuerySchema = paginationSchema.extend({
  isPublished: z.preprocess(
    (v) => (v === 'true' ? true : v === 'false' ? false : undefined),
    z.boolean().optional()
  ),
  deleted: z.preprocess(
    (v) => (v === 'true' ? true : v === 'false' ? false : undefined),
    z.boolean().optional()
  ),
  search: z.string().optional(),
  sort: z.enum(['popular', 'rating', 'newest', 'price-low', 'price-high']).optional(),
});

export const adminCourseReasonBodySchema = z.object({
  reason: z.string().min(5, 'Reason must be at least 5 characters'),
});

export const getAdminUsersQuerySchema = paginationSchema.extend({
  role: z.enum(['STUDENT', 'INSTRUCTOR', 'ADMIN']).optional(),
  isBanned: z.preprocess(
    (v) => (v === 'true' ? true : v === 'false' ? false : undefined),
    z.boolean().optional()
  ),
  deleted: z.preprocess(
    (v) => (v === 'true' ? true : v === 'false' ? false : undefined),
    z.boolean().optional()
  ),
  search: z.string().optional(),
  sort: z.enum(['newest', 'oldest', 'name']).optional(),
});
