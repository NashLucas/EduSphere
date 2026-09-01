import * as certificatesService from './certificates.service.js';
import { apiResponse } from '../../utils/api-response.js';

export const verifyCertificate = async (req, res, next) => {
  try {
    const { certificateNo } = req.params;
    const details = await certificatesService.verifyCertificate(certificateNo);
    return apiResponse.success(res, details, 'Certificate verified successfully');
  } catch (err) {
    next(err);
  }
};

export const getMyCertificates = async (req, res, next) => {
  try {
    const certificates = await certificatesService.getMyCertificates(req.user.id);
    return apiResponse.success(res, certificates, 'Certificates retrieved successfully');
  } catch (err) {
    next(err);
  }
};

export const downloadCertificate = async (req, res, next) => {
  try {
    const { id } = req.params;
    const reqProtocol = req.protocol;
    const reqHost = req.get('host');
    
    const url = await certificatesService.getCertificateDownloadUrl(req.user.id, id, reqProtocol, reqHost);
    
    // Redirect to the stored URL
    return res.redirect(url);
  } catch (err) {
    next(err);
  }
};
