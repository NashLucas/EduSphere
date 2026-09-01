import prisma from '../../database/index.js';
import { NotFoundError, ForbiddenError } from '../../utils/app-error.js';
import { generateCertificateStream } from '../../utils/certificate-generator.js';
import { uploadBuffer } from '../../integrations/storage/index.js';

const streamToBuffer = (stream) => {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
};

export const verifyCertificate = async (certificateNo) => {
  const certificate = await prisma.certificate.findUnique({
    where: { certificateNo },
    include: {
      user: { select: { fullName: true } },
      course: { select: { title: true } }
    }
  });

  if (!certificate) {
    throw NotFoundError('Certificate not found');
  }

  return {
    certificateNo: certificate.certificateNo,
    issuedAt: certificate.issuedAt,
    holderName: certificate.user.fullName,
    courseTitle: certificate.course.title
  };
};

export const getMyCertificates = async (userId) => {
  return await prisma.certificate.findMany({
    where: { userId },
    include: {
      course: { select: { title: true, slug: true } }
    },
    orderBy: { issuedAt: 'desc' }
  });
};

export const getCertificateDownloadUrl = async (userId, certificateId, reqProtocol, reqHost) => {
  const certificate = await prisma.certificate.findUnique({
    where: { id: certificateId },
    include: {
      user: true,
      course: true
    }
  });

  if (!certificate) {
    throw NotFoundError('Certificate not found');
  }

  if (certificate.userId !== userId) {
    throw ForbiddenError('You can only download your own certificates');
  }

  if (certificate.certificateUrl) {
    return certificate.certificateUrl;
  }

  // Lazy Render
  const verificationUrl = `${reqProtocol}://${reqHost}/verify/${certificate.certificateNo}`;
  
  const docStream = generateCertificateStream({
    studentName: certificate.user.fullName,
    courseTitle: certificate.course.title,
    completionDate: certificate.issuedAt,
    certificateNo: certificate.certificateNo,
    verificationUrl
  });

  const buffer = await streamToBuffer(docStream);
  
  const fileKey = `certificates/${certificate.id}.pdf`;
  const uploadUrl = await uploadBuffer(fileKey, buffer, 'application/pdf');

  const updated = await prisma.certificate.update({
    where: { id: certificateId },
    data: { certificateUrl: uploadUrl }
  });

  return updated.certificateUrl;
};
