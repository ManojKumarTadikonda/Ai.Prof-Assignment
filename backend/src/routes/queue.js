import { Router } from "express";
import {
  OutreachTask,
  Patient,
  Campaign,
  Hospital,
  OutreachSession,
  AIAssessment,
  EHRRecord,
  PatientResponse,
} from "../models/index.js";
import { auth, tenantScope, roles } from "../middleware/auth.js";
import { priorityScore } from "../utils/priority.js";
import { randomToken, hashToken } from "../utils/security.js";
import { sendOutreachEmail } from "../services/email.js";
import { audit } from "../services/audit.js";
import { env } from "../config/env.js";
const r = Router();
r.use(auth);
r.get("/", async (req, res, next) => {
  try {
    const tasks = await OutreachTask.find(tenantScope(req))
      .populate("patientId campaignId")
      .sort({ priorityScore: -1, createdAt: 1 })
      .limit(100)
      .lean();

    const taskIds = tasks.map((t) => t._id);
    const assessments = await AIAssessment.find({
      ...tenantScope(req),
      outreachTaskId: { $in: taskIds },
    })
      .sort({ assessmentNo: -1, createdAt: -1 })
      .lean();

    const latest = new Map();
    for (const a of assessments) {
      const key = String(a.outreachTaskId);
      if (!latest.has(key)) latest.set(key, a);
    }

    res.json(
      tasks.map((task) => ({
        ...task,
        latestAIAssessment: latest.get(String(task._id)) || null,
      })),
    );
  } catch (e) {
    next(e);
  }
});

r.get("/:id/detail", async (req, res, next) => {
  try {
    const task = await OutreachTask.findOne({
      _id: req.params.id,
      ...tenantScope(req),
    })
      .populate("patientId campaignId hospitalId")
      .lean();

    if (!task) return res.status(404).json({ message: "Outreach task not found" });

    const [ehr, responses, assessments] = await Promise.all([
      EHRRecord.find({ ...tenantScope(req), patientId: task.patientId._id })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      PatientResponse.find({ ...tenantScope(req), outreachTaskId: task._id })
        .sort({ createdAt: 1 })
        .lean(),
      AIAssessment.find({ ...tenantScope(req), outreachTaskId: task._id })
        .sort({ assessmentNo: 1, createdAt: 1 })
        .lean(),
    ]);

    const campaignQuestions = new Map(
      (task.campaignId?.questions || []).map((q) => [q.id, q.text]),
    );

    res.json({
      task,
      patient: task.patientId,
      campaign: task.campaignId,
      hospital: task.hospitalId,
      ehr,
      responses: responses.map((r) => ({
        ...r,
        question: campaignQuestions.get(r.questionId) || r.questionId,
      })),
      assessments,
    });
  } catch (e) {
    next(e);
  }
});
r.post(
  "/process",
  roles("PLATFORM_ADMIN", "HOSPITAL_ADMIN", "CAMPAIGN_MANAGER"),
  async (req, res, next) => {
    try {
      const scope = tenantScope(req);
      const hospitals = await Hospital.find(
        req.user.role === "PLATFORM_ADMIN" ? {} : { _id: req.user.hospitalId },
      );
      let sent = 0;
      for (const h of hospitals) {
        const active = await OutreachTask.countDocuments({
          hospitalId: h._id,
          status: "CALLING",
        });
        const capacity = Math.max(0, h.outboundCapacity - active);
        if (!capacity) continue;
        const tasks = await OutreachTask.find({
          hospitalId: h._id,
          status: { $in: ["PENDING", "RETRY_SCHEDULED"] },
          $or: [
            { nextAttemptAt: null },
            { nextAttemptAt: { $lte: new Date() } },
          ],
        })
          .sort({ priorityScore: -1, createdAt: 1 })
          .limit(capacity);
        for (const t of tasks) {
          const patient = await Patient.findById(t.patientId);
          const campaign = await Campaign.findById(t.campaignId);
          if (!patient || !campaign) continue;
          const token = randomToken();
          await OutreachSession.create({
            hospitalId: h._id,
            patientId: patient._id,
            campaignId: campaign._id,
            outreachTaskId: t._id,
            tokenHash: hashToken(token),
            expiresAt: new Date(Date.now() + 72 * 3600000),
          });
          const link = `${env.appUrl}/patient/followup/${token}`;
          console.log(`[OUTREACH] Sending email to ${patient.email} for task ${t._id} with link ${link}`,
          );
          try {
            await sendOutreachEmail({
              to: patient.email,
              patientName: patient.name,
              link,
              hospitalName: h.name,
            });
            t.status = "SCHEDULED";
            t.attempts += 1;
            t.contactedAt = new Date();
            t.priorityScore = priorityScore({ patient, campaign, task: t });
            await t.save();
            await audit({
              hospitalId: h._id,
              action: "OUTREACH_SENT",
              entityType: "OutreachTask",
              entityId: String(t._id),
              details: { attempt: t.attempts },
            });
            sent++;
          } catch (e) {
            t.status =
              t.attempts + 1 >= h.retry.maxAttempts
                ? "MANUAL_FOLLOW_UP"
                : "RETRY_SCHEDULED";
            t.lastError = e.message;
            t.nextAttemptAt = new Date(
              Date.now() + h.retry.backoffMinutes * 60000,
            );
            await t.save();
          }
        }
      }
      res.json({ sent });
    } catch (e) {
      next(e);
    }
  },
);
export default r;
