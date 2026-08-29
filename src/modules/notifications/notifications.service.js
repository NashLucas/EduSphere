import prisma from '../../database/index.js';

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
