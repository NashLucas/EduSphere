import { prisma } from '../../database/index.js';
import { logger } from '../../middlewares/logging.middleware.js';

/**
 * Evaluates and awards achievements for a user.
 * Must be called inside a transaction to ensure atomicity with the trigger event.
 * 
 * @param {string} userId - The user to evaluate
 * @param {object} tx - Prisma transaction client
 * @returns {Promise<Array>} List of newly awarded achievements for email dispatch
 */
export async function evaluateAchievements(userId, tx = prisma) {
  // 1. Fetch user's existing achievements to avoid duplicate processing
  const existingUserAchievements = await tx.userAchievement.findMany({
    where: { userId },
    select: { achievementId: true }
  });
  const earnedAchievementIds = new Set(existingUserAchievements.map(ua => ua.achievementId));

  // 2. Fetch all achievements from the catalog
  const allAchievements = await tx.achievement.findMany();

  // 3. Compute the four metrics
  const coursesCompleted = await tx.enrollment.count({
    where: { userId, status: 'COMPLETED' }
  });

  const perfectQuizzes = await tx.quizAttempt.count({
    where: { userId, score: 100 }
  });

  const streak = await tx.userStreak.findUnique({
    where: { userId },
    select: { currentStreak: true }
  });
  const currentStreak = streak?.currentStreak || 0;

  const lessonsCompleted = await tx.lessonProgress.count({
    where: {
      enrollment: { userId },
      isCompleted: true
    }
  });

  const newAwards = [];
  const notificationsToCreate = [];

  for (const achievement of allAchievements) {
    if (earnedAchievementIds.has(achievement.id)) {
      continue;
    }

    let metricValue = 0;
    switch (achievement.criteriaType) {
      case 'COURSES_COMPLETED':
        metricValue = coursesCompleted;
        break;
      case 'QUIZ_PERFECT_SCORE':
        metricValue = perfectQuizzes;
        break;
      case 'STREAK_DAYS':
        metricValue = currentStreak;
        break;
      case 'LESSONS_COMPLETED':
        metricValue = lessonsCompleted;
        break;
      default:
        logger.warn({ criteriaType: achievement.criteriaType }, 'Unknown achievement criteria type');
        continue;
    }

    if (metricValue >= achievement.criteriaValue) {
      newAwards.push({
        userId,
        achievementId: achievement.id
      });
      notificationsToCreate.push({
        userId,
        type: 'ACHIEVEMENT',
        title: 'Achievement Unlocked!',
        message: `You earned the "${achievement.title}" badge.`
      });
    }
  }

  // 4. Insert new achievements and notifications transactionally
  if (newAwards.length > 0) {
    await tx.userAchievement.createMany({
      data: newAwards,
      skipDuplicates: true
    });

    await tx.notification.createMany({
      data: notificationsToCreate
    });
    
    logger.info({ userId, count: newAwards.length }, 'Achievements awarded');
  }

  // Return the full achievement objects for the newly awarded ones (for email dispatch)
  return allAchievements.filter(a => newAwards.some(na => na.achievementId === a.id));
}

export async function listAchievements() {
  return await prisma.achievement.findMany({
    select: {
      id: true,
      title: true,
      description: true,
      icon: true,
      criteriaType: true,
      criteriaValue: true
    },
    orderBy: { criteriaType: 'asc' }
  });
}

export async function getMyAchievements(userId) {
  const earned = await prisma.userAchievement.findMany({
    where: { userId },
    include: {
      achievement: {
        select: {
          id: true,
          title: true,
          description: true,
          icon: true,
          criteriaType: true,
          criteriaValue: true
        }
      }
    },
    orderBy: { earnedAt: 'desc' }
  });

  const allAchievements = await listAchievements();
  const earnedIds = new Set(earned.map(e => e.achievementId));
  
  const unearned = allAchievements.filter(a => !earnedIds.has(a.id));
  
  const coursesCompleted = await prisma.enrollment.count({
    where: { userId, status: 'COMPLETED' }
  });
  const perfectQuizzes = await prisma.quizAttempt.count({
    where: { userId, score: 100 }
  });
  const streak = await prisma.userStreak.findUnique({
    where: { userId },
    select: { currentStreak: true }
  });
  const currentStreak = streak?.currentStreak || 0;
  const lessonsCompleted = await prisma.lessonProgress.count({
    where: {
      enrollment: { userId },
      isCompleted: true
    }
  });
  
  const metrics = {
    COURSES_COMPLETED: coursesCompleted,
    QUIZ_PERFECT_SCORE: perfectQuizzes,
    STREAK_DAYS: currentStreak,
    LESSONS_COMPLETED: lessonsCompleted
  };

  const progress = unearned.map(a => {
    let current = metrics[a.criteriaType] || 0;
    return {
      ...a,
      currentValue: current,
      targetValue: a.criteriaValue,
      percentComplete: Math.min(100, Math.floor((current / a.criteriaValue) * 100))
    };
  });

  return {
    earned: earned.map(e => ({
      ...e.achievement,
      earnedAt: e.earnedAt
    })),
    inProgress: progress
  };
}
