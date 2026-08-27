import { z } from 'zod';
import { paginationSchema } from '../../middlewares/validate.middleware.js';

export const createSubjectSchema = z.object({
  name: z.string().min(2).max(100),
  icon: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color code'),
}).strict();

export const updateSubjectSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  icon: z.string().min(1).max(50).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color code').optional(),
}).strict();

// Validates the uuid for PUT and DELETE
export const subjectIdParamSchema = z.object({
  id: z.string().uuid(),
}).strict();

// Validates the slug for GET /subjects/:slug/courses
export const subjectSlugParamSchema = z.object({
  slug: z.string().min(1).max(100),
}).strict();

export const getSubjectsCoursesQuerySchema = paginationSchema.extend({
  sort: z.enum(['newest', 'popular', 'rating', 'price-low', 'price-high']).optional(),
}).strict();
