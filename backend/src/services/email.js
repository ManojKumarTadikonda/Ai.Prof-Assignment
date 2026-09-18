import sgMail from "@sendgrid/mail";
import { env } from "../config/env.js";
if (env.sendgridKey) sgMail.setApiKey(env.sendgridKey);

export async function sendOutreachEmail({ to, patientName, link, hospitalName, subject, customMessage }) {
  const msg = {
    to,
    from: env.sendgridFrom,
    subject: subject || `${hospitalName} post-discharge follow-up`,
    text: customMessage || `Hello ${patientName}, please complete your follow-up here: ${link}`,
    html: customMessage
      ? `<p>${customMessage}</p>`
      : `<p>Hello ${patientName},</p><p>Please complete your post-discharge follow-up using the secure link below.</p><p><a href="${link}">Complete follow-up</a></p><p>This link is temporary and should not be forwarded.</p>`,
  };
  if (!env.sendgridKey || !env.sendgridFrom) {
    console.log("[EMAIL DEV MODE]", msg);
    return { dev: true };
  }
  console.log("[EMAIL SEND]", msg);
  await sgMail.send(msg);
  return { sent: true };
}
