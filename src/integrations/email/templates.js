export const templates = {
  'verification': (fields) => ({
    subject: 'Verify your EduSphere account',
    html: `
      <h1>Welcome to EduSphere, ${fields.fullName}!</h1>
      <p>Please verify your email address by clicking the link below:</p>
      <a href="${fields.verifyUrl}">Verify Email</a>
      <p>This link expires in ${fields.expiresIn}.</p>
    `
  }),
  'password-reset': (fields) => ({
    subject: 'Reset your EduSphere password',
    html: `
      <h1>Password Reset</h1>
      <p>Hello ${fields.fullName},</p>
      <p>Click the link below to reset your password:</p>
      <a href="${fields.resetUrl}">Reset Password</a>
      <p>This link expires in ${fields.expiresIn}.</p>
    `
  }),
  'enrollment-confirmation': (fields) => ({
    subject: `Welcome to ${fields.courseTitle}`,
    html: `
      <h1>Enrollment Confirmed</h1>
      <p>Hello ${fields.fullName},</p>
      <p>You have successfully enrolled in <strong>${fields.courseTitle}</strong>.</p>
      ${fields.courseUrl ? `<p><a href="${fields.courseUrl}">Go to Course</a></p>` : ''}
    `
  }),
  'course-completion': (fields) => ({
    subject: `Congratulations on completing ${fields.courseTitle}!`,
    html: `
      <h1>Course Completed!</h1>
      <p>Hello ${fields.fullName},</p>
      <p>Congratulations on completing <strong>${fields.courseTitle}</strong>!</p>
      ${fields.certificateUrl ? `<p>You can view your certificate here: <a href="${fields.certificateUrl}">View Certificate</a></p>` : ''}
    `
  }),
  'takedown-notice': (fields) => ({
    subject: `Notice: Your course "${fields.courseTitle}" has been unpublished`,
    html: `
      <h1>Course Takedown Notice</h1>
      <p>Hello ${fields.fullName},</p>
      <p>Your course <strong>${fields.courseTitle}</strong> has been unpublished by an administrator.</p>
      <p>Reason: ${fields.reason}</p>
    `
  }),
  'account-status': (fields) => ({
    subject: `Account Status Update: ${fields.status}`,
    html: `
      <h1>Account Status Update</h1>
      <p>Hello ${fields.fullName},</p>
      <p>Your account status has been updated to: <strong>${fields.status}</strong></p>
      ${fields.reason ? `<p>Reason: ${fields.reason}</p>` : ''}
    `
  })
};
