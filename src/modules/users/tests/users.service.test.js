import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as usersService from '../users.service.js';
import * as storage from '../../../integrations/storage/index.js';

vi.mock('../../../utils/cache-keys.js', () => ({ session: (id) => 'session:' + id, sessionIndex: (id) => 'session:index:' + id, userState: (id) => 'user:state:' + id }));
vi.mock('../../../config/redis.js', () => ({ default: { set: vi.fn(), smembers: vi.fn(), unlink: vi.fn() } }));
vi.mock('../../../integrations/storage/index.js', () => ({
  uploadBuffer: vi.fn(),
}));

vi.mock('../../../database/index.js', () => ({
  default: {
    user: { findUnique: vi.fn(), 
      update: vi.fn(),
    },
  },
}));

import prisma from '../../../database/index.js';
import { AppError } from '../../../utils/app-error.js';

describe('Users Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('uploadAvatar', () => {
    it('uploads valid jpeg image and updates user', async () => {
      const buffer = Buffer.from('FFD8FF000000000000000000', 'hex');
      storage.uploadBuffer.mockResolvedValue('http://url');
      prisma.user.update.mockResolvedValue({ id: 'u1', avatarUrl: 'http://url' });
      const result = await usersService.uploadAvatar('u1', buffer);
      expect(result.avatarUrl).toBe('http://url');
      expect(storage.uploadBuffer).toHaveBeenCalledWith(expect.stringMatching(/^avatars\/u1-\d+\.jpeg$/), buffer, 'image/jpeg');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { avatarUrl: 'http://url' },
      });
    });

    it('rejects files larger than 5MB', async () => {
      const buffer = Buffer.alloc((5 * 1024 * 1024) + 1);
      await expect(usersService.uploadAvatar('u1', buffer)).rejects.toThrow(AppError);
    });

    it('rejects invalid magic bytes', async () => {
      const buffer = Buffer.from('000000000000000000000000', 'hex');
      await expect(usersService.uploadAvatar('u1', buffer)).rejects.toThrow(AppError);
    });
  });


  describe('deleteAccount', () => {
    it('anonymizes user, sets deletedAt, revokes sessions, and clears state cache', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'test@test.com' });
      prisma.user.update.mockResolvedValue({});

      const redis = (await import('../../../config/redis.js')).default;
      redis.smembers.mockResolvedValue(['sess1', 'sess2']);
      redis.unlink.mockResolvedValue();

      await usersService.deleteAccount('u1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: {
          deletedAt: expect.any(Date),
          email: 'deleted-u1@invalid',
          fullName: 'Deleted User',
          avatarUrl: null,
          bio: null
        }
      });
      
      expect(redis.smembers).toHaveBeenCalledWith('session:index:u1');
      expect(redis.unlink).toHaveBeenCalledWith('session:sess1', 'session:sess2');
      expect(redis.unlink).toHaveBeenCalledWith('session:index:u1');
      expect(redis.unlink).toHaveBeenCalledWith('user:state:u1');
    });
  });
});
