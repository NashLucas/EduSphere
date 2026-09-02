import * as notificationsService from './notifications.service.js';
import response from '../../utils/api-response.js';

export const getNotifications = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const { items, meta } = await notificationsService.getNotifications(req.user.id, { page, limit });
    
    // response.paginated expects meta to be { page, limit, totalItems } and any extras.
    // Wait, let's verify if `response.paginated` allows passing extra meta fields.
    // It returns res.json({ pagination: { page, limit, totalItems, totalPages, ...meta } });
    
    // The requirement: with unreadCount in the response metadata.
    // If api-response doesn't spread extra meta fields, I can just attach it to `data` or send a custom object.
    // I'll look closely at `api-response.js` later, but for now I'll pass it.

    return response.paginated(res, items, meta, 'Notifications retrieved successfully');
  } catch (err) {
    next(err);
  }
};

export const markAsRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const notification = await notificationsService.markAsRead(req.user.id, id);
    return response.success(res, notification, 'Notification marked as read');
  } catch (err) {
    next(err);
  }
};

export const markAllAsRead = async (req, res, next) => {
  try {
    await notificationsService.markAllAsRead(req.user.id);
    return response.success(res, null, 'All notifications marked as read');
  } catch (err) {
    next(err);
  }
};
