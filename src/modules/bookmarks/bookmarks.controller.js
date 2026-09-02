import * as bookmarksService from './bookmarks.service.js';
import response from '../../utils/api-response.js';

export const toggleBookmark = async (req, res, next) => {
  try {
    const result = await bookmarksService.toggleBookmark(req.user.id, req.body);
    return response.success(res, result, `Bookmark ${result.status}`);
  } catch (err) {
    next(err);
  }
};

export const listBookmarks = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    
    const { items, meta } = await bookmarksService.listBookmarks(req.user.id, { page, limit });
    return response.paginated(res, items, meta, 'Bookmarks retrieved successfully');
  } catch (err) {
    next(err);
  }
};
