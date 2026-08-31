import { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let s3Client;
if (process.env.STORAGE_PROVIDER !== 'cloudinary') {
  s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
    },
  });
}

export const generatePresignedUrl = async (fileKey, fileType, fileSize) => {
  const command = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET || 'test-bucket',
    Key: fileKey,
    ContentType: fileType,
    ContentLength: fileSize,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });
  const publicUrl = `https://${process.env.AWS_S3_BUCKET || 'test-bucket'}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${fileKey}`;

  return { uploadUrl, publicUrl, expiresInSeconds: 900, fileKey };
};

export const headObject = async (fileKey) => {
  const command = new HeadObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET || 'test-bucket',
    Key: fileKey,
  });
  const data = await s3Client.send(command);
  return {
    contentLength: data.ContentLength,
    contentType: data.ContentType,
  };
};

export const deleteObject = async (fileKey) => {
  const command = new DeleteObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET || 'test-bucket',
    Key: fileKey,
  });
  return await s3Client.send(command);
};

export const moveObject = async (sourceKey, targetKey) => {
  const copyCommand = new CopyObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET || 'test-bucket',
    CopySource: `${process.env.AWS_S3_BUCKET || 'test-bucket'}/${sourceKey}`,
    Key: targetKey,
  });
  await s3Client.send(copyCommand);

  const deleteCommand = new DeleteObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET || 'test-bucket',
    Key: sourceKey,
  });
  await s3Client.send(deleteCommand);
};
