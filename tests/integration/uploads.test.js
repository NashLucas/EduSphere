import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { makeUser, makeCourse, loginAs } from './factories.js';
import prisma from '../../src/database/index.js';
import crypto from 'crypto';

vi.mock('../../src/integrations/storage/index.js', () => ({
  generatePresignedUrl: vi.fn(async (fileKey) => ({ uploadUrl: 'http://mock', publicUrl: 'http://mock', expiresInSeconds: 900, fileKey })),
  headObject: vi.fn(async (fileKey) => {
    if (fileKey.includes('fake-key-that-does-not-exist')) {
      const err = new Error('Not found');
      err.name = 'NotFound';
      throw err;
    }
    return { contentLength: 1024, contentType: 'image/jpeg' };
  }),
  deleteObject: vi.fn(),
  moveObject: vi.fn(),
  uploadBuffer: vi.fn(),
}));

describe('Uploads & Webhooks Integration', () => {
  let instructor, instructorAuth, student, studentAuth, course;

  beforeAll(async () => {
    instructor = await makeUser({ role: 'INSTRUCTOR', isEmailVerified: true });
    instructorAuth = loginAs(instructor);

    const instProfile = await prisma.instructor.create({
      data: { userId: instructor.id, title: 'Upload Instructor' }
    });

    course = await makeCourse({ isPublished: false, instructorId: instProfile.id });
    student = await makeUser({ role: 'STUDENT', isEmailVerified: true });
    studentAuth = loginAs(student);
  });

  describe('Pre-signed URL', () => {
    it('rejects an over-limit file size (video)', async () => {
      const res = await request(app)
        .post('/api/v1/resources/upload-url')
        .set('Authorization', instructorAuth)
        .send({
          fileName: 'big-video.mp4',
          fileType: 'video/mp4',
          fileSize: 1000 * 1024 * 1024, // 1GB
          courseId: course.id
        });
      
      expect(res.status).toBe(422);
    });

    it('rejects a wrong-MIME request', async () => {
      const res = await request(app)
        .post('/api/v1/resources/upload-url')
        .set('Authorization', instructorAuth)
        .send({
          fileName: 'malware.exe',
          fileType: 'application/x-msdownload',
          fileSize: 1024,
          courseId: course.id
        });
      
      expect(res.status).toBe(422);
    });
  });

  describe('Upload Confirmation', () => {
    it('rejects confirmation without a real object (422) and no Resource row', async () => {
      // confirmUpload checks if file exists. In our setup-lifecycle, it might be mocked or we might need to rely on the actual implementation which should fail if it doesn't exist in S3/Cloudinary.
      const res = await request(app)
        .post('/api/v1/resources/confirm')
        .set('Authorization', instructorAuth)
        .send({
          fileKey: 'staging/fake-key-that-does-not-exist.mp4',
          title: 'Fake Resource',
          category: 'VIDEO',
          courseId: course.id
        });

      // Based on TRD, confirm without real object -> 422
      expect(res.status).toBe(422);

      // Verify no resource row was created
      const resources = await prisma.resource.findMany({ where: { title: 'Fake Resource' } });
      expect(resources.length).toBe(0);
    });
  });

  describe('Avatar Upload', () => {
    it('rejects avatar over 5 MB with 422', async () => {
      // We will construct a multipart/form-data request with a >5MB buffer
      const largeBuffer = Buffer.alloc(6 * 1024 * 1024, 'a'); // 6 MB of 'a's

      const res = await request(app)
        .post('/api/v1/users/me/avatar')
        .set('Authorization', studentAuth)
        .attach('avatar', largeBuffer, 'avatar.png');

      expect(res.status).toBe(422);
    });
  });

  describe('Email Webhook Signature Verification', () => {
    it('rejects a webhook with a tampered signature (401)', async () => {
      const payload = JSON.stringify({ event: 'delivered', email: 'test@example.com' });
      
      const res = await request(app)
        .post('/api/v1/webhooks/email')
        .set('x-webhook-signature', 'invalid-signature-123')
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(res.status).toBe(401);
    });

    it('accepts untampered body (200)', async () => {
      const payload = JSON.stringify({ event: 'delivered', email: 'test@example.com' });
      const secret = process.env.EMAIL_WEBHOOK_SECRET;
      
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(payload);
      const signature = hmac.digest('hex');

      const res = await request(app)
        .post('/api/v1/webhooks/email')
        .set('x-webhook-signature', signature)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(res.status).toBe(200);
    });
  });
});
