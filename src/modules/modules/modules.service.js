import prisma from '../../database/index.js';
import { NotFoundError } from '../../utils/app-error.js';
import { verifyCourseOwnership } from '../courses/courses.service.js';

export const createModule = async (userId, userRole, courseId, data) => {
  // 1. Verify ownership of the parent course
  await verifyCourseOwnership(courseId, userId, userRole);

  // 2. Create the module
  return await prisma.module.create({
    data: {
      courseId,
      title: data.title,
      orderIndex: data.orderIndex,
    },
  });
};

export const updateModule = async (userId, userRole, moduleId, data) => {
  const mod = await prisma.module.findUnique({
    where: { id: moduleId },
  });
  if (!mod) throw NotFoundError('Module not found');

  // Verify ownership via the parent course
  await verifyCourseOwnership(mod.courseId, userId, userRole);

  // Update
  return await prisma.module.update({
    where: { id: moduleId },
    data,
  });
};

export const deleteModule = async (userId, userRole, moduleId) => {
  const mod = await prisma.module.findUnique({
    where: { id: moduleId },
  });
  if (!mod) throw NotFoundError('Module not found');

  // Verify ownership via the parent course
  await verifyCourseOwnership(mod.courseId, userId, userRole);

  // Delete (cascades to lessons as defined in Prisma schema)
  return await prisma.module.delete({
    where: { id: moduleId },
  });
};
