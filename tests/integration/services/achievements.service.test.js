import { describe, it, expect, beforeEach } from 'vitest';
import * as achievementsService from '../../../src/modules/achievements/achievements.service.js';
import { makeUser } from '../factories.js';
import prisma from '../../../src/database/index.js';

describe('Achievements Service Integration', () => {
  let user, achievement;

  beforeEach(async () => {
    user = await makeUser({ role: 'STUDENT' });
    
    achievement = await prisma.achievement.create({
      data: {
        title: `Test Achiever ${Date.now()}-${Math.random()}`,
        description: 'Complete 1 course',
        icon: 'test-icon',
        criteriaType: 'COURSES_COMPLETED',
        criteriaValue: 1
      }
    });
  });

  it('evaluateAchievements should grant achievement when criteria met', async () => {
    // Mock user completing a course
    const { makeCourse } = await import('../factories.js');
    const course = await makeCourse();
    await prisma.enrollment.create({
      data: {
        userId: user.id,
        courseId: course.id,
        status: 'COMPLETED'
      }
    });

    const awarded = await achievementsService.evaluateAchievements(user.id);
    expect(awarded.length).toBeGreaterThanOrEqual(1);
    expect(awarded.some(a => a.id === achievement.id)).toBe(true);

    // Verify it isn't awarded again
    const awardedAgain = await achievementsService.evaluateAchievements(user.id);
    expect(awardedAgain.length).toBe(0);
  });

  it('listAchievements should return all catalog', async () => {
    const list = await achievementsService.listAchievements();
    expect(list.length).toBeGreaterThan(0);
  });

  it('getMyAchievements should show earned and in-progress', async () => {
    const data = await achievementsService.getMyAchievements(user.id);
    expect(data.earned).toBeDefined();
    expect(data.inProgress.length).toBeGreaterThan(0);
    
    const target = data.inProgress.find(a => a.id === achievement.id);
    expect(target.currentValue).toBe(0);
    expect(target.targetValue).toBe(1);
    expect(target.percentComplete).toBe(0);
  });
});
