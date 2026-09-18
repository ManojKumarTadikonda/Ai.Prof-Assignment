import { Router } from "express";
import { OutreachTask, Escalation, EHRRecord, Patient, Campaign, AIAssessment, WorkflowEvent, Notification } from "../models/index.js";
import { auth, tenantScope } from "../middleware/auth.js";

const r = Router();
r.use(auth);

r.get("/summary", async (req, res, next) => {
  try {
    const s = tenantScope(req);
    const activeScope = { ...s, status: { $in: ["RESERVED", "CALLING", "CONNECTED"] } };
    const pendingScope = { ...s, status: { $in: ["PENDING", "SCHEDULED", "RETRY_SCHEDULED", "CALLBACK_SCHEDULED"] } };
    const [patients, pending, active, completed, escalations, ehr, aiProcessing, aiFailed, aiHumanReview, retries, manualFollowUps, cutoffRisk, failedTasks, stuckTasks, oldest, campaigns, aiAssessments, workflowFailures, notificationFailures] = await Promise.all([
      Patient.countDocuments(s),
      OutreachTask.countDocuments(pendingScope),
      OutreachTask.countDocuments(activeScope),
      OutreachTask.countDocuments({ ...s, status: "COMPLETED" }),
      Escalation.countDocuments({ ...s, status: { $in: ["OPEN", "ASSIGNED", "IN_REVIEW"] } }),
      EHRRecord.countDocuments(s),
      OutreachTask.countDocuments({ ...s, aiProcessingStatus: "PROCESSING" }),
      OutreachTask.countDocuments({ ...s, aiProcessingStatus: "FAILED" }),
      OutreachTask.countDocuments({ ...s, aiProcessingStatus: "HUMAN_REVIEW" }),
      OutreachTask.countDocuments({ ...s, status: "RETRY_SCHEDULED" }),
      OutreachTask.countDocuments({ ...s, status: "MANUAL_FOLLOW_UP" }),
      OutreachTask.countDocuments({ ...s, status: { $nin: ["COMPLETED", "ESCALATED", "MANUAL_FOLLOW_UP", "FAILED"] }, deadline: { $lte: new Date(Date.now() + 6 * 3600000) } }),
      OutreachTask.countDocuments({ ...s, status: "FAILED" }),
      OutreachTask.countDocuments({ ...activeScope, leaseExpiresAt: { $lt: new Date() } }),
      OutreachTask.findOne(pendingScope).sort({ createdAt: 1 }).select("createdAt").lean(),
      Campaign.countDocuments(s),
      AIAssessment.countDocuments(s),
      WorkflowEvent.countDocuments({ ...s, status: "FAILED" }),
      Notification.countDocuments({ ...s, status: "FAILED" }),
    ]);
    res.json({
      patients, pending, active, completed, openEscalations: escalations, ehrUpdates: ehr,
      aiProcessing, aiFailed, aiHumanReview, retries, manualFollowUps, cutoffRisk, failedTasks, stuckTasks,
      oldestPendingMinutes: oldest ? Math.max(0, Math.round((Date.now() - new Date(oldest.createdAt).getTime()) / 60000)) : 0,
      campaigns, aiAssessments, workflowFailures, notificationFailures,
    });
  } catch (e) { next(e); }
});

r.get("/campaign/:id", async (req, res, next) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, ...tenantScope(req) }).lean();
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    const s = { ...tenantScope(req), campaignId: campaign._id };
    const [eligible, attempted, completed, noAnswer, busy, voicemail, dropped, callbacks, escalated, manual] = await Promise.all([
      OutreachTask.countDocuments(s),
      OutreachTask.countDocuments({ ...s, attempts: { $gt: 0 } }),
      OutreachTask.countDocuments({ ...s, status: "COMPLETED" }),
      OutreachTask.countDocuments({ ...s, status: "NO_ANSWER" }),
      OutreachTask.countDocuments({ ...s, status: "BUSY" }),
      OutreachTask.countDocuments({ ...s, status: "VOICEMAIL" }),
      OutreachTask.countDocuments({ ...s, status: "DROPPED" }),
      OutreachTask.countDocuments({ ...s, status: "CALLBACK_SCHEDULED" }),
      OutreachTask.countDocuments({ ...s, status: "ESCALATED" }),
      OutreachTask.countDocuments({ ...s, status: "MANUAL_FOLLOW_UP" }),
    ]);
    res.json({ eligible, attempted, completed, noAnswer, busy, voicemail, dropped, callbacks, escalated, manualFollowUps: manual });
  } catch (e) { next(e); }
});

export default r;
