import crypto from 'crypto';
import prisma from '../../database/index.js';
import { generatePresignedUrl, headObject, moveObject } from '../../integrations/storage/index.js';
import { verifyCourseOwnership } from '../courses/courses.service.js';
import { BadRequestError } from '../../utils/app-error.js';

export const getUploadUrl = async (user, { fileName, fileType, fileSize, courseId }) => {
  await verifyCourseOwnership(courseId, user.id, user.role);
  
  const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  const fileKey = `staging/course-${courseId}/${crypto.randomUUID()}-${safeFileName}`;
  
  return await generatePresignedUrl(fileKey, fileType, fileSize);
};

export const confirmUpload = async (user, { fileKey, title, description, category, courseId }) => {
  if (courseId) {
    await verifyCourseOwnership(courseId, user.id, user.role);
  }

  let meta;
  try {
    meta = await headObject(fileKey);
  } catch (err) {
    if (err.name === 'NotFound') throw BadRequestError('File not found in staging');
    throw err;
  }

  const permanentKey = fileKey.replace(/^staging\//, 'permanent/');
  await moveObject(fileKey, permanentKey);

  const resource = await prisma.resource.create({
    data: {
      title,
      description,
      category,
      fileType: meta.contentType,
      fileUrl: permanentKey,
      fileSize: meta.contentLength,
      courseId,
      uploadedBy: user.id,
    }
  });

  return resource;
};

import { ForbiddenError, NotFoundError } from '../../utils/app-error.js';
import { deleteObject } from '../../integrations/storage/index.js';

export const getResources = async ({ category, courseId, page = 1, limit = 10 }) => {
  const where = {};
  if (category) where.category = category;
  if (courseId) where.courseId = courseId;

  const skip = (page - 1) * limit;

  const [resources, total] = await Promise.all([
    prisma.resource.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.resource.count({ where })
  ]);

  return { resources, total, page, limit, totalPages: Math.ceil(total / limit) };
};

export const createResource = async (user, data) => {
  if (data.courseId) {
    await verifyCourseOwnership(data.courseId, user.id, user.role);
  }

  return await prisma.resource.create({
    data: {
      ...data,
      uploadedBy: user.id
    }
  });
};

export const deleteResource = async (user, resourceId) => {
  const resource = await prisma.resource.findUnique({ where: { id: resourceId } });
  if (!resource) throw NotFoundError('Resource not found');

  // Ensure caller is owner or admin
  if (user.role !== 'ADMIN' && resource.uploadedBy !== user.id) {
    throw ForbiddenError('Not authorized to delete this resource');
  }

  // Delete from DB first
  await prisma.resource.delete({ where: { id: resourceId } });

  // If it's a managed file (not an external URL), delete from storage
  if (resource.fileUrl.startsWith('permanent/')) {
    try {
      await deleteObject(resource.fileUrl);
    } catch (err) {
      console.error('Failed to delete object from storage:', err);
    }
  }
};
