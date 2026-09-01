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
