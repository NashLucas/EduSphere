import { z } from 'zod';

export const createLessonSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title is too long'),
  type: z.enum(['VIDEO', 'TEXT', 'CODE', 'QUIZ']),
  content: z.string().min(1, 'Content is required'),
  videoUrl: z.string().url('Invalid URL').optional().nullable(),
  codeSnippet: z.string().optional().nullable(),
  durationMinutes: z.number().int().min(0).default(0),
  orderIndex: z.number().int().min(0),
  isFreePreview: z.boolean().default(false),
});

export const updateLessonSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  type: z.enum(['VIDEO', 'TEXT', 'CODE', 'QUIZ']).optional(),
  content: z.string().min(1).optional(),
  videoUrl: z.string().url('Invalid URL').optional().nullable(),
  codeSnippet: z.string().optional().nullable(),
  durationMinutes: z.number().int().min(0).optional(),
  orderIndex: z.number().int().min(0).optional(),
  isFreePreview: z.boolean().optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update'
});

export const lessonIdParamSchema = z.object({
  id: z.string().uuid('Invalid lesson ID'),
});

export const moduleIdParamSchema = z.object({
  moduleId: z.string().uuid('Invalid module ID'),
});
