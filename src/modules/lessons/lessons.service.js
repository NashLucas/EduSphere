import prisma from '../../database/index.js';
import { NotFoundError } from '../../utils/app-error.js';
import { verifyCourseOwnership } from '../courses/courses.service.js';

// Helper to recalculate progress for all ACTIVE enrollments
const recalculateProgressForCourse = async (tx, courseId) => {
  const totalLessons = await tx.lesson.count({
    where: { module: { courseId } },
  });

  await tx.$executeRaw`
    UPDATE enrollments
    SET progress_percent = CASE
      WHEN ${totalLessons}::int = 0 THEN 0.0
      ELSE (
        SELECT COUNT(*) 
        FROM lesson_progress lp 
        WHERE lp.enrollment_id = enrollments.id AND lp.is_completed = true
      )::float / ${totalLessons}::float * 100.0
    END
    WHERE course_id = ${courseId}::uuid AND status = 'ACTIVE';
  `;
};

export const createLesson = async (userId, userRole, moduleId, data) => {
  const mod = await prisma.module.findUnique({ where: { id: moduleId } });
  if (!mod) throw NotFoundError('Module not found');

  await verifyCourseOwnership(mod.courseId, userId, userRole);

  return await prisma.$transaction(async (tx) => {
    // 1. Create the lesson
    const lesson = await tx.lesson.create({
      data: {
        ...data,
        moduleId,
      },
    });

    // 2. Increment Course duration
    if (data.durationMinutes) {
      await tx.course.update({
        where: { id: mod.courseId },
        data: { durationMinutes: { increment: data.durationMinutes } },
      });
    }

    // 3. Recalculate progress for ACTIVE enrollments
    await recalculateProgressForCourse(tx, mod.courseId);

    return lesson;
  });
};

export const getLesson = async (lessonId) => {
  // Access resolution is supposed to be in Task 5.3, but for basic 5.2 we just return the lesson
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
  });
  if (!lesson) throw NotFoundError('Lesson not found');
  
  return lesson;
};

export const updateLesson = async (userId, userRole, lessonId, data) => {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: { module: true },
  });
  if (!lesson) throw NotFoundError('Lesson not found');

  await verifyCourseOwnership(lesson.module.courseId, userId, userRole);

  return await prisma.$transaction(async (tx) => {
    // 1. Update the lesson
    const updatedLesson = await tx.lesson.update({
      where: { id: lessonId },
      data,
    });

    // 2. Adjust Course duration if duration changed
    if (data.durationMinutes !== undefined && data.durationMinutes !== lesson.durationMinutes) {
      const delta = data.durationMinutes - lesson.durationMinutes;
      await tx.course.update({
        where: { id: lesson.module.courseId },
        data: { durationMinutes: { increment: delta } },
      });
    }

    return updatedLesson;
  });
};

export const deleteLesson = async (userId, userRole, lessonId) => {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: { module: true },
  });
  if (!lesson) throw NotFoundError('Lesson not found');

  const courseId = lesson.module.courseId;
  await verifyCourseOwnership(courseId, userId, userRole);

  return await prisma.$transaction(async (tx) => {
    // 1. Decrement Course duration
    if (lesson.durationMinutes > 0) {
      await tx.course.update({
        where: { id: courseId },
        data: { durationMinutes: { decrement: lesson.durationMinutes } },
      });
    }

    // 2. Delete the lesson
    const deletedLesson = await tx.lesson.delete({
      where: { id: lessonId },
    });

    // 3. Recalculate progress for ACTIVE enrollments
    await recalculateProgressForCourse(tx, courseId);

    return deletedLesson;
  });
};
