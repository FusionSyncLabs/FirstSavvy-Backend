const nodemailer = require('nodemailer');
const { env } = require('../config/env');

let transporter = null;

function isEmailConfigured() {
  return Boolean(env.smtpHost);
}

function getTransporter() {
  if (!isEmailConfigured()) {
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      auth: env.smtpUser ? {
        user: env.smtpUser,
        pass: env.smtpPass
      } : undefined
    });
  }

  return transporter;
}

async function sendEmail({ to, subject, text, html }) {
  const mailer = getTransporter();
  const fromAddress = env.mailFrom && !String(env.mailFrom).toLowerCase().includes('development')
    ? env.mailFrom
    : 'FirstSavvy <no-reply@firstsavvy.com>';

  if (!mailer) {
    try {
      const { sendViaStagingRelay } = require('./mail');
      const relayResult = await sendViaStagingRelay(to, subject, text, html);
      if (relayResult?.sent) {
        return {
          skipped: false,
          messageId: 'staging-relay'
        };
      }
    } catch (relayError) {
      console.warn('Staging email relay fallback failed:', relayError.message);
    }

    if (env.isProduction) {
      throw new Error('SMTP is not configured');
    }

    return {
      skipped: true,
      reason: 'SMTP is not configured'
    };
  }

  const result = await mailer.sendMail({
    from: fromAddress,
    to,
    subject,
    text,
    html
  });

  return {
    skipped: false,
    messageId: result.messageId
  };
}

async function sendPasswordResetEmail({ to, resetUrl, expiresInMinutes }) {
  const { generateEmailTemplate } = require('./mail');
  const html = generateEmailTemplate({
    title: 'Reset Your FirstSavvy Password',
    content: `
      <p>We received a request to reset your FirstSavvy password.</p>
      <p>This link expires in <strong>${expiresInMinutes} minutes</strong>.</p>
    `,
    buttonText: 'Reset Your Password',
    buttonLink: resetUrl,
    footerText: 'If you did not request this password reset, you can safely ignore this email.'
  });

  return sendEmail({
    to,
    subject: 'Reset your FirstSavvy password',
    text: [
      'We received a request to reset your FirstSavvy password.',
      '',
      `Reset your password: ${resetUrl}`,
      '',
      `This link expires in ${expiresInMinutes} minutes.`,
      'If you did not request this, you can ignore this email.'
    ].join('\n'),
    html
  });
}

async function sendTwoFactorEmail(to, code) {
  const { generateEmailTemplate } = require('./mail');
  const html = generateEmailTemplate({
    title: 'Two-Factor Authentication Code',
    content: `
      <p style="margin: 0 0 20px 0;">Your verification code is:</p>
      <div style="background-color: #f0f9ff; border: 2px solid #2c4a6b; border-radius: 8px; padding: 20px; text-align: center; margin: 25px 0;">
        <span style="font-size: 32px; font-weight: bold; color: #2c4a6b; letter-spacing: 4px;">${escapeHtml(code)}</span>
      </div>
      <p style="margin: 20px 0;">This code will expire in <strong>5 minutes</strong>.</p>
    `,
    footerText: 'If you did not request this code, you can safely ignore this email.'
  });

  return sendEmail({
    to,
    subject: 'Your FirstSavvy Two-Factor Authentication Code',
    text: [
      'Your verification code is:',
      '',
      code,
      '',
      'This code will expire in 5 minutes.',
      'If you did not request this code, you can ignore this email.'
    ].join('\n'),
    html
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  isEmailConfigured,
  sendEmail,
  sendPasswordResetEmail,
  sendTwoFactorEmail
};
