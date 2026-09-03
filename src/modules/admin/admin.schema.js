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

export const adminReasonBodySchema = z.object({
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

export const updateUserRoleBodySchema = z.object({
  role: z.enum(['STUDENT', 'INSTRUCTOR', 'ADMIN']),
});

export const updateUserRoleQuerySchema = z.object({
  force: z.preprocess(
    (v) => (v === 'true' ? true : v === 'false' ? false : undefined),
    z.boolean().optional()
  )
});

export const achievementBodySchema = z.object({
  title: z.string().min(2, 'Title must be at least 2 characters'),
  description: z.string().min(5, 'Description must be at least 5 characters'),
  icon: z.string().url('Icon must be a valid URL'),
  criteriaType: z.enum(['COURSES_COMPLETED', 'QUIZ_PERFECT_SCORE', 'STREAK_DAYS', 'LESSONS_COMPLETED']),
  criteriaValue: z.number().int().positive('Criteria value must be a positive integer'),
});
