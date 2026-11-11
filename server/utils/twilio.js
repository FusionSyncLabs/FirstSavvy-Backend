const twilio = require('twilio');
const { env } = require('../config/env');

let twilioClient = null;
function getTwilioClient() {
  if (!twilioClient && env.twilioAccountSid && env.twilioAuthToken) {
    twilioClient = twilio(env.twilioAccountSid, env.twilioAuthToken);
  }
  return twilioClient;
}

async function sendSMS(to, message, customCode = null) {
  // Always log the code in console for development and instant visibility
  console.log(`📱 [Phone Verification Code] For ${to}: ${customCode || message}`);

  const client = getTwilioClient();
  if (!client) {
    console.warn(`[SMS] Twilio credentials not configured. Verification code logged above.`);
    return;
  }

  // 1. If Twilio Verify service is configured (recommended for OTP)
  if (env.twilioVerifyServiceSid) {
    try {
      const payload = { to, channel: 'sms' };
      if (customCode) {
        payload.customCode = customCode;
      }
      const verification = await client.verify.v2
        .services(env.twilioVerifyServiceSid)
        .verifications
        .create(payload);
      console.log(`[Twilio Verify] Sent SMS to ${to}, status: ${verification.status}`);
      return verification;
    } catch (error) {
      if (customCode) {
        try {
          const fallbackVerification = await client.verify.v2
            .services(env.twilioVerifyServiceSid)
            .verifications
            .create({ to, channel: 'sms' });
          console.log(`[Twilio Verify] Sent standard Verify SMS to ${to}, status: ${fallbackVerification.status}`);
          return fallbackVerification;
        } catch (fallbackError) {
          console.error(`[Twilio Verify Error] Failed to send via Verify Service:`, fallbackError.message);
        }
      } else {
        console.error(`[Twilio Verify Error] Failed to send via Verify Service:`, error.message);
      }
    }
  }

  // 2. Fallback to Messages API if a phone number is configured
  if (env.twilioPhoneNumber) {
    try {
      const result = await client.messages.create({
        body: message,
        from: env.twilioPhoneNumber,
        to: to
      });
      console.log(`[Twilio Messages] SMS sent successfully to ${to}, sid: ${result.sid}`);
      return result;
    } catch (error) {
      console.error('Failed to send SMS via Messages API:', error.message);
    }
  }
}

async function verifyTwilioCode(to, code) {
  const client = getTwilioClient();
  if (!client || !env.twilioVerifyServiceSid) {
    return false;
  }

  try {
    const check = await client.verify.v2
      .services(env.twilioVerifyServiceSid)
      .verificationChecks
      .create({ to, code });
    return check.status === 'approved';
  } catch (error) {
    console.warn(`[Twilio Verify Check] Could not verify code via Twilio Verify for ${to}:`, error.message);
    return false;
  }
}

function normalizePhoneNumber(phone) {
  let cleaned = String(phone || '').replace(/\D/g, '');
  
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = cleaned.substring(1);
  }
  
  if (cleaned.length === 10) {
    cleaned = '1' + cleaned;
  }
  
  return '+' + cleaned;
}

async function sendTwoFactorSms(to, code) {
  const message = `Your FirstSavvy verification code is: ${code}. This code will expire in 5 minutes. If you did not request this code, you can ignore this message.`;
  return sendSMS(to, message, code);
}

module.exports = {
  sendSMS,
  verifyTwilioCode,
  normalizePhoneNumber,
  sendTwoFactorSms
};
