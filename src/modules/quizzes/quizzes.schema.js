import { z } from 'zod';

export const createQuizSchema = z.object({
  courseId: z.string().uuid(),
  lessonId: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(255),
  passingScore: z.number().int().min(0).max(100).optional(),
  maxAttempts: z.number().int().min(1).optional().nullable()
});

export const updateQuizSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  passingScore: z.number().int().min(0).max(100).optional(),
  maxAttempts: z.number().int().min(1).optional().nullable()
});

export const quizIdParamSchema = z.object({
  id: z.string().uuid()
});
