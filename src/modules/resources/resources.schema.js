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
  fileKey: z.string().min(1),
  title: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  category: z.string().min(1).max(50),
  courseId: z.string().uuid().optional(),
});
