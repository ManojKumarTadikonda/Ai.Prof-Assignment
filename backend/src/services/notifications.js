import { Notification, Hospital } from "../models/index.js";
import { audit } from "./audit.js";
import { sendOutreachEmail } from "./email.js";

export async function notifyHospital({ hospitalId, type, subject, message, entityType, entityId }) {
  const hospital = await Hospital.findById(hospitalId).lean();
  const recipients = (hospital?.escalationContacts || []).map((x) => x.email).filter(Boolean);
  if (hospital?.contactEmail) recipients.push(hospital.contactEmail);
  const uniqueRecipients = [...new Set(recipients)];
  console.log(`[NOTIFICATION] Preparing ${type} notification | hospital=${hospitalId} | recipients=${uniqueRecipients.length}`);
  const results = [];
  for (const recipient of uniqueRecipients) {
    const notification = await Notification.create({ hospitalId, type, recipient, subject, message, entityType, entityId });
    try {
      await sendOutreachEmail({ to: recipient, patientName: "Care team", link: "", hospitalName: hospital.name, subject, customMessage: message });
      notification.status = "SENT";
      console.log(`[NOTIFICATION] Delivered | recipient=${recipient} | type=${type}`);
      notification.deliveredAt = new Date();
      await notification.save();
      results.push(notification);
    } catch (error) {
      notification.status = "FAILED";
      console.error(`[NOTIFICATION] Delivery failed | recipient=${recipient} | type=${type} | error=${error?.message || "unknown"}`);
      notification.error = error?.message || "Notification delivery failed";
      await notification.save();
      results.push(notification);
    }
  }
  await audit({ hospitalId, action: "NOTIFICATION_DELIVERY", entityType, entityId: String(entityId), details: { type, recipients: uniqueRecipients.length } });
  return results;
}
