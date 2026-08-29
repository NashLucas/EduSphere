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

export const courseIdParamSchema = z.object({
  id: z.string().uuid(),
}).strict();

export const createCourseSchema = z.object({
  title: z.string().min(2).max(100),
  subjectId: z.string().uuid(),
  description: z.string().min(10).max(5000),
  level: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'ALL_LEVELS']),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/),
}).strict();

export const updateCourseSchema = z.object({
  title: z.string().min(2).max(100).optional(),
  subjectId: z.string().uuid().optional(),
  description: z.string().min(10).max(5000).optional(),
  level: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'ALL_LEVELS']).optional(),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  isPublished: z.boolean().optional(),
  requirements: z.array(z.string()).optional(),
  objectives: z.array(z.string()).optional(),
}).strict();
