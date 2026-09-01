import crypto from 'crypto';
import { prisma } from '../../database/index.js';
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
