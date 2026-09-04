import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as certificatesService from '../../../src/modules/certificates/certificates.service.js';
import { makeUser, makeCourse } from '../factories.js';
import prisma from '../../../src/database/index.js';
import * as storage from '../../../src/integrations/storage/index.js';

vi.mock('../../../src/integrations/storage/index.js', () => ({
  uploadBuffer: vi.fn().mockResolvedValue('https://mocked-url.com/cert.pdf')
}));

describe('Certificates Service Integration', () => {
  let user, course, certificate;

  beforeEach(async () => {
    user = await makeUser({ role: 'STUDENT' });
    course = await makeCourse();

    certificate = await prisma.certificate.create({
      data: {
        certificateNo: `CERT-${Date.now()}`,
        userId: user.id,
        courseId: course.id,
        issuedAt: new Date()
      }
    });
  });

  it('verifyCertificate should return details', async () => {
    const details = await certificatesService.verifyCertificate(certificate.certificateNo);
    expect(details.certificateNo).toBe(certificate.certificateNo);
    expect(details.holderName).toBeDefined();
    expect(details.courseTitle).toBeDefined();
  });

  it('verifyCertificate should throw if not found', async () => {
    await expect(certificatesService.verifyCertificate('invalid'))
      .rejects.toThrow('Certificate not found');
  });

  it('getMyCertificates should list certificates', async () => {
    const certs = await certificatesService.getMyCertificates(user.id);
    expect(certs.length).toBe(1);
    expect(certs[0].id).toBe(certificate.id);
  });

  it('getCertificateDownloadUrl should return existing url if present', async () => {
    await prisma.certificate.update({
      where: { id: certificate.id },
      data: { certificateUrl: 'https://existing.com/cert.pdf' }
    });

    const url = await certificatesService.getCertificateDownloadUrl(user.id, certificate.id, 'http', 'localhost');
    expect(url).toBe('https://existing.com/cert.pdf');
  });

  it('getCertificateDownloadUrl should throw if not found', async () => {
    const unknownId = '00000000-0000-0000-0000-000000000000';
    await expect(certificatesService.getCertificateDownloadUrl(user.id, unknownId, 'http', 'localhost'))
      .rejects.toThrow('Certificate not found');
  });

  it('getCertificateDownloadUrl should throw if user is not owner', async () => {
    const otherUser = await makeUser();
    await expect(certificatesService.getCertificateDownloadUrl(otherUser.id, certificate.id, 'http', 'localhost'))
      .rejects.toThrow('You can only download your own certificates');
  });

  it('getCertificateDownloadUrl should lazily generate and upload', async () => {
    const url = await certificatesService.getCertificateDownloadUrl(user.id, certificate.id, 'http', 'localhost');
    expect(url).toBe('https://mocked-url.com/cert.pdf');
    expect(storage.uploadBuffer).toHaveBeenCalled();
  });
});
