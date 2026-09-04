import prisma from '../../database/index.js';

export const toggleBookmark = async (userId, target) => {
  const { courseId, lessonId } = target;

  const whereClause = {
    userId,
    ...(courseId ? { courseId } : { lessonId }),
  };

  const existing = await prisma.bookmark.findFirst({
    where: whereClause
  });

  if (existing) {
    await prisma.bookmark.delete({
      where: { id: existing.id }
    });
    return { status: 'removed' };
  } else {
    await prisma.bookmark.create({
      data: {
        userId,
        courseId: courseId || null,
        lessonId: lessonId || null,
      }
    });
    return { status: 'added' };
  }
};

export const listBookmarks = async (userId, { page = 1, limit = 10 }) => {
  const skip = (page - 1) * limit;

  const [items, totalItems] = await Promise.all([
    prisma.bookmark.findMany({
      where: { userId },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        course: { select: { id: true, title: true, slug: true, thumbnailUrl: true } },
        lesson: { select: { id: true, title: true, slug: true, type: true, module: { select: { course: { select: { title: true, slug: true } } } } } }
      }
    }),
    prisma.bookmark.count({ where: { userId } })
  ]);

  return { items, meta: { page, limit, totalItems } };
};
