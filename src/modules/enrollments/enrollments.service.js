import prisma from '../../database/index.js';
import { NotFoundError, ConflictError, UnprocessableEntityError } from '../../utils/app-error.js';
import { createNotification } from '../notifications/notifications.service.js';

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

  // Create new enrollment
  return await prisma.$transaction(async (tx) => {
    const enrollment = await tx.enrollment.create({
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

    return enrollment;
  });
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
