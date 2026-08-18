export const sendSuccess = (res, statusCode, message, data = {}) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

export const sendPaginatedSuccess = (res, message, data, meta) => {
  return res.status(200).json({
    success: true,
    message,
    data,
    meta,
  });
};

export const sendError = (res, statusCode, message) => {
  return res.status(statusCode).json({
    success: false,
    message,
  });
};
