import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    PORT: z.string().default('3000'),
    LOG_LEVEL: z.string().default('info'),
    CORS_ORIGIN: z.string().url(),
    FRONTEND_URL: z.string().url(),
    SWAGGER_ENABLED: z
      .string()
      .transform((val) => val === 'true')
      .default('false'),

    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),

    JWT_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

    STORAGE_PROVIDER: z.enum(['s3', 'cloudinary']),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    AWS_REGION: z.string().optional(),
    AWS_S3_BUCKET: z.string().optional(),
    CLOUDINARY_URL: z.string().optional(),

    EMAIL_PROVIDER: z.string(),
    EMAIL_API_KEY: z.string().min(1),
    EMAIL_FROM: z.string().email(),
    EMAIL_FROM_NAME: z.string().min(1),
    EMAIL_WEBHOOK_SECRET: z.string().min(1),

    DATABASE_URL_TEST: z.string().url().optional(),
    REDIS_URL_TEST: z.string().url().optional(),
  })
  .superRefine((data, ctx) => {
    // Length alone does not make two keys two keys. Signing both token classes
    // with one secret lets a refresh token be presented as an access token, which
    // turns the 15-minute access window into 7 days (TRD §7) — and copy-pasting
    // one secret into both slots is the likeliest way to get there, since it
    // satisfies every other rule in this file.
    if (
      data.JWT_SECRET &&
      data.JWT_REFRESH_SECRET &&
      data.JWT_SECRET === data.JWT_REFRESH_SECRET
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'JWT_SECRET and JWT_REFRESH_SECRET must be distinct — one key for both token classes lets a refresh token authenticate as an access token (TRD §7)',
        path: ['JWT_REFRESH_SECRET'],
      });
    }

    if (data.STORAGE_PROVIDER === 's3') {
      if (!data.AWS_ACCESS_KEY_ID)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'AWS_ACCESS_KEY_ID is required for s3',
          path: ['AWS_ACCESS_KEY_ID'],
        });
      if (!data.AWS_SECRET_ACCESS_KEY)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'AWS_SECRET_ACCESS_KEY is required for s3',
          path: ['AWS_SECRET_ACCESS_KEY'],
        });
      if (!data.AWS_REGION)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'AWS_REGION is required for s3',
          path: ['AWS_REGION'],
        });
      if (!data.AWS_S3_BUCKET)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'AWS_S3_BUCKET is required for s3',
          path: ['AWS_S3_BUCKET'],
        });
    } else if (data.STORAGE_PROVIDER === 'cloudinary') {
      if (!data.CLOUDINARY_URL)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'CLOUDINARY_URL is required for cloudinary',
          path: ['CLOUDINARY_URL'],
        });
    }

    if (data.NODE_ENV === 'test') {
      if (!data.DATABASE_URL_TEST)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'DATABASE_URL_TEST is required in test environment',
          path: ['DATABASE_URL_TEST'],
        });
      if (!data.REDIS_URL_TEST)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'REDIS_URL_TEST is required in test environment',
          path: ['REDIS_URL_TEST'],
        });
    }
  });

// A variable set to nothing and a variable never set are the same mistake, but
// Zod only recognises the second: `.default()` fires on `undefined` alone, so a
// bare `PORT=` reaches the schema as '' and silently defeats every default
// above. TRD §10.2 names this hazard directly — validate "never merely for
// existence, since an empty string is a valid environment variable and an
// invalid signing key."
//
// Dropping blank values makes `FOO=` behave like an absent FOO: defaults apply,
// and a genuinely required variable reports "Required" instead of a length
// error. Values are only dropped, never rewritten — trimming a value that was
// actually set would hide whitespace bugs that belong to that variable's own
// validator.
const dropBlankValues = (raw) =>
  Object.fromEntries(
    Object.entries(raw).filter(
      ([, value]) => typeof value !== 'string' || value.trim() !== '',
    ),
  );

const _env = envSchema.safeParse(dropBlankValues(process.env));

if (!_env.success) {
  console.error(
    '❌ Invalid environment variables:',
    JSON.stringify(_env.error.format(), null, 2),
  );
  process.exit(1);
}

export const env = _env.data;
