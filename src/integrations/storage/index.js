import * as s3Provider from './s3.js';
import * as cloudinaryProvider from './cloudinary.js';

let provider;

if (process.env.STORAGE_PROVIDER === 'cloudinary') {
  provider = cloudinaryProvider;
} else {
  provider = s3Provider;
}

export const generatePresignedUrl = provider.generatePresignedUrl;
export const headObject = provider.headObject;
export const deleteObject = provider.deleteObject;
export const moveObject = provider.moveObject;

export const uploadBuffer = provider.uploadBuffer;
