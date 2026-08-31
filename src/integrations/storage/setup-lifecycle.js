import { S3Client, PutBucketLifecycleConfigurationCommand } from '@aws-sdk/client-s3';
import { env } from '../../config/env.js';

const s3Client = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

export const setupLifecycle = async () => {
  if (env.STORAGE_PROVIDER !== 's3') return;

  const command = new PutBucketLifecycleConfigurationCommand({
    Bucket: env.AWS_S3_BUCKET,
    LifecycleConfiguration: {
      Rules: [
        {
          ID: 'ExpireStagingUploads',
          Filter: {
            Prefix: 'staging/',
          },
          Status: 'Enabled',
          Expiration: {
            Days: 1,
          },
        },
      ],
    },
  });

  await s3Client.send(command);
  console.log('S3 bucket lifecycle rule applied: staging/ objects expire in 1 day.');
};

import { fileURLToPath } from 'url';

// If run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  setupLifecycle().catch(console.error);
}
