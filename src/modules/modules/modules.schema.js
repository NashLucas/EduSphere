import { z } from 'zod';

export const createModuleSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title is too long'),
  orderIndex: z.number().int().min(0),
});

export const updateModuleSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  orderIndex: z.number().int().min(0).optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update'
});

export const moduleIdParamSchema = z.object({
  id: z.string().uuid('Invalid module ID'),
});

export const courseIdParamSchema = z.object({
  courseId: z.string().uuid('Invalid course ID'),
});
