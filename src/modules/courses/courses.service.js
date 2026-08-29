import prisma from '../../database/index.js';
import { NotFoundError, ForbiddenError, UnprocessableEntityError } from '../../utils/app-error.js';
import { getJSON, setWithTTL, deleteByPattern } from '../../utils/cache-keys.js';

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
        // Strip sensitive fields without mutating the Prisma result.
        // We cannot use an explicit Prisma `select` here (like we do for Quiz answers)
        // because Prisma does not support conditional selection based on a sibling 
        // field's value (isFreePreview). We must fetch all fields and omit them in memory.
        // eslint-disable-next-line no-unused-vars
        const { content, videoUrl, codeSnippet, ...rest } = lesson;
        return rest;
      }
      return lesson;
    }),
  }));

  return course;
};

const slugify = (text) => text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const getInstructorId = async (userId) => {
  const profile = await prisma.instructor.findUnique({ where: { userId } });
  if (!profile) throw ForbiddenError('Instructor profile required to author courses');
  return profile.id;
};

export const createCourse = async (userId, data) => {
  const instructorId = await getInstructorId(userId);

  const baseSlug = slugify(data.title);
  let slug = baseSlug;
  let counter = 1;
  while (await prisma.course.findFirst({ where: { slug, deletedAt: null } })) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  const subject = await prisma.subject.findUnique({ where: { id: data.subjectId } });
  if (!subject) throw NotFoundError('Subject not found');

  return prisma.course.create({
    data: {
      ...data,
      price: parseFloat(data.price),
      slug,
      instructorId,
      isPublished: false,
    },
  });
};

export const updateCourse = async (userId, userRole, courseId, data) => {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: { instructor: true },
  });
  if (!course || course.deletedAt) throw NotFoundError('Course not found');

  if (userRole !== 'ADMIN' && course.instructor.userId !== userId) {
    throw ForbiddenError('Not authorized to update this course');
  }

  const { isPublished, price, title, description, level, subjectId, requirements, objectives } = data;
  let updateData = {};
  if (title) updateData.title = title;
  if (description) updateData.description = description;
  if (level) updateData.level = level;
  if (subjectId) updateData.subjectId = subjectId;
  if (price !== undefined) updateData.price = parseFloat(price);
  if (requirements !== undefined) updateData.requirements = requirements;
  if (objectives !== undefined) updateData.objectives = objectives;

  // Publishing transition guard
  if (isPublished !== undefined && isPublished !== course.isPublished) {
    if (isPublished) {
      // Transitioning to true
      const modules = await prisma.module.findMany({
        where: { courseId },
        include: { lessons: true }
      });
      if (modules.length === 0 || !modules.some(m => m.lessons.length > 0)) {
        throw UnprocessableEntityError('Publish attempted with zero live modules or zero live lessons');
      }
      
      updateData.isPublished = true;
      if (!course.publishedAt) {
        updateData.publishedAt = new Date();
      }
      
      return await prisma.$transaction(async (tx) => {
        const updated = await tx.course.update({
          where: { id: courseId },
          data: updateData
        });
        await tx.subject.update({
          where: { id: course.subjectId },
          data: { courseCount: { increment: 1 } }
        });
        await deleteByPattern('cache:courses:*');
        return updated;
      });
    } else {
      // Transitioning to false
      updateData.isPublished = false;
      return await prisma.$transaction(async (tx) => {
        const updated = await tx.course.update({
          where: { id: courseId },
          data: updateData
        });
        await tx.subject.update({
          where: { id: course.subjectId },
          data: { courseCount: { decrement: 1 } }
        });
        await deleteByPattern('cache:courses:*');
        return updated;
      });
    }
  }

  if (Object.keys(updateData).length > 0) {
    return prisma.course.update({
      where: { id: courseId },
      data: updateData
    });
  }
  return course;
};

export const deleteCourse = async (userId, userRole, courseId) => {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: { instructor: true },
  });
  if (!course || course.deletedAt) throw NotFoundError('Course not found');

  if (userRole !== 'ADMIN' && course.instructor.userId !== userId) {
    throw ForbiddenError('Not authorized to delete this course');
  }

  if (course.isPublished) {
    await prisma.$transaction(async (tx) => {
      await tx.course.update({
        where: { id: courseId },
        data: { deletedAt: new Date(), isPublished: false }
      });
      await tx.subject.update({
        where: { id: course.subjectId },
        data: { courseCount: { decrement: 1 } }
      });
      await deleteByPattern('cache:courses:*');
    });
  } else {
    await prisma.course.update({
      where: { id: courseId },
      data: { deletedAt: new Date() }
    });
  }
};

