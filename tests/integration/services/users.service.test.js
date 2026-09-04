import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as usersService from '../../../src/modules/users/users.service.js';
import { makeUser, makeCourse, makeEnrollment } from '../factories.js';
import prisma from '../../../src/database/index.js';
import * as storage from '../../../src/integrations/storage/index.js';

vi.mock('../../../src/integrations/storage/index.js', () => ({
  uploadBuffer: vi.fn().mockResolvedValue('https://mocked-url.com/avatar.jpg')
}));

describe('Users Service Integration', () => {
  let user, course;

  beforeEach(async () => {
    user = await makeUser({ role: 'STUDENT' });
    course = await makeCourse();
  });

  it('uploadAvatar should reject large files', async () => {
    const largeBuffer = Buffer.alloc(6 * 1024 * 1024);
    await expect(usersService.uploadAvatar(user.id, largeBuffer))
      .rejects.toThrow('File size exceeds 5MB limit');
  });

  it('uploadAvatar should reject invalid types', async () => {
    const invalidBuffer = Buffer.alloc(100);
    await expect(usersService.uploadAvatar(user.id, invalidBuffer))
      .rejects.toThrow('Invalid file type');
  });

  it('uploadAvatar should upload valid jpeg', async () => {
    const validBuffer = Buffer.from('FFD8FF000000000000000000', 'hex');
    const result = await usersService.uploadAvatar(user.id, validBuffer);
    expect(result.avatarUrl).toBe('https://mocked-url.com/avatar.jpg');
    expect(storage.uploadBuffer).toHaveBeenCalled();
  });

  it('getStudentDashboard should return dashboard data', async () => {
    await makeEnrollment(user.id, course.id, { status: 'ACTIVE', progressPercent: 10 });
    
    // Add streak
    await prisma.userStreak.create({
      data: { userId: user.id, currentStreak: 2, longestStreak: 5, lastActiveDate: new Date() }
    });

    const dashboard = await usersService.getStudentDashboard(user.id);
    expect(dashboard.overview.totalEnrolled).toBe(1);
    expect(dashboard.overview.active).toBe(1);
    expect(dashboard.overview.overallCompletionRate).toBe(10);
    expect(dashboard.streak.currentStreak).toBe(2);
    expect(dashboard.activeCoursesProgress.length).toBe(1);
  });

  it('getUserProfile should return profile data', async () => {
    const profile = await usersService.getUserProfile(user.id);
    expect(profile.id).toBe(user.id);
    expect(profile.fullName).toBeDefined();
  });

  it('getUserProfile should throw if not found', async () => {
    const unknownId = '00000000-0000-0000-0000-000000000000';
    await expect(usersService.getUserProfile(unknownId))
      .rejects.toThrow('User not found');
  });

  it('updateUserProfile should update data', async () => {
    const updated = await usersService.updateUserProfile(user.id, { fullName: 'New Name', bio: 'New Bio' });
    expect(updated.fullName).toBe('New Name');
    expect(updated.bio).toBe('New Bio');
  });

  it('deleteAccount should soft delete user and anonymize data', async () => {
    await usersService.deleteAccount(user.id);
    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(dbUser.deletedAt).toBeDefined();
    expect(dbUser.email).toContain('deleted-');
    expect(dbUser.fullName).toBe('Deleted User');
    expect(dbUser.avatarUrl).toBeNull();
  });
});
