import prisma from '../../database/index.js';
import { NotFoundError, ConflictError } from '../../utils/app-error.js';
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

export const softDeleteCourse = async (courseId, reason, adminId) => {
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

  if (course.deletedAt) {
    return course; // Already deleted
  }

  const updatedCourse = await prisma.$transaction(async (tx) => {
    // 1. Mark as deleted AND unpublished
    const updated = await tx.course.update({
      where: { id: courseId },
      data: { 
        deletedAt: new Date(),
        isPublished: false 
      }
    });

    // 2. Decrement subject.courseCount IF it was published
    if (course.isPublished) {
      await tx.subject.update({
        where: { id: course.subjectId },
        data: { courseCount: { decrement: 1 } }
      });
    }

    // 3. Write AuditLog
    await tx.auditLog.create({
      data: {
        adminId,
        actionType: 'COURSE_DELETED',
        targetType: 'COURSE',
        targetId: courseId,
        reason
      }
    });

    // 4. Notify
    await createNotification(
      course.instructor.userId,
      'SYSTEM',
      'Course Deleted',
      `Your course "${course.title}" has been deleted by an administrator. Reason: ${reason}`,
      tx
    );

    return updated;
  });

  // 5. Invalidate catalog cache
  await deleteByPattern('cache:courses:*');
  await deleteByPattern(`cache:course:${course.slug}`);

  return updatedCourse;
};
export const restoreCourse = async (courseId, reason, adminId) => {
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

  if (!course.deletedAt) {
    return course; // Already not deleted
  }

  const updatedCourse = await prisma.$transaction(async (tx) => {
    // 1. Mark as restored (clear deletedAt). Do NOT republish!
    const updated = await tx.course.update({
      where: { id: courseId },
      data: { deletedAt: null }
    });

    // 2. Write AuditLog
    await tx.auditLog.create({
      data: {
        adminId,
        actionType: 'COURSE_RESTORED',
        targetType: 'COURSE',
        targetId: courseId,
        reason
      }
    });

    // 3. Notify
    await createNotification(
      course.instructor.userId,
      'SYSTEM',
      'Course Restored',
      `Your course "${course.title}" has been restored by an administrator. It is currently unpublished (in draft). Reason: ${reason}`,
      tx
    );

    return updated;
  });

  // 4. Invalidate catalog cache
  await deleteByPattern('cache:courses:*');
  await deleteByPattern(`cache:course:${course.slug}`);

  return updatedCourse;
};

export const getUsers = async (filters, pagination) => {
  const { page, limit, sort } = pagination;
  const skip = (page - 1) * limit;

  const where = {};

  if (filters.role) {
    where.role = filters.role;
  }

  if (filters.isBanned !== undefined) {
    where.isBanned = filters.isBanned;
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
      { fullName: { contains: filters.search, mode: 'insensitive' } },
      { email: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  let orderBy = { createdAt: 'desc' };
  if (sort === 'oldest') orderBy = { createdAt: 'asc' };
  else if (sort === 'name') orderBy = { fullName: 'asc' };

  const [users, totalItems] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isBanned: true,
        isEmailVerified: true,
        createdAt: true,
        deletedAt: true
      },
    }),
    prisma.user.count({ where }),
  ]);

  return { users, totalItems };
};

import { createInstructorProfile } from '../instructors/instructors.service.js';
import redis from '../../config/redis.js';
import { userState, TTL } from '../../utils/cache-keys.js';

export const updateUserRole = async (userId, role, force, adminId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      instructorProfile: {
        include: {
          courses: {
            where: { isPublished: true, deletedAt: null }
          }
        }
      }
    }
  });

  if (!user) {
    throw NotFoundError('User not found');
  }

  if (user.role === role) {
    return user;
  }

  // 13.8: Demotion conflict
  if (user.role === 'INSTRUCTOR' && role !== 'INSTRUCTOR') {
    if (user.instructorProfile && user.instructorProfile.courses.length > 0) {
      if (!force) {
        // We must throw a 409 Conflict. Wait, I should import ConflictError from app-error.js!
        // But for now I'll just throw it. I will fix the import later if it's missing.
        throw ConflictError('User owns published courses');
      }
    }
  }

  const updatedUser = await prisma.$transaction(async (tx) => {
    // Unpublish courses if forced
    if (user.role === 'INSTRUCTOR' && role !== 'INSTRUCTOR' && force && user.instructorProfile && user.instructorProfile.courses.length > 0) {
      for (const course of user.instructorProfile.courses) {
        await tx.course.update({
          where: { id: course.id },
          data: { isPublished: false }
        });
        await tx.subject.update({
          where: { id: course.subjectId },
          data: { courseCount: { decrement: 1 } }
        });
        await tx.auditLog.create({
          data: {
            adminId,
            actionType: 'COURSE_REJECTED',
            targetType: 'COURSE',
            targetId: course.id,
            reason: 'Instructor demoted'
          }
        });
      }
    }

    const updated = await tx.user.update({
      where: { id: userId },
      data: { role }
    });

    if (role === 'INSTRUCTOR' && !user.instructorProfile) {
      await createInstructorProfile(userId, tx);
    }

    await tx.auditLog.create({
      data: {
        adminId,
        actionType: 'ROLE_CHANGED',
        targetType: 'USER',
        targetId: userId,
        reason: `Role changed from ${user.role} to ${role}`
      }
    });

    await createNotification(
      userId,
      'SYSTEM',
      'Role Updated',
      `Your account role has been updated to ${role}.`,
      tx
    );

    return updated;
  });

  // Write user:state:<id> to Redis
  const statePayload = {
    role: updatedUser.role,
    isBanned: updatedUser.isBanned,
    isEmailVerified: updatedUser.isEmailVerified,
    deletedAt: updatedUser.deletedAt
  };
  await redis.set(userState(userId), JSON.stringify(statePayload), 'EX', TTL.userState);

  // Unpublish cache invalidation if forced
  if (user.role === 'INSTRUCTOR' && role !== 'INSTRUCTOR' && force && user.instructorProfile && user.instructorProfile.courses.length > 0) {
    await deleteByPattern('cache:courses:*');
    for (const course of user.instructorProfile.courses) {
      await deleteByPattern(`cache:course:${course.slug}`);
    }
  }

  return updatedUser;
};
