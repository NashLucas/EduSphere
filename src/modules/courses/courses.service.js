import prisma from '../../database/index.js';
import { NotFoundError } from '../../utils/app-error.js';
import { getJSON, setWithTTL } from '../../utils/cache-keys.js';

export const getCourses = async (filters, pagination) => {
  const { page, limit, sort } = pagination;
  const skip = (page - 1) * limit;

  // Build where clause
  // "isPublished = true AND deletedAt IS NULL on every guest-facing read"
  const where = {
    isPublished: true,
    deletedAt: null,
  };

  if (filters.subject) where.subjectId = filters.subject;
  if (filters.level && filters.level !== 'ALL_LEVELS') where.level = filters.level;
  if (filters.priceMax) where.price = { lte: parseFloat(filters.priceMax) };
  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search, mode: 'insensitive' } },
      { description: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  // Build orderBy
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
            user: { select: { fullName: true, avatarUrl: true } },
          },
        },
      },
    }),
    prisma.course.count({ where }),
  ]);

  return { courses, totalItems };
};

export const getFeaturedCourses = async () => {
  const cacheKey = 'cache:courses:featured';
  const cached = await getJSON(cacheKey);
  if (cached) return cached;

  const courses = await prisma.course.findMany({
    where: {
      isFeatured: true,
      isPublished: true,
      deletedAt: null,
    },
    take: 10,
    orderBy: { rating: 'desc' },
    include: {
      instructor: {
        select: {
          id: true,
          title: true,
          user: { select: { fullName: true, avatarUrl: true } },
        },
      },
    },
  });

  await setWithTTL(cacheKey, courses, 60 * 60); // 1 hour cache
  return courses;
};

export const getCourseBySlug = async (slug) => {
  const course = await prisma.course.findFirst({
    where: {
      slug,
      isPublished: true,
      deletedAt: null,
    },
    include: {
      subject: {
        select: { id: true, name: true, slug: true, icon: true, color: true },
      },
      instructor: {
        select: {
          id: true,
          title: true,
          rating: true,
          studentCount: true,
          user: { select: { fullName: true, avatarUrl: true, bio: true } },
        },
      },
      modules: {
        orderBy: { orderIndex: 'asc' },
        include: {
          lessons: {
            orderBy: { orderIndex: 'asc' },
          },
        },
      },
    },
  });

  if (!course) {
    throw NotFoundError('Course not found');
  }

  // Strip content for non-preview lessons
  course.modules = course.modules.map(mod => ({
    ...mod,
    lessons: mod.lessons.map(lesson => {
      if (!lesson.isFreePreview) {
        // Strip sensitive fields
        delete lesson.content;
        delete lesson.videoUrl;
        delete lesson.codeSnippet;
      }
      return lesson;
    }),
  }));

  return course;
};
