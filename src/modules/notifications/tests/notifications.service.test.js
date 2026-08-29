import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createNotification } from '../notifications.service.js';
import prisma from '../../../database/index.js';

vi.mock('../../../database/index.js', () => ({
  default: {
    notification: {
      create: vi.fn(),
    },
  },
}));

describe('Notifications Service - createNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a notification using the default prisma client', async () => {
    const mockNotif = {
      id: 'notif-1',
      userId: 'user-1',
      type: 'SYSTEM',
      title: 'Welcome',
      message: 'Hello World',
    };
    prisma.notification.create.mockResolvedValueOnce(mockNotif);

    const result = await createNotification('user-1', 'SYSTEM', 'Welcome', 'Hello World');

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        type: 'SYSTEM',
        title: 'Welcome',
        message: 'Hello World',
      },
    });
    expect(result).toEqual(mockNotif);
  });

  it('creates a notification using an injected transaction client', async () => {
    const tx = {
      notification: {
        create: vi.fn().mockResolvedValueOnce({ id: 'tx-notif' }),
      },
    };

    const result = await createNotification('user-2', 'COURSE_UPDATE', 'Update', 'New content', tx);

    expect(tx.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-2',
        type: 'COURSE_UPDATE',
        title: 'Update',
        message: 'New content',
      },
    });
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'tx-notif' });
  });
});
