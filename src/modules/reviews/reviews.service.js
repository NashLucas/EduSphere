import prisma from '../../database/index.js';
import { NotFoundError, ForbiddenError, ConflictError } from '../../utils/app-error.js';
import { AuditActionType, AuditTargetType } from '@prisma/client';

const recalculateRatings = async (tx, courseId) => {
  const course = await tx.course.findUnique({
    where: { id: courseId },
    select: { instructorId: true }
  });

  if (!course) return;

  const reviewStats = await tx.review.aggregate({
    where: { courseId },
    _avg: { rating: true },
    _count: { id: true }
  });

  const newCourseRating = reviewStats._avg.rating || 0;
  const newReviewCount = reviewStats._count.id;

  await tx.course.update({
    where: { id: courseId },
    data: {
      averageRating: newCourseRating,
      reviewCount: newReviewCount
    }
  });

  const instructorCourses = await tx.course.findMany({
    where: { instructorId: course.instructorId, isPublished: true, deletedAt: null },
    select: { averageRating: true, studentCount: true }
  });

  let totalWeightedRating = 0;
  let totalStudents = 0;

  instructorCourses.forEach(c => {
    totalWeightedRating += c.averageRating * c.studentCount;
    totalStudents += c.studentCount;
  });

  const newInstructorRating = totalStudents > 0 ? totalWeightedRating / totalStudents : 0;

  await tx.instructor.update({
    where: { id: course.instructorId },
    data: { rating: newInstructorRating }
  });
};

export const createReview = async (userId, courseId, data) => {
  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId } }
  });

  if (!enrollment) {
    throw ForbiddenError('You must be enrolled in the course to leave a review.');
  }

  const existingReview = await prisma.review.findUnique({
    where: { userId_courseId: { userId, courseId } }
  });

  if (existingReview) {
    throw ConflictError('You have already reviewed this course.');
  }

  return await prisma.$transaction(async (tx) => {
    const review = await tx.review.create({
      data: {
        userId,
        courseId,
        rating: data.rating,
        comment: data.comment
      }
    });

    await recalculateRatings(tx, courseId);
    return review;
  });
};

export const listCourseReviews = async (courseId, { page = 1, limit = 10 }) => {
  const skip = (page - 1) * limit;

  const [items, totalItems] = await Promise.all([
    prisma.review.findMany({
      where: { courseId },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { fullName: true, avatarUrl: true } }
      }
    }),
    prisma.review.count({ where: { courseId } })
  ]);

  return { items, meta: { page, limit, totalItems } };
};

export const updateReview = async (userId, reviewId, data) => {
  const review = await prisma.review.findUnique({
    where: { id: reviewId }
  });

  if (!review) throw NotFoundError('Review not found');
  if (review.userId !== userId) throw ForbiddenError('You can only update your own review');

  return await prisma.$transaction(async (tx) => {
    const updated = await tx.review.update({
      where: { id: reviewId },
      data: {
        rating: data.rating !== undefined ? data.rating : review.rating,
        comment: data.comment !== undefined ? data.comment : review.comment,
      }
    });

    await recalculateRatings(tx, review.courseId);
    return updated;
  });
};

export const deleteReview = async (userId, reviewId, role) => {
  const review = await prisma.review.findUnique({
    where: { id: reviewId }
  });

  if (!review) throw NotFoundError('Review not found');

  if (review.userId !== userId && role !== 'ADMIN') {
    throw ForbiddenError('You do not have permission to delete this review');
  }

  return await prisma.$transaction(async (tx) => {
    await tx.review.delete({
      where: { id: reviewId }
    });

    if (role === 'ADMIN' && review.userId !== userId) {
      await tx.auditLog.create({
        data: {
          adminId: userId,
          actionType: AuditActionType.REVIEW_DELETED,
          targetType: AuditTargetType.REVIEW,
          targetId: reviewId,
          metadata: { authorId: review.userId, courseId: review.courseId }
        }
      });
    }

    await recalculateRatings(tx, review.courseId);
  });
};
