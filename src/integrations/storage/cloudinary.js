import { v2 as cloudinary } from 'cloudinary';

if (process.env.STORAGE_PROVIDER === 'cloudinary') {
  cloudinary.config({
    secure: true,
    // CLOUDINARY_URL is automatically read from process.env by the cloudinary SDK
  });
}

export const generatePresignedUrl = async (fileKey, fileType, fileSize) => {
  const timestamp = Math.round((new Date()).getTime() / 1000);
  
  const signature = cloudinary.utils.api_sign_request({
    timestamp,
    public_id: fileKey,
  }, cloudinary.config().api_secret);
  
  const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudinary.config().cloud_name}/auto/upload`;
  const publicUrl = cloudinary.url(fileKey, { secure: true });

  // Note: the client must append api_key, timestamp, signature, and public_id to their POST request.
  // For simplicity, we just return the endpoint as uploadUrl.
  return { uploadUrl, publicUrl, expiresInSeconds: 900, fileKey, signature, timestamp, apiKey: cloudinary.config().api_key };
};

export const headObject = async (fileKey) => {
  try {
    const result = await cloudinary.api.resource(fileKey);
    return {
      contentLength: result.bytes,
      contentType: `${result.resource_type}/${result.format}`,
    };
  } catch (err) {
    if (err.http_code === 404) {
      const error = new Error('Not found');
      error.name = 'NotFound';
      throw error;
    }
    throw err;
  }
};

export const deleteObject = async (fileKey) => {
  await cloudinary.uploader.destroy(fileKey);
};

export const moveObject = async (sourceKey, targetKey) => {
  await cloudinary.uploader.rename(sourceKey, targetKey);
};
