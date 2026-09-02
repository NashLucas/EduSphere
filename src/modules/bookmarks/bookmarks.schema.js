import { z } from 'zod';

export const toggleBookmarkSchema = {
  body: z.object({
    courseId: z.string().uuid().optional(),
    lessonId: z.string().uuid().optional(),
  }).refine((data) => {
    const hasCourseId = !!data.courseId;
    const hasLessonId = !!data.lessonId;
    return (hasCourseId && !hasLessonId) || (!hasCourseId && hasLessonId);
  }, {
    message: 'Exactly one of courseId or lessonId must be provided',
  }),
};
