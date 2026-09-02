import prisma from '../../database/index.js';
import { NotFoundError, ConflictError, UnprocessableEntityError } from '../../utils/app-error.js';
import { createNotification } from '../notifications/notifications.service.js';
import { sendEnrollmentConfirmation } from '../../integrations/email/index.js';

export const enrollInCourse = async (userId, courseId) => {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: { instructor: true }
  });

  if (!course || course.deletedAt || !course.isPublished) {
    throw NotFoundError('Course not found');
  }

  if (course.instructor.userId === userId) {
    throw UnprocessableEntityError('Instructors cannot enroll in their own courses');
  }

  const existing = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId } }
  });

  if (existing) {
    if (existing.status === 'ACTIVE' || existing.status === 'COMPLETED') {
      throw ConflictError('Already enrolled in this course');
    }
    
    // Reactivate if DROPPED
    if (existing.status === 'DROPPED') {
      const reactivated = await prisma.enrollment.update({
        where: { id: existing.id },
        data: { status: 'ACTIVE' }
      });
      await createNotification(
        userId, 
        'ENROLLMENT', 
        'Course Re-enrolled', 
        `You have successfully re-enrolled in ${course.title}.`
      );
      return reactivated;
    }
  }

  // Fetch user for email sending
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, fullName: true }
  });

  // Create new enrollment
  const enrollment = await prisma.$transaction(async (tx) => {
    const enr = await tx.enrollment.create({
      data: {
        userId,
        courseId,
        status: 'ACTIVE',
        progressPercent: 0.0,
      }
    });

    await tx.course.update({
      where: { id: courseId },
      data: { studentCount: { increment: 1 } }
    });

    await tx.instructor.update({
      where: { id: course.instructorId },
      data: { studentCount: { increment: 1 } }
    });

    await createNotification(
      userId,
      'ENROLLMENT',
      'Course Enrolled',
      `You have successfully enrolled in ${course.title}.`,
      tx
    );

    return enr;
  });

  if (user) {
    sendEnrollmentConfirmation({
      to: user.email,
      fullName: user.fullName,
      courseTitle: course.title,
      courseId: course.id,
    }).catch(() => {});
  }

  return enrollment;
};

export const listEnrollments = async (userId, query) => {
  const { status, page, limit } = query;
  
  const where = { userId };
  if (status) {
    where.status = status;
  }

  const [enrollments, total] = await Promise.all([
    prisma.enrollment.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            slug: true,
            subject: {
              select: { id: true, name: true, slug: true }
            },
            instructor: {
              select: {
                id: true,
                user: { select: { fullName: true } }
              }
            }
          }
        }
      }
    }),
    prisma.enrollment.count({ where })
  ]);

  return {
    data: enrollments,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }
  };
};

export const getProgressDetail = async (userId, courseId) => {
  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId } }
  });

  if (!enrollment) {
    throw NotFoundError('Enrollment not found');
  }

  const modules = await prisma.module.findMany({
    where: { courseId },
    orderBy: { orderIndex: 'asc' },
    include: {
      lessons: {
        orderBy: { orderIndex: 'asc' },
        select: {
          id: true,
          title: true,
          type: true,
          orderIndex: true,
          quiz: {
            select: { id: true, maxAttempts: true }
          }
        }
      }
    }
  });

  const lessonProgresses = await prisma.lessonProgress.findMany({
    where: { enrollmentId: enrollment.id },
  });

  const progressMap = new Map(lessonProgresses.map(p => [p.lessonId, p]));

  // Quiz attempts map to check max attempts exhaustion
  const quizAttempts = await prisma.quizAttempt.groupBy({
    by: ['quizId'],
    where: { userId, quiz: { lesson: { module: { courseId } } } },
    _count: { _all: true }
  });
  const attemptsMap = new Map(quizAttempts.map(q => [q.quizId, q._count._all]));

  let nextAccessibleLessonId = null;
  let foundLocked = false;

  const result = modules.map(mod => {
    return {
      id: mod.id,
      title: mod.title,
      orderIndex: mod.orderIndex,
      lessons: mod.lessons.map(lesson => {
        const progress = progressMap.get(lesson.id);
        const isCompleted = progress?.isCompleted || false;
        const completedAt = progress?.isCompleted ? progress.updatedAt : null;
        
        let effectivelyCompleted = isCompleted;
        if (!effectivelyCompleted && lesson.type === 'QUIZ' && lesson.quiz?.maxAttempts !== null) {
          const attempts = attemptsMap.get(lesson.quiz.id) || 0;
          if (attempts >= lesson.quiz.maxAttempts) {
            effectivelyCompleted = true; // Exhausted max attempts counts as passed for unlocking
          }
        }

        let isLocked = false;

        if (foundLocked) {
          isLocked = true;
        } else if (!effectivelyCompleted) {
          if (!nextAccessibleLessonId) {
            nextAccessibleLessonId = lesson.id;
            isLocked = false;
          } else {
            isLocked = true;
          }
          foundLocked = true;
        }

        return {
          id: lesson.id,
          title: lesson.title,
          type: lesson.type,
          orderIndex: lesson.orderIndex,
          isCompleted,
          completedAt,
          isLocked
        };
      })
    };
  });

  return { courseId, progressPercent: enrollment.progressPercent, nextAccessibleLessonId, modules: result };
};

export const dropEnrollment = async (userId, courseId) => {
  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId } }
  });

  if (!enrollment) {
    throw NotFoundError('Enrollment not found');
  }

  if (enrollment.status === 'DROPPED') {
    return enrollment; // Idempotent
  }

  // Decrement nothing, preserve progress
  return await prisma.enrollment.update({
    where: { id: enrollment.id },
    data: { status: 'DROPPED' }
  });
};
