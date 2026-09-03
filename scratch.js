import request from 'supertest';
import app from './src/app.js';
import { loginAs, makeUser } from './tests/integration/factories.js';

async function run() {
  const admin = await makeUser({ role: 'ADMIN' });
  const authHeader = loginAs(admin);
  const res = await request(app).get('/api/v1/admin/audit-logs').set('Authorization', authHeader);
  console.log('STATUS:', res.status);
  console.log('BODY:', JSON.stringify(res.body, null, 2));
}

run().catch(console.error);
