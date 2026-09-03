import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

export default async function setup() {
  if (process.env.DATABASE_URL_TEST) {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  }
  if (process.env.REDIS_URL_TEST) {
    process.env.REDIS_URL = process.env.REDIS_URL_TEST;
  }

  console.log('Running test database migrations...');
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });

  console.log('Seeding test database...');
  execSync('npm run db:seed', { stdio: 'inherit', env: process.env });
}
