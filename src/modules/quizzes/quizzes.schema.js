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

export const quizQuestionSchema = z.object({
  questionText: z.string().min(1),
  type: z.enum(['MULTIPLE_CHOICE', 'TRUE_FALSE']).optional(),
  options: z.array(z.string()).min(2),
  correctAnswerIndex: z.number().int().min(0),
  orderIndex: z.number().int().min(0)
}).superRefine((data, ctx) => {
  if (data.type === 'TRUE_FALSE' && data.options.length !== 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'TRUE_FALSE questions must have exactly 2 options',
      path: ['options']
    });
  }
  if (data.correctAnswerIndex >= data.options.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'correctAnswerIndex must be within options bounds',
      path: ['correctAnswerIndex']
    });
  }
});

export const batchCreateQuestionsSchema = z.object({
  questions: z.array(quizQuestionSchema).min(1)
});

export const updateQuestionSchema = z.object({
  questionText: z.string().min(1).optional(),
  type: z.enum(['MULTIPLE_CHOICE', 'TRUE_FALSE']).optional(),
  options: z.array(z.string()).min(2).optional(),
  correctAnswerIndex: z.number().int().min(0).optional(),
  orderIndex: z.number().int().min(0).optional()
}).superRefine((data, ctx) => {
  // If options and correctAnswerIndex are provided, validate bounds
  if (data.options && data.correctAnswerIndex !== undefined) {
    if (data.type === 'TRUE_FALSE' && data.options.length !== 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'TRUE_FALSE questions must have exactly 2 options',
        path: ['options']
      });
    }
    if (data.correctAnswerIndex >= data.options.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'correctAnswerIndex must be within options bounds',
        path: ['correctAnswerIndex']
      });
    }
  }
});

export const questionIdParamSchema = z.object({
  id: z.string().uuid(),
  questionId: z.string().uuid()
});

export const submitQuizSchema = z.object({
  answers: z.array(z.object({
    questionId: z.string().uuid(),
    selectedIndex: z.number().int().min(0)
  }))
});
