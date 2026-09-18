import { Router } from "express";
import {
  OutreachTask,
  Patient,
  Campaign,
  Hospital,
  AIAssessment,
  EHRRecord,
  PatientResponse,
  Escalation,
} from "../models/index.js";
import { auth, tenantScope, roles } from "../middleware/auth.js";
import { priorityScore, explainPriority } from "../utils/priority.js";
import { scheduleCallback } from "../services/tools/index.js";
import { processQueueOnce, reconcileHospitalCapacity } from "../services/queue.js";
import { validateBody, callbackSchema } from "../middleware/requestValidation.js";

const r = Router();
r.use(auth);

r.get("/", async (req, res, next) => {
  try {
    const tasks = await OutreachTask.find(tenantScope(req))
      .populate("patientId campaignId")
      .sort({ priorityScore: -1, deadline: 1, createdAt: 1 })
      .limit(200)
      .lean();
    const taskIds = tasks.map((t) => t._id);
    const assessments = await AIAssessment.find({ ...tenantScope(req), outreachTaskId: { $in: taskIds } })
      .sort({ assessmentNo: -1, createdAt: -1 }).lean();
    const latest = new Map();
    for (const a of assessments) if (!latest.has(String(a.outreachTaskId))) latest.set(String(a.outreachTaskId), a);
    res.json(tasks.map((task) => ({ ...task, latestAIAssessment: latest.get(String(task._id)) || null })));
  } catch (e) { next(e); }
});

r.get("/health", roles("PLATFORM_ADMIN", "HOSPITAL_ADMIN", "CAMPAIGN_MANAGER"), async (req, res, next) => {
  try {
    const s = tenantScope(req);
    const hospitals = await Hospital.find(req.user.role === "PLATFORM_ADMIN" ? {} : { _id: req.user.hospitalId }).lean();
    const result = [];
    for (const h of hospitals) {
      await reconcileHospitalCapacity(h._id);
      const [pending, active, retries, manual, cutoffRisk, stuck, oldest] = await Promise.all([
        OutreachTask.countDocuments({ hospitalId: h._id, status: { $in: ["PENDING", "RETRY_SCHEDULED", "CALLBACK_SCHEDULED", "SCHEDULED"] } }),
        OutreachTask.countDocuments({ hospitalId: h._id, status: { $in: ["RESERVED", "CALLING", "CONNECTED"] } }),
        OutreachTask.countDocuments({ hospitalId: h._id, status: "RETRY_SCHEDULED" }),
        OutreachTask.countDocuments({ hospitalId: h._id, status: "MANUAL_FOLLOW_UP" }),
        OutreachTask.countDocuments({ hospitalId: h._id, status: { $nin: ["COMPLETED", "ESCALATED", "MANUAL_FOLLOW_UP", "FAILED"] }, deadline: { $lte: new Date(Date.now() + 6 * 3600000) } }),
        OutreachTask.countDocuments({ hospitalId: h._id, status: { $in: ["RESERVED", "CALLING", "CONNECTED"] }, leaseExpiresAt: { $lt: new Date() } }),
        OutreachTask.findOne({ hospitalId: h._id, status: { $in: ["PENDING", "RETRY_SCHEDULED", "CALLBACK_SCHEDULED"] } }).sort({ createdAt: 1 }).select("createdAt").lean(),
      ]);
      result.push({ hospitalId: h._id, hospitalName: h.name, queueDepth: pending, activeCalls: active, capacity: h.outboundCapacity, retryBacklog: retries, manualFollowUps: manual, cutoffRisk, stuckTasks: stuck, oldestPendingMinutes: oldest ? Math.round((Date.now() - new Date(oldest.createdAt).getTime()) / 60000) : 0 });
    }
    res.json({ hospitals: result, scope: s });
  } catch (e) { next(e); }
});

r.get("/:id/detail", async (req, res, next) => {
  try {
    const task = await OutreachTask.findOne({ _id: req.params.id, ...tenantScope(req) }).populate("patientId campaignId hospitalId").lean();
    if (!task) return res.status(404).json({ message: "Outreach task not found" });
    const [ehr, responses, assessments] = await Promise.all([
      EHRRecord.find({ ...tenantScope(req), patientId: task.patientId._id }).sort({ createdAt: -1 }).limit(20).lean(),
      PatientResponse.find({ ...tenantScope(req), outreachTaskId: task._id }).sort({ createdAt: 1 }).lean(),
      AIAssessment.find({ ...tenantScope(req), outreachTaskId: task._id }).sort({ assessmentNo: 1, createdAt: 1 }).lean(),
    ]);
    const campaignQuestions = new Map((task.campaignId?.questions || []).map((q) => [q.id, q.text]));
    res.json({ task, patient: task.patientId, campaign: task.campaignId, hospital: task.hospitalId, ehr, responses: responses.map((x) => ({ ...x, question: campaignQuestions.get(x.questionId) || x.questionId })), assessments, priorityBreakdown: explainPriority({ patient: task.patientId, campaign: task.campaignId, task }) });
  } catch (e) { next(e); }
});

r.post("/process", roles("PLATFORM_ADMIN", "HOSPITAL_ADMIN", "CAMPAIGN_MANAGER"), async (req, res, next) => {
  try {
    const hospitalIds = req.user.role === "PLATFORM_ADMIN" ? null : [req.user.hospitalId];
    const summary = await processQueueOnce({ simulation: false, hospitalIds });
    res.json(summary);
  } catch (e) { next(e); }
});

r.post("/:id/callback", roles("PLATFORM_ADMIN", "HOSPITAL_ADMIN", "CAMPAIGN_MANAGER", "CLINICAL_REVIEWER"), validateBody(callbackSchema), async (req, res, next) => {
  try {
    const task = await OutreachTask.findOne({ _id: req.params.id, ...tenantScope(req) }).lean();
    if (!task) return res.status(404).json({ message: "Outreach task not found" });
    const updated = await scheduleCallback({ hospitalId: task.hospitalId }, task._id, req.body.callbackAt);
    res.json(updated);
  } catch (e) { next(e); }
});

r.post("/:id/recalculate-priority", roles("PLATFORM_ADMIN", "HOSPITAL_ADMIN", "CAMPAIGN_MANAGER"), async (req, res, next) => {
  try {
    const task = await OutreachTask.findOne({ _id: req.params.id, ...tenantScope(req) });
    if (!task) return res.status(404).json({ message: "Outreach task not found" });
    const [patient, campaign] = await Promise.all([Patient.findById(task.patientId).lean(), Campaign.findById(task.campaignId).lean()]);
    task.priorityScore = priorityScore({ patient, campaign, task });
    await task.save();
    res.json({ priorityScore: task.priorityScore, breakdown: explainPriority({ patient, campaign, task }) });
  } catch (e) { next(e); }
});

export default r;
