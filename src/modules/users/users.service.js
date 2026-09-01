import prisma from '../../database/index.js';
import { uploadBuffer } from '../../integrations/storage/index.js';
import { BadRequestError } from '../../utils/app-error.js';

const checkMagicBytes = (buffer) => {
  if (buffer.length < 12) return false;
  const hex = buffer.toString('hex', 0, 12).toUpperCase();
  if (hex.startsWith('FFD8FF')) return 'image/jpeg';
  if (hex.startsWith('89504E47')) return 'image/png';
  if (hex.startsWith('47494638')) return 'image/gif';
  if (hex.startsWith('52494646') && hex.substring(16, 24) === '57454250') return 'image/webp';
  return null;
};

export const uploadAvatar = async (userId, buffer) => {
  if (buffer.length > 5 * 1024 * 1024) {
    throw BadRequestError('File size exceeds 5MB limit');
  }

  const mimeType = checkMagicBytes(buffer);
  if (!mimeType) {
    throw BadRequestError('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.');
  }

  const ext = mimeType.split('/')[1];
  const fileKey = `avatars/${userId}-${Date.now()}.${ext}`;

  const fileUrl = await uploadBuffer(fileKey, buffer, mimeType);

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: fileUrl },
  });

  return updatedUser;
};

export const getStudentDashboard = async (userId) => {
  const enrollments = await prisma.enrollment.findMany({
    where: { userId },
    include: {
      course: { select: { id: true, title: true, slug: true, durationMinutes: true } }
    }
  });

  const totalEnrolled = enrollments.length;
  const activeEnrollments = enrollments.filter(e => e.status === 'ACTIVE');
  const completedEnrollments = enrollments.filter(e => e.status === 'COMPLETED');

  const active = activeEnrollments.length;
  const completed = completedEnrollments.length;

  const overallCompletionRate = totalEnrolled > 0 
    ? enrollments.reduce((acc, curr) => acc + curr.progressPercent, 0) / totalEnrolled 
    : 0;

  const totalLearningMinutes = completedEnrollments.reduce((acc, curr) => acc + (curr.course.durationMinutes || 0), 0);
  const totalLearningHours = Math.round((totalLearningMinutes / 60) * 10) / 10;

  const streak = await prisma.userStreak.findUnique({
    where: { userId }
  });

  const recentActivity = await prisma.lessonProgress.findMany({
    where: { 
      enrollment: { userId }, 
      isCompleted: true 
    },
    orderBy: { completedAt: 'desc' },
    take: 5,
    include: {
      lesson: {
        select: {
          title: true,
          module: { select: { course: { select: { title: true } } } }
        }
      }
    }
  });

  const { calculateNextAccessibleLessonId } = await import('../lessons/lessons.service.js');
  
  const activeCoursesProgress = await Promise.all(
    activeEnrollments.map(async (enrollment) => {
      const nextLessonId = await calculateNextAccessibleLessonId(userId, enrollment.course.id);
      let nextLesson = null;
      if (nextLessonId) {
        nextLesson = await prisma.lesson.findUnique({
          where: { id: nextLessonId },
          select: { id: true, title: true, slug: true }
        });
      }
      return {
        course: enrollment.course,
        progressPercent: enrollment.progressPercent,
        nextLesson
      };
    })
  );

  return {
    overview: {
      totalEnrolled,
      active,
      completed,
      overallCompletionRate,
      totalLearningHours
    },
    streak: streak || { currentStreak: 0, longestStreak: 0 },
    recentActivity: recentActivity.map(p => ({
      lessonTitle: p.lesson.title,
      courseTitle: p.lesson.module.course.title,
      completedAt: p.completedAt
    })),
    activeCoursesProgress
  };
};

export const getUserProfile = async (id) => {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      fullName: true,
      bio: true,
      avatarUrl: true,
      role: true,
      createdAt: true
    }
  });

  if (!user) {
    const { NotFoundError } = await import('../../utils/app-error.js');
    throw new NotFoundError('User not found');
  }

  return user;
};

export const updateUserProfile = async (userId, updateData) => {
  const { fullName, bio } = updateData;
  const data = {};
  if (fullName !== undefined) data.fullName = fullName;
  if (bio !== undefined) data.bio = bio;

  return await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      fullName: true,
      bio: true,
      avatarUrl: true,
      role: true,
      createdAt: true
    }
  });
};
