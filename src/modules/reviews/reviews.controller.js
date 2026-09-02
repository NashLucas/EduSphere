import * as reviewsService from './reviews.service.js';
import { apiResponse } from '../../utils/api-response.js';

export const createReview = async (req, res, next) => {
  try {
    const { courseId } = req.params;
    const review = await reviewsService.createReview(req.user.id, courseId, req.body);
    return apiResponse.created(res, review, 'Review created successfully');
  } catch (err) {
    next(err);
  }
};

export const listCourseReviews = async (req, res, next) => {
  try {
    const { courseId } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    
    const { items, meta } = await reviewsService.listCourseReviews(courseId, { page, limit });
    return apiResponse.paginated(res, items, meta, 'Reviews retrieved successfully');
  } catch (err) {
    next(err);
  }
};

export const updateReview = async (req, res, next) => {
  try {
    const { id } = req.params;
    const review = await reviewsService.updateReview(req.user.id, id, req.body);
    return apiResponse.success(res, review, 'Review updated successfully');
  } catch (err) {
    next(err);
  }
};

export const deleteReview = async (req, res, next) => {
  try {
    const { id } = req.params;
    await reviewsService.deleteReview(req.user.id, id, req.user.role);
    return apiResponse.success(res, null, 'Review deleted successfully');
  } catch (err) {
    next(err);
  }
};
