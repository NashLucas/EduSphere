import PDFDocument from 'pdfkit';

/**
 * Generates a PDF certificate as a readable stream.
 * @param {Object} params - Certificate details.
 * @param {string} params.studentName - Full name of the student.
 * @param {string} params.courseTitle - Title of the completed course.
 * @param {Date} params.completionDate - Date of completion.
 * @param {string} params.certificateNo - Unique certificate number.
 * @param {string} params.verificationUrl - URL where the certificate can be verified.
 * @returns {PDFDocument} - Readable stream of the PDF.
 */
export function generateCertificateStream({ studentName, courseTitle, completionDate, certificateNo, verificationUrl }) {
  const doc = new PDFDocument({
    layout: 'landscape',
    size: 'A4',
    margins: { top: 50, bottom: 50, left: 50, right: 50 }
  });

  // Background and border
  doc.rect(20, 20, 800, 555).lineWidth(10).stroke('#1e3a8a');
  
  doc
    .fontSize(40)
    .fillColor('#1e3a8a')
    .text('Certificate of Completion', { align: 'center' })
    .moveDown(1);
    
  doc
    .fontSize(20)
    .fillColor('#000000')
    .text('This is to certify that', { align: 'center' })
    .moveDown(1);

  doc
    .fontSize(30)
    .fillColor('#1e3a8a')
    .text(studentName, { align: 'center', underline: true })
    .moveDown(1);

  doc
    .fontSize(20)
    .fillColor('#000000')
    .text('has successfully completed the course', { align: 'center' })
    .moveDown(1);

  doc
    .fontSize(25)
    .fillColor('#1e3a8a')
    .text(courseTitle, { align: 'center' })
    .moveDown(2);

  const dateStr = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(completionDate);

  doc
    .fontSize(15)
    .fillColor('#000000')
    .text(`Date of Completion: ${dateStr}`, { align: 'center' })
    .moveDown(0.5);

  doc
    .fontSize(12)
    .fillColor('#6b7280')
    .text(`Certificate No: ${certificateNo}`, { align: 'center' })
    .moveDown(0.5);

  doc
    .fontSize(12)
    .fillColor('#3b82f6')
    .text(`Verify at: ${verificationUrl}`, { align: 'center', link: verificationUrl });

  doc.end();

  return doc;
}
