import { Router } from "express";
import { Escalation, OutreachTask, EHRRecord, AIAssessment, PatientResponse, User } from "../models/index.js";
import { auth, roles, tenantScope } from "../middleware/auth.js";
import { audit } from "../services/audit.js";
import { updateMockEHR } from "../services/tools/index.js";

const r = Router();
r.use(auth);
const reviewerRoles = roles("PLATFORM_ADMIN", "HOSPITAL_ADMIN", "CLINICAL_REVIEWER");

r.get("/", reviewerRoles, async (req, res, next) => {
  try {
    const escalations = await Escalation.find(tenantScope(req)).populate("patientId assignedTo").sort({ createdAt: -1 }).lean();
    const taskIds = escalations.map((x) => x.outreachTaskId).filter(Boolean);
    const assessments = await AIAssessment.find({ ...tenantScope(req), outreachTaskId: { $in: taskIds } }).sort({ assessmentNo: 1, createdAt: 1 }).lean();
    const responses = await PatientResponse.find({ ...tenantScope(req), outreachTaskId: { $in: taskIds } }).sort({ createdAt: 1 }).lean();
    const grouped = new Map();
    for (const a of assessments) { const k = String(a.outreachTaskId); if (!grouped.has(k)) grouped.set(k, []); grouped.get(k).push(a); }
    const responseMap = new Map();
    for (const x of responses) { const k = String(x.outreachTaskId); if (!responseMap.has(k)) responseMap.set(k, []); responseMap.get(k).push(x); }
    res.json(escalations.map((x) => ({ ...x, aiAssessments: grouped.get(String(x.outreachTaskId)) || [], responses: responseMap.get(String(x.outreachTaskId)) || [] })));
  } catch (e) { next(e); }
});

r.get("/reviewers", reviewerRoles, async (req, res, next) => {
  try { res.json(await User.find({ ...tenantScope(req), role: "CLINICAL_REVIEWER", active: true }).select("name email role").lean()); }
  catch (e) { next(e); }
});

r.post("/:id/assign", reviewerRoles, async (req, res, next) => {
  try {
    const e = await Escalation.findOne({ _id: req.params.id, ...tenantScope(req) });
    if (!e) return res.status(404).json({ message: "Escalation not found" });
    const assignedTo = req.body.userId || req.user._id;
    const user = await User.findOne({ _id: assignedTo, hospitalId: e.hospitalId, role: "CLINICAL_REVIEWER", active: true });
    if (!user && req.user.role !== "PLATFORM_ADMIN") return res.status(400).json({ message: "Reviewer is not authorized for this hospital" });
    e.assignedTo = assignedTo;
    e.status = "ASSIGNED";
    console.log(`[REVIEW] Escalation assigned | escalation=${e._id} | reviewer=${assignedTo}`);
    await e.save();
    await audit({ hospitalId: e.hospitalId, actorType: "USER", actorId: String(req.user._id), action: "ESCALATION_ASSIGNED", entityType: "Escalation", entityId: String(e._id), details: { assignedTo: String(assignedTo) } });
    res.json(e);
  } catch (e) { next(e); }
});

r.post("/:id/acknowledge", reviewerRoles, async (req, res, next) => {
  try {
    const e = await Escalation.findOne({ _id: req.params.id, ...tenantScope(req) });
    if (!e) return res.status(404).json({ message: "Escalation not found" });
    e.assignedTo = e.assignedTo || req.user._id;
    e.status = "IN_REVIEW";
    console.log(`[REVIEW] Escalation acknowledged | escalation=${e._id}`);
    await e.save();
    res.json(e);
  } catch (err) { next(err); }
});

r.post("/:id/wait", reviewerRoles, async (req, res, next) => {
  try {
    const e = await Escalation.findOneAndUpdate({ _id: req.params.id, ...tenantScope(req) }, { $set: { status: "WAITING_FOR_INFORMATION" } }, { returnDocument: 'after' });
    if (!e) return res.status(404).json({ message: "Escalation not found" });
    res.json(e);
  } catch (err) { next(err); }
});

r.post("/:id/resolve", reviewerRoles, async (req, res, next) => {
  try {
    const e = await Escalation.findOne({ _id: req.params.id, ...tenantScope(req) });
    if (!e) return res.status(404).json({ message: "Not found" });
    e.status = req.body.close ? "CLOSED" : "RESOLVED";
    console.log(`[REVIEW] Resolving escalation | escalation=${e._id} | status=${e.status}`);
    e.resolution = req.body.resolution || "Reviewed by clinician";
    e.assignedTo = e.assignedTo || req.user._id;
    e.resolvedAt = new Date();
    e.resolutionTimestamp = new Date();
    await e.save();
    await OutreachTask.findOneAndUpdate({ _id: e.outreachTaskId, hospitalId: e.hospitalId }, { $set: { status: "COMPLETED", completedAt: new Date(), aiProcessingStatus: "COMPLETED" } });
    if (req.body.updateEhr) {
      await updateMockEHR({ hospitalId: e.hospitalId }, "follow_up", { hospitalId: e.hospitalId, patientId: e.patientId, outreachTaskId: e.outreachTaskId, summary: e.resolution });
    }
    console.log(`[REVIEW] Escalation resolved and task completed | escalation=${e._id} | task=${e.outreachTaskId}`);
    await audit({ hospitalId: e.hospitalId, actorType: "USER", actorId: String(req.user._id), action: "ESCALATION_RESOLVED", entityType: "Escalation", entityId: String(e._id), details: { updateEhr: Boolean(req.body.updateEhr) } });
    res.json(e);
  } catch (err) { next(err); }
});

export default r;
