import { describe, it, expect, beforeEach } from 'vitest';
import * as bookmarksService from '../../../src/modules/bookmarks/bookmarks.service.js';
import { makeUser, makeCourse } from '../factories.js';
import prisma from '../../../src/database/index.js';

describe('Bookmarks Service Integration', () => {
  let user, course;

  beforeEach(async () => {
    user = await makeUser({ role: 'STUDENT' });
    course = await makeCourse();
  });

  it('toggleBookmark should add and remove bookmark', async () => {
    // Add bookmark
    const res1 = await bookmarksService.toggleBookmark(user.id, { courseId: course.id });
    expect(res1.status).toBe('added');

    const bookmarks = await prisma.bookmark.findMany({ where: { userId: user.id } });
    expect(bookmarks.length).toBe(1);

    // Remove bookmark
    const res2 = await bookmarksService.toggleBookmark(user.id, { courseId: course.id });
    expect(res2.status).toBe('removed');

    const bookmarks2 = await prisma.bookmark.findMany({ where: { userId: user.id } });
    expect(bookmarks2.length).toBe(0);
  });

  it('listBookmarks should paginate results', async () => {
    await bookmarksService.toggleBookmark(user.id, { courseId: course.id });
    const course2 = await makeCourse();
    await bookmarksService.toggleBookmark(user.id, { courseId: course2.id });

    const result = await bookmarksService.listBookmarks(user.id, { page: 1, limit: 1 });
    expect(result.items.length).toBe(1);
    expect(result.meta.totalItems).toBe(2);
  });
});
