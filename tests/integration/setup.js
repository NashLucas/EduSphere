import { beforeAll } from 'vitest';
import prisma from '../../src/database/index.js';
import redis from '../../src/config/redis.js';
import { execSync } from 'child_process';

beforeAll(async () => {
  const { expect } = await import('vitest');
  if (!expect.getState().testPath.includes('integration')) return;

  if (process.env.DATABASE_URL_TEST) {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  }
  if (process.env.REDIS_URL_TEST) {
    process.env.REDIS_URL = process.env.REDIS_URL_TEST;
  }

  // Truncate between suites
  const tablenames = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename != '_prisma_migrations';
  `;

  const tables = tablenames
    .map(({ tablename }) => '"' + tablename + '"')
    .join(', ');

  if (tables.length > 0) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE;`);
  }

  // Re-seed
  execSync('npm run db:seed', { stdio: 'ignore', env: process.env });

  // Clear Redis
  await redis.flushdb();
});
