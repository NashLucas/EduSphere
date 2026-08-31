import crypto from 'crypto';
import { generatePresignedUrl } from '../../integrations/storage/index.js';
import { verifyCourseOwnership } from '../courses/courses.service.js';

export const getUploadUrl = async (user, { fileName, fileType, fileSize, courseId }) => {
  await verifyCourseOwnership(courseId, user.id, user.role);
  
  const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  const fileKey = `staging/course-${courseId}/${crypto.randomUUID()}-${safeFileName}`;
  
  return await generatePresignedUrl(fileKey, fileType, fileSize);
};
