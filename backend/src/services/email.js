import sgMail from "@sendgrid/mail";
import { env } from "../config/env.js";
if (env.sendgridKey) sgMail.setApiKey(env.sendgridKey);
export async function sendOutreachEmail({
  to,
  patientName,
  link,
  hospitalName,
}) {
  const msg = {
    to,
    from: env.sendgridFrom,
    subject: `${hospitalName} post-discharge follow-up`,
    text: `Hello ${patientName}, please complete your follow-up here: ${link}`,
    html: `<p>Hello ${patientName},</p><p>Please complete your post-discharge follow-up using the secure link below.</p><p><a href="${link}">Complete follow-up</a></p><p>This link is temporary and should not be forwarded.</p>`,
  };
  if (!env.sendgridKey || !env.sendgridFrom) {
    console.log("[EMAIL DEV MODE]", msg);
    return { dev: true };
  }
  await sgMail.send(msg);
  return { sent: true };
}



/**
 * TEST ONLY
 * Sends a simple test email using the SendGrid credentials
 * from .env
 */
export async function testSendEmail(to) {
  if (!env.sendgridKey) {
    throw new Error("SENDGRID_API_KEY is missing");
  }

  if (!env.sendgridFrom) {
    throw new Error("SENDGRID_FROM is missing");
  }

  const msg = {
    to,
    from: env.sendgridFrom,
    subject: "CareFlow SendGrid Test Email",
    text: "This is a test email from the CareFlow healthcare outreach platform.",
    html: `
      <h2>CareFlow SendGrid Test</h2>
      <p>
        If you received this email, SendGrid is configured correctly.
      </p>
      <p>
        This is only a test email.
      </p>
    `,
  };

  console.log("Sending test email...");
  console.log("From:", env.sendgridFrom);
  console.log("To:", to);

  const response = await sgMail.send(msg);

  console.log("SendGrid response:", response[0].statusCode);

  return {
    success: true,
    statusCode: response[0].statusCode,
    to,
  };
}