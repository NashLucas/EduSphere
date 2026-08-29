import prisma from '../../database/index.js';

/**
 * Creates an instructor profile for a user.
 * Called automatically during registration or admin elevation for users with the INSTRUCTOR role.
 *
 * @param {string} userId - The UUID of the user
 * @param {object} [tx] - Optional Prisma transaction client
 * @returns {Promise<object>} The created instructor profile
 */
export const createInstructorProfile = async (userId, tx = prisma) => {
  return await tx.instructor.create({
    data: {
      userId,
      title: 'Instructor', // Default title, updatable by the user later
    },
  });
};
