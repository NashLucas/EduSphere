import prisma from '../../database/index.js';
import { NotFoundError, ForbiddenError, UnprocessableEntityError } from '../../utils/app-error.js';
import { getJSON, setWithTTL, deleteByPattern, keys, TTL } from '../../utils/cache-keys.js';

export const getCourses = async (filters, pagination) => {
  const { page, limit, sort } = pagination;
  
  const cacheKey = keys.cache('courses', { ...filters, page, limit, sort });
  try {
    const cached = await getJSON(cacheKey);
    if (cached) return cached;
  } catch (err) {
    // Fail open: a Redis error falls through to PostgreSQL
  }

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

  const result = { courses, totalItems };
  
  try {
    await setWithTTL(cacheKey, result, TTL.courseList);
  } catch (err) {
    // Fail open on write
  }

  return result;
};

export const getFeaturedCourses = async () => {
  const cacheKey = keys.cache('courses', { featured: true });
  try {
    const cached = await getJSON(cacheKey);
    if (cached) return cached;
  } catch (err) {
    // Fail open
  }

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

  try {
    await setWithTTL(cacheKey, courses, TTL.courseList);
  } catch (err) {
    // Fail open
  }
  return courses;
};

export const getCourseBySlug = async (slug, user) => {
  const cacheKey = keys.cache('course', slug);
  let course;

  try {
    const cached = await getJSON(cacheKey);
    if (cached) course = cached;
  } catch (err) {
    // Fail open
  }

  if (!course) {
    course = await prisma.course.findFirst({
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

    try {
      await setWithTTL(cacheKey, course, TTL.courseDetail);
    } catch (err) {
      // Fail open
    }
  }

  // Strip content for non-preview lessons
  course.modules = course.modules.map(mod => ({
    ...mod,
    lessons: mod.lessons.map(lesson => {
      // If user is admin or course owner, don't strip
      if (user && (user.role === 'ADMIN' || course.instructor.userId === user.id)) {
        return lesson;
      }
      
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

  // Calculate nextAccessibleLessonId if user is authenticated and enrolled
  if (user && user.role !== 'ADMIN' && course.instructor.userId !== user.id) {
    const enrollment = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId: user.id, courseId: course.id } }
    });

    if (enrollment && enrollment.status === 'ACTIVE') {
      const { calculateNextAccessibleLessonId } = await import('../lessons/lessons.service.js');
      const { nextAccessibleLessonId } = await calculateNextAccessibleLessonId(course.id, user.id, enrollment.id);
      course.nextAccessibleLessonId = nextAccessibleLessonId;
    }
  }

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

export const verifyCourseOwnership = async (courseId, userId, userRole = null) => {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: { instructor: true },
  });
  if (!course || course.deletedAt) throw NotFoundError('Course not found');

  if (userRole !== 'ADMIN' && course.instructor.userId !== userId) {
    throw ForbiddenError('Not authorized to manage this course');
  }

  return course;
};

export const updateCourse = async (userId, userRole, courseId, data) => {
  const course = await verifyCourseOwnership(courseId, userId, userRole);

  const { isPublished, price, title, description, level, subjectId, requirements, objectives } = data;
  let updateData = {};
  
  // Note: We intentionally do NOT regenerate the slug when the title is updated 
  // to maintain stable URLs (GET /courses/:slug) for SEO and existing bookmarks.
  if (title !== undefined) updateData.title = title;
  if (description !== undefined) updateData.description = description;
  if (level !== undefined) updateData.level = level;
  if (subjectId !== undefined) updateData.subjectId = subjectId;
  if (price !== undefined) updateData.price = parseFloat(price);
  if (requirements !== undefined) updateData.requirements = requirements;
  if (objectives !== undefined) updateData.objectives = objectives;

  // Publishing transition guard inside transaction to prevent race conditions
  if (isPublished !== undefined) {
    return await prisma.$transaction(async (tx) => {
      const fresh = await tx.course.findUnique({ where: { id: courseId } });
      
      let transition = null;
      if (isPublished && !fresh.isPublished) {
        transition = 'to_true';
        const modules = await tx.module.findMany({
          where: { courseId },
          include: { lessons: true }
        });
        if (modules.length === 0 || !modules.some(m => m.lessons.length > 0)) {
          throw UnprocessableEntityError('Publish attempted with zero live modules or zero live lessons');
        }
        updateData.isPublished = true;
        if (!fresh.publishedAt) {
          updateData.publishedAt = new Date();
        }
      } else if (!isPublished && fresh.isPublished) {
        transition = 'to_false';
        updateData.isPublished = false;
      }
      
      if (Object.keys(updateData).length === 0) return fresh;

      const updated = await tx.course.update({
        where: { id: courseId },
        data: updateData
      });

      if (transition === 'to_true') {
        await tx.subject.update({
          where: { id: fresh.subjectId },
          data: { courseCount: { increment: 1 } }
        });
        await deleteByPattern('cache:courses:*');
      } else if (transition === 'to_false') {
        const subject = await tx.subject.findUnique({ where: { id: fresh.subjectId } });
        if (subject && subject.courseCount > 0) {
          await tx.subject.update({
            where: { id: fresh.subjectId },
            data: { courseCount: { decrement: 1 } }
          });
        }
        await deleteByPattern('cache:courses:*');
      }

      if (transition) {
        await deleteByPattern('cache:courses:*');
      }
      await deleteByPattern(`cache:course:${fresh.slug}`);
      return updated;
    });
  }

  if (Object.keys(updateData).length > 0) {
    const updated = await prisma.course.update({
      where: { id: courseId },
      data: updateData
    });
    // Invalidate list if price or details change (some show up in list)
    await deleteByPattern('cache:courses:*');
    await deleteByPattern(`cache:course:${course.slug}`);
    return updated;
  }
  return course;
};

export const deleteCourse = async (userId, userRole, courseId) => {
  const course = await verifyCourseOwnership(courseId, userId, userRole);

  await prisma.$transaction(async (tx) => {
    const fresh = await tx.course.findUnique({ where: { id: courseId } });
    if (!fresh || fresh.deletedAt) return;

    await tx.course.update({
      where: { id: courseId },
      data: { deletedAt: new Date(), isPublished: false }
    });

    if (fresh.isPublished) {
      const subject = await tx.subject.findUnique({ where: { id: fresh.subjectId } });
      if (subject && subject.courseCount > 0) {
        await tx.subject.update({
          where: { id: fresh.subjectId },
          data: { courseCount: { decrement: 1 } }
        });
      }
    }
    
    await deleteByPattern('cache:courses:*');
    await deleteByPattern(`cache:course:${fresh.slug}`);
  });
};

