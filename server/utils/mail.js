const { env } = require("../config/env");

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function generateEmailTemplate({ title, content, buttonText, buttonLink, footerText }) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${escapeHtml(title)}</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f4;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f4f4f4;">
        <tr>
          <td style="padding: 40px 20px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
              <!-- Header -->
              <tr>
                <td style="background: linear-gradient(135deg, #2c4a6b 0%, #52A5CE 100%); padding: 30px; text-align: center;">
                  <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600;">FirstSavvy</h1>
                </td>
              </tr>
              <!-- Content -->
              <tr>
                <td style="padding: 40px 30px;">
                  <h2 style="margin: 0 0 20px 0; color: #1e293b; font-size: 24px; font-weight: 600;">${escapeHtml(title)}</h2>
                  <div style="color: #475569; line-height: 1.7; font-size: 16px;">
                    ${content}
                  </div>
                  ${buttonText && buttonLink ? `
                  <div style="text-align: center; margin: 35px 0;">
                    <a href="${escapeHtml(buttonLink)}" 
                       style="background: linear-gradient(135deg, #2c4a6b 0%, #52A5CE 100%); color: #ffffff; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; display: inline-block; box-shadow: 0 4px 6px rgba(44, 74, 107, 0.25); transition: all 0.3s ease;">
                      ${escapeHtml(buttonText)}
                    </a>
                  </div>
                  ` : ''}
                  ${buttonLink ? `
                  <p style="color: #94a3b8; font-size: 13px; text-align: center; margin: 25px 0 0 0; line-height: 1.5;">
                    If the button doesn't work, copy and paste this link into your browser:<br>
                    <a href="${escapeHtml(buttonLink)}" style="color: #2c4a6b; word-break: break-all;">${escapeHtml(buttonLink)}</a>
                  </p>
                  ` : ''}
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="background-color: #f8fafc; padding: 25px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
                  <p style="margin: 0; color: #94a3b8; font-size: 13px; line-height: 1.6;">
                    ${footerText || 'If you did not request this email, you can safely ignore it.'}
                  </p>
                  <p style="margin: 15px 0 0 0; color: #cbd5e1; font-size: 12px;">
                    © ${new Date().getFullYear()} FirstSavvy. All rights reserved.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

const sendViaStagingRelay = async (to, subject, text, html) => {
  const fromAddress = env.mailFrom && !String(env.mailFrom).toLowerCase().includes("development")
    ? env.mailFrom
    : "FirstSavvy <no-reply@firstsavvy.com>";

  const response = await fetch(
    "https://emailserver.projectstagingapp.com/api/emails",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        auth: {
          user: fromAddress,
          key: env.mailApiKey,
        },
        data: {
          from: fromAddress,
          fromName: "FirstSavvy",
          senderName: "FirstSavvy",
          to: to,
          subject: subject,
          text: html || text,
          html: html || text,
        },
      }),
    },
  );

  const data = await response.json().catch(() => null);

  if (response.ok && data?.status !== false) {
    console.log("Email sent successfully via email server to:", to);
    return { sent: true };
  }

  console.warn(
    `Email server rejected send to: ${to}. Reason: ${data?.message || response.statusText}. ` +
    `Note: To send real emails, please configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in server/.env`
  );
  return { sent: false, reason: data?.message || response.statusText };
};

const sendEmail = async (to, subject, text, html) => {
  const { isEmailConfigured, sendEmail: sendSmtpEmail } = require("./email");
  let smtpError = null;

  if (isEmailConfigured()) {
    try {
      await sendSmtpEmail({ to, subject, text, html });
      return { sent: true, channel: "smtp" };
    } catch (error) {
      smtpError = error;
      console.warn("SMTP send failed, falling back to email server:", error.message);
    }
  }

  if (!env.mailApiKey) {
    const error = new Error(smtpError?.message || "Email is not configured");
    error.code = "EMAIL_NOT_CONFIGURED";
    throw error;
  }

  const relayResult = await sendViaStagingRelay(to, subject, text, html);
  if (!relayResult?.sent) {
    const error = new Error(relayResult?.reason || smtpError?.message || "Email delivery failed");
    error.code = "EMAIL_DELIVERY_FAILED";
    throw error;
  }

  return relayResult;
};

module.exports = {
  sendEmail,
  sendViaStagingRelay,
  generateEmailTemplate,
  escapeHtml,
};
