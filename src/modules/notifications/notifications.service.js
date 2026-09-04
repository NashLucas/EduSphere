import prisma from '../../database/index.js';
import { NotFoundError } from '../../utils/app-error.js';

/**
 * Creates a new notification for a user.
 * 
 * @param {string} userId - The UUID of the user receiving the notification
 * @param {string} type - The NotificationType enum value
 * @param {string} title - The title of the notification
 * @param {string} message - The notification body message
 * @param {object} [tx] - Optional Prisma transaction client
 * @returns {Promise<object>} The created notification object
 */
export const createNotification = async (userId, type, title, message, tx = prisma) => {
  return await tx.notification.create({
    data: {
      userId,
      type,
      title,
      message,
    }
  });
};

export const getNotifications = async (userId, { page = 1, limit = 10 }) => {
  const skip = (page - 1) * limit;

  const [items, totalItems, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.notification.count({ where: { userId } }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);

  return {
    items,
    meta: { page, limit, totalItems, unreadCount }
  };
};

export const markAsRead = async (userId, notificationId) => {
  // If the notification doesn't exist OR belongs to someone else, we return 404 to avoid leaking existence (Task 12.3)
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId }
  });

  if (!notification || notification.userId !== userId) {
    throw NotFoundError('Notification not found');
  }

  return await prisma.notification.update({
    where: { id: notificationId },
    data: { isRead: true }
  });
};

export const markAllAsRead = async (userId) => {
  await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true }
  });
};

