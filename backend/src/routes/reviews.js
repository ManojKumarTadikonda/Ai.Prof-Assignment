import { Router } from "express";
import {
  Escalation,
  OutreachTask,
  EHRRecord,
  AIAssessment,
  PatientResponse,
} from "../models/index.js";
import { auth, roles, tenantScope } from "../middleware/auth.js";
import { audit } from "../services/audit.js";
const r = Router();
r.use(auth);
r.get(
  "/",
  roles("PLATFORM_ADMIN", "HOSPITAL_ADMIN", "CLINICAL_REVIEWER"),
  async (req, res, next) => {
    try {
      const escalations = await Escalation.find(tenantScope(req))
        .populate("patientId")
        .sort({ createdAt: -1 })
        .lean();
      const taskIds = escalations.map((x) => x.outreachTaskId).filter(Boolean);
      const assessments = await AIAssessment.find({
        ...tenantScope(req),
        outreachTaskId: { $in: taskIds },
      })
        .sort({ assessmentNo: 1, createdAt: 1 })
        .lean();
      const grouped = new Map();
      for (const a of assessments) {
        const k = String(a.outreachTaskId);
        if (!grouped.has(k)) grouped.set(k, []);
        grouped.get(k).push(a);
      }
      res.json(
        escalations.map((x) => ({
          ...x,
          aiAssessments: grouped.get(String(x.outreachTaskId)) || [],
        })),
      );
    } catch (e) {
      next(e);
    }
  },
);
r.post(
  "/:id/resolve",
  roles("PLATFORM_ADMIN", "HOSPITAL_ADMIN", "CLINICAL_REVIEWER"),
  async (req, res, next) => {
    try {
      const e = await Escalation.findById(req.params.id);
      if (!e) return res.status(404).json({ message: "Not found" });
      if (
        req.user.role !== "PLATFORM_ADMIN" &&
        String(e.hospitalId) !== String(req.user.hospitalId)
      )
        return res.status(403).json({ message: "Forbidden" });
      e.status = "RESOLVED";
      e.resolution = req.body.resolution || "Reviewed by clinician";
      e.assignedTo = req.user._id;
      await e.save();
      await OutreachTask.findByIdAndUpdate(e.outreachTaskId, {
        status: "COMPLETED",
        completedAt: new Date(),
      });
      if (req.body.updateEhr) {
        await EHRRecord.create({
          hospitalId: e.hospitalId,
          patientId: e.patientId,
          encounterId: `REVIEW-${e._id}`,
          followUpStatus: "CLINICIAN_REVIEWED",
          summary: e.resolution,
          source: "clinical_review",
          updatedBy: String(req.user._id),
        });
      }
      await audit({
        hospitalId: e.hospitalId,
        actorType: "USER",
        actorId: String(req.user._id),
        action: "ESCALATION_RESOLVED",
        entityType: "Escalation",
        entityId: String(e._id),
        details: { updateEhr: Boolean(req.body.updateEhr) },
      });
      res.json(e);
    } catch (e) {
      next(e);
    }
  },
);
export default r;
