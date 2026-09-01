import prisma from '../../database/index.js';

/**
 * Creates an instructor profile for a user.
 * Called automatically during registration or admin elevation for users with the INSTRUCTOR role.
 *
 * @param {string} userId - The UUID of the user
 * @param {object} [tx] - Optional Prisma transaction client
 * @returns {Promise<object>} The created instructor profile
 */
export const createInstructorProfile = async (userId, tx = prisma) => {
  return await tx.instructor.create({
    data: {
      userId,
      title: 'Instructor',
    },
  });
};

export const getInstructorDashboard = async (userId) => {
  const instructor = await prisma.instructor.findUnique({
    where: { userId },
    include: {
      courses: {
        select: {
          id: true,
          title: true,
          isPublished: true,
          studentCount: true,
          reviewCount: true
        }
      }
    }
  });

  if (!instructor) {
    const { NotFoundError } = await import('../../utils/app-error.js');
    throw new NotFoundError('Instructor profile not found');
  }

  const publishedCourses = instructor.courses.filter(c => c.isPublished);
  const totalReviews = instructor.courses.reduce((acc, curr) => acc + curr.reviewCount, 0);

  // Enrollment trend for the last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const enrollments = await prisma.enrollment.findMany({
    where: {
      course: { instructorId: instructor.id },
      createdAt: { gte: thirtyDaysAgo }
    },
    select: { createdAt: true },
    orderBy: { createdAt: 'asc' }
  });

  const trendMap = {};
  enrollments.forEach(e => {
    const date = e.createdAt.toISOString().split('T')[0];
    trendMap[date] = (trendMap[date] || 0) + 1;
  });
  
  const enrollmentTrend = Object.keys(trendMap).map(date => ({
    date,
    count: trendMap[date]
  }));

  let topCourse = null;
  if (instructor.courses.length > 0) {
    topCourse = [...instructor.courses].sort((a, b) => b.studentCount - a.studentCount)[0];
  }

  const recentEnrollments = await prisma.enrollment.findMany({
    where: { course: { instructorId: instructor.id } },
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: {
      user: { select: { fullName: true, avatarUrl: true } },
      course: { select: { title: true } }
    }
  });

  return {
    overview: {
      publishedCourseCount: publishedCourses.length,
      totalLifetimeStudents: instructor.studentCount,
      averageRating: instructor.rating,
      totalReviews
    },
    enrollmentTrend,
    topCourse,
    recentEnrollments: recentEnrollments.map(e => ({
      studentName: e.user.fullName,
      studentAvatar: e.user.avatarUrl,
      courseTitle: e.course.title,
      enrolledAt: e.createdAt
    }))
  };
};

export const getInstructorCourses = async (userId, sort = 'createdAt') => {
  const instructor = await prisma.instructor.findUnique({
    where: { userId }
  });

  if (!instructor) {
    const { NotFoundError } = await import('../../utils/app-error.js');
    throw new NotFoundError('Instructor profile not found');
  }

  const validSorts = {
    createdAt: { createdAt: 'desc' },
    studentCount: { studentCount: 'desc' },
    rating: { averageRating: 'desc' }
  };

  const orderBy = validSorts[sort] || validSorts['createdAt'];

  return await prisma.course.findMany({
    where: { instructorId: instructor.id },
    select: {
      id: true,
      title: true,
      slug: true,
      isPublished: true,
      studentCount: true,
      averageRating: true,
      reviewCount: true,
      createdAt: true
    },
    orderBy
  });
};

export const getInstructorProfile = async (id) => {
  const instructor = await prisma.instructor.findUnique({
    where: { id },
    include: {
      user: { select: { fullName: true, bio: true, avatarUrl: true } }
    }
  });

  if (!instructor) {
    const { NotFoundError } = await import('../../utils/app-error.js');
    throw new NotFoundError('Instructor profile not found');
  }

  const publishedCourseCount = await prisma.course.count({
    where: { instructorId: instructor.id, isPublished: true, deletedAt: null }
  });

  const publishedCourses = await prisma.course.findMany({
    where: { instructorId: instructor.id, isPublished: true, deletedAt: null },
    select: {
      id: true,
      title: true,
      slug: true,
      thumbnailUrl: true,
      averageRating: true,
      reviewCount: true,
      studentCount: true
    },
    orderBy: { createdAt: 'desc' },
    take: 10
  });

  return {
    id: instructor.id,
    fullName: instructor.user.fullName,
    bio: instructor.user.bio,
    avatarUrl: instructor.user.avatarUrl,
    rating: instructor.rating,
    studentCount: instructor.studentCount,
    publishedCourseCount,
    publishedCourses
  };
};
