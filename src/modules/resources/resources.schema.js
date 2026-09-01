import { z } from 'zod';

export const uploadUrlSchema = z.object({
  fileName: z.string().min(1),
  fileType: z.string().regex(/^(video\/.*|image\/.*|application\/(pdf|zip))$/),
  fileSize: z.number().int().positive(),
  courseId: z.string().uuid(),
}).superRefine((data, ctx) => {
  const isVideo = data.fileType.startsWith('video/');
  const maxSize = isVideo ? 500 * 1024 * 1024 : 25 * 1024 * 1024;
  if (data.fileSize > maxSize) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `File size exceeds maximum allowed (${isVideo ? '500MB' : '25MB'})`,
      path: ['fileSize'],
    });
  }
});

export const confirmUploadSchema = z.object({
  fileKey: z.string().startsWith('staging/'),
  title: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  category: z.string().min(1).max(50),
  courseId: z.string().uuid().optional(),
});

export const getResourcesSchema = z.object({
  category: z.string().optional(),
  courseId: z.string().uuid().optional(),
  page: z.string().regex(/^\d+$/).transform(Number).optional().default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).optional().default('10')
});

export const createResourceSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  category: z.string().min(1).max(50),
  fileType: z.string().min(1).max(100),
  fileUrl: z.string().url(),
  fileSize: z.number().int().nonnegative().optional().default(0),
  courseId: z.string().uuid().optional(),
});
