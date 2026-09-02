import prisma from '../../database/index.js';
import { NotFoundError } from '../../utils/app-error.js';
import { deleteByPattern } from '../../utils/cache-keys.js';
import { sendTakedownNotice } from '../../integrations/email/index.js';
import { createNotification } from '../notifications/notifications.service.js';

export const getCourses = async (filters, pagination) => {
  const { page, limit, sort } = pagination;
  const skip = (page - 1) * limit;

  // By default (if deleted is omitted), we return both live and soft-deleted.
  const where = {};

  if (filters.isPublished !== undefined) {
    where.isPublished = filters.isPublished;
  }

  if (filters.deleted !== undefined) {
    if (filters.deleted === true) {
      where.deletedAt = { not: null };
    } else {
      where.deletedAt = null;
    }
  }

  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search, mode: 'insensitive' } },
      { description: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  let orderBy = { createdAt: 'desc' };
  if (sort === 'popular') orderBy = { studentCount: 'desc' };
  else if (sort === 'rating') orderBy = { rating: 'desc' };
  else if (sort === 'price-low') orderBy = { price: 'asc' };
  else if (sort === 'price-high') orderBy = { price: 'desc' };

  const [courses, totalItems] = await prisma.$transaction([
    prisma.course.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include: {
        instructor: {
          select: {
            id: true,
            title: true,
            rating: true,
            user: { select: { fullName: true, email: true } },
          },
        },
      },
    }),
    prisma.course.count({ where }),
  ]);

  return { courses, totalItems };
};

export const unpublishCourse = async (courseId, reason, adminId) => {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      instructor: {
        include: { user: true }
      }
    }
  });

  if (!course) {
    throw NotFoundError('Course not found');
  }

  if (!course.isPublished) {
    // If it's already unpublished, just return it. TRD says second unpublish decrements nothing.
    return course;
  }

  const updatedCourse = await prisma.$transaction(async (tx) => {
    // 1. Mark as unpublished
    const updated = await tx.course.update({
      where: { id: courseId },
      data: { isPublished: false }
    });

    // 2. Decrement subject.courseCount
    await tx.subject.update({
      where: { id: course.subjectId },
      data: { courseCount: { decrement: 1 } }
    });

    // 3. Write AuditLog
    await tx.auditLog.create({
      data: {
        adminId,
        actionType: 'COURSE_REJECTED',
        targetType: 'COURSE',
        targetId: courseId,
        reason
      }
    });

    return updated;
  });

  // 4. Invalidate catalog cache
  // "SCAN + UNLINK" is implemented inside deleteByPattern
  await deleteByPattern('cache:courses:*');
  await deleteByPattern(`cache:course:${course.slug}`);

  // 5. Notify the instructor
  sendTakedownNotice({
    to: course.instructor.user.email,
    fullName: course.instructor.user.fullName,
    courseTitle: course.title,
    reason,
  }).catch(() => {});

  return updatedCourse;
};

export const republishCourse = async (courseId, reason, adminId) => {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      instructor: {
        include: { user: true }
      }
    }
  });

  if (!course) {
    throw NotFoundError('Course not found');
  }

  if (course.isPublished) {
    // If it's already published, just return it. TRD says second republish increments nothing.
    return course;
  }

  const updatedCourse = await prisma.$transaction(async (tx) => {
    // 1. Mark as published
    const updated = await tx.course.update({
      where: { id: courseId },
      data: { isPublished: true }
    });

    // 2. Increment subject.courseCount
    await tx.subject.update({
      where: { id: course.subjectId },
      data: { courseCount: { increment: 1 } }
    });

    // 3. Write AuditLog
    await tx.auditLog.create({
      data: {
        adminId,
        actionType: 'COURSE_REPUBLISHED',
        targetType: 'COURSE',
        targetId: courseId,
        reason
      }
    });

    // 4. Notify
    await createNotification(
      course.instructor.userId,
      'SYSTEM',
      'Course Republished',
      `Your course "${course.title}" has been republished by an administrator. Reason: ${reason}`,
      tx
    );

    return updated;
  });

  // 5. Invalidate catalog cache
  await deleteByPattern('cache:courses:*');
  await deleteByPattern(`cache:course:${course.slug}`);

  return updatedCourse;
};
