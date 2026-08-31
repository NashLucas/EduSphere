import { z } from 'zod';
import { EnrollmentStatus } from '@prisma/client';

export const enrollSchema = z.object({
  courseId: z.string().uuid(),
});

export const listEnrollmentsQuerySchema = z.object({
  status: z.nativeEnum(EnrollmentStatus).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
});
