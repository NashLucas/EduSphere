export class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export const BadRequestError = (message) => new AppError(message, 400);
export const UnauthorizedError = (message) => new AppError(message, 401);
export const ForbiddenError = (message) => new AppError(message, 403);
export const NotFoundError = (message) => new AppError(message, 404);
export const ConflictError = (message) => new AppError(message, 409);
