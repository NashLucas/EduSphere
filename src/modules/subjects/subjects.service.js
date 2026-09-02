import prisma from '../../database/index.js';
import { keys, TTL, getJSON, setWithTTL, deleteByPattern } from '../../utils/cache-keys.js';
import { ConflictError, NotFoundError } from '../../utils/app-error.js';

const slugify = (text) => text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function getAllSubjects() {
  const cacheKey = keys.cache('subjects', 'list');
  try {
    const cached = await getJSON(cacheKey);
    if (cached) return cached;
  } catch (err) {
    // Fail open
  }

  const subjects = await prisma.subject.findMany({
    orderBy: { name: 'asc' },
  });

  try {
    await setWithTTL(cacheKey, subjects, TTL.subjectsList);
  } catch (err) {
    // Fail open
  }
  return subjects;
}

export async function getSubjectCourses(slug, { page, limit, sort }) {
  const subject = await prisma.subject.findFirst({
    where: { slug }
  });

  if (!subject) {
    throw NotFoundError('Subject not found');
  }

  const skip = (page - 1) * limit;

  let orderBy = {};
  switch (sort) {
    case 'popular': orderBy = { studentCount: 'desc' }; break;
    case 'rating': orderBy = { rating: 'desc' }; break;
    case 'price-low': orderBy = { price: 'asc' }; break;
    case 'price-high': orderBy = { price: 'desc' }; break;
    case 'newest':
    default:
      orderBy = { createdAt: 'desc' }; break;
  }

  const where = {
    subjectId: subject.id,
    isPublished: true,
    deletedAt: null
  };

  const [courses, totalItems] = await Promise.all([
    prisma.course.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      select: {
        id: true,
        title: true,
        slug: true,
        level: true,
        price: true,
        rating: true,
        reviewCount: true,
        studentCount: true,
        durationMinutes: true,
        instructor: {
          select: {
            id: true,
            title: true,
            user: {
              select: { fullName: true, avatarUrl: true }
            }
          }
        }
      }
    }),
    prisma.course.count({ where })
  ]);

  return {
    courses,
    totalItems
  };
}

export async function createSubject(data) {
  if (data.name) {
    data.slug = slugify(data.name);
  }

  let subject;
  try {
    subject = await prisma.subject.create({
      data
    });
  } catch (err) {
    if (err.code === 'P2002') {
      throw ConflictError('A subject with that name or slug already exists.');
    }
    throw err;
  }
  
  await deleteByPattern('cache:subjects:*').catch(() => {});
  return subject;
}

export async function updateSubject(id, data) {
  const oldSubject = await prisma.subject.findUnique({ where: { id } });
  if (!oldSubject) {
    throw NotFoundError('Subject not found');
  }

  if (data.name && data.name !== oldSubject.name) {
    data.slug = slugify(data.name);
  }

  let subject;
  try {
    subject = await prisma.subject.update({
      where: { id },
      data
    });
  } catch (err) {
    if (err.code === 'P2002') {
      throw ConflictError('A subject with that name or slug already exists.');
    }
    throw err;
  }

  await deleteByPattern('cache:subjects:*').catch(() => {});
  
  // Invalidate any cache keys that might have used the old slug (like courses filtering)
  if (data.slug && data.slug !== oldSubject.slug) {
    await deleteByPattern('cache:courses:*').catch(() => {});
  }

  return subject;
}

export async function deleteSubject(id) {
  try {
    await prisma.subject.delete({
      where: { id }
    });
    await deleteByPattern('cache:subjects:*').catch(() => {});
  } catch (err) {
    if (err.code === 'P2003') {
      const count = await prisma.course.count({ where: { subjectId: id } });
      throw ConflictError(`Cannot delete subject because it still has ${count} courses attached.`);
    }
    throw err;
  }
}
