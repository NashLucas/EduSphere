import { describe, it, expect, beforeEach } from 'vitest';
import * as notificationsService from '../../../src/modules/notifications/notifications.service.js';
import { makeUser } from '../factories.js';
import prisma from '../../../src/database/index.js';

describe('Notifications Service Integration', () => {
  let user;

  beforeEach(async () => {
    user = await makeUser();
  });

  it('createNotification should create a notification', async () => {
    const notif = await notificationsService.createNotification(user.id, 'SYSTEM', 'Test', 'Msg');
    expect(notif.userId).toBe(user.id);
    expect(notif.isRead).toBe(false);
  });

  it('getNotifications should list notifications with pagination', async () => {
    await notificationsService.createNotification(user.id, 'SYSTEM', 'Test1', 'Msg1');
    await notificationsService.createNotification(user.id, 'SYSTEM', 'Test2', 'Msg2');

    const result = await notificationsService.getNotifications(user.id, { page: 1, limit: 1 });
    expect(result.items.length).toBe(1);
    expect(result.meta.totalItems).toBe(2);
    expect(result.meta.unreadCount).toBe(2);
  });

  it('markAsRead should update isRead flag', async () => {
    const notif = await notificationsService.createNotification(user.id, 'SYSTEM', 'Test', 'Msg');
    
    await notificationsService.markAsRead(user.id, notif.id);
    const updated = await prisma.notification.findUnique({ where: { id: notif.id } });
    expect(updated.isRead).toBe(true);
  });

  it('markAsRead should throw if not found or unauthorized', async () => {
    const notif = await notificationsService.createNotification(user.id, 'SYSTEM', 'Test', 'Msg');
    const otherUser = await makeUser();

    await expect(notificationsService.markAsRead(otherUser.id, notif.id))
      .rejects.toThrow('Notification not found');
      
    const unknownId = '00000000-0000-0000-0000-000000000000';
    await expect(notificationsService.markAsRead(user.id, unknownId))
      .rejects.toThrow('Notification not found');
  });

  it('markAllAsRead should mark all as read', async () => {
    await notificationsService.createNotification(user.id, 'SYSTEM', 'Test1', 'Msg1');
    await notificationsService.createNotification(user.id, 'SYSTEM', 'Test2', 'Msg2');

    await notificationsService.markAllAsRead(user.id);
    const result = await notificationsService.getNotifications(user.id, { page: 1, limit: 10 });
    expect(result.meta.unreadCount).toBe(0);
  });
});
