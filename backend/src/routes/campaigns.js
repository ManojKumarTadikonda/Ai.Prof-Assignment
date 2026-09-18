import { Router } from "express";
import { Campaign, Patient, OutreachTask, Protocol } from "../models/index.js";
import { auth, roles, tenantScope } from "../middleware/auth.js";
import { priorityScore } from "../utils/priority.js";
import { audit } from "../services/audit.js";
import { createWorkflowEvent } from "../services/workflow.js";
import { scenarioByKey } from "../utils/demoScenarios.js";
import { validateBody, transitionSchema } from "../middleware/requestValidation.js";

const r = Router();
r.use(auth);

function allowedCampaign(c, req) {
  return req.user.role === "PLATFORM_ADMIN" || String(c.hospitalId) === String(req.user.hospitalId);
}

const transitions = {
  DRAFT: ["READY", "CANCELLED"],
  READY: ["SCHEDULED", "RUNNING", "CANCELLED"],
  SCHEDULED: ["RUNNING", "CANCELLED"],
  RUNNING: ["PAUSED", "COMPLETED", "FAILED"],
  PAUSED: ["RUNNING", "CANCELLED", "FAILED"],
  COMPLETED: [],
  CANCELLED: [],
  FAILED: [],
};

r.get("/", async (req, res, next) => {
  try {
    res.json(await Campaign.find(tenantScope(req)).populate("protocolId").lean());
  } catch (e) { next(e); }
});

r.post("/", roles("PLATFORM_ADMIN", "HOSPITAL_ADMIN", "CAMPAIGN_MANAGER"), async (req, res, next) => {
  try {
    const d = { ...req.body };
    if (req.user.role !== "PLATFORM_ADMIN") d.hospitalId = req.user.hospitalId;
    const campaign = await Campaign.create(d);
    await audit({ hospitalId: campaign.hospitalId, actorType: "USER", actorId: String(req.user._id), action: "CAMPAIGN_CREATED", entityType: "Campaign", entityId: String(campaign._id) });
    await createWorkflowEvent({ hospitalId: campaign.hospitalId, type: "CAMPAIGN_CREATED", entityType: "Campaign", entityId: campaign._id, idempotencyKey: `campaign-created:${campaign._id}` });
    res.status(201).json(campaign);
  } catch (e) { next(e); }
});

r.patch("/:id", roles("PLATFORM_ADMIN", "HOSPITAL_ADMIN", "CAMPAIGN_MANAGER"), async (req, res, next) => {
  try {
    const c = await Campaign.findById(req.params.id);
    if (!c) return res.status(404).json({ message: "Campaign not found" });
    if (!allowedCampaign(c, req)) return res.status(403).json({ message: "Forbidden" });
    if (["RUNNING", "COMPLETED", "CANCELLED"].includes(c.status)) return res.status(409).json({ message: "Campaign configuration is locked in its current state" });
    const allowed = ["name", "description", "priority", "followUpDays", "callingHours", "startAt", "endAt", "outboundCapacity", "retryLimit", "eligibilityRules", "escalationConfig", "protocolId", "questions"];
    for (const key of allowed) if (req.body[key] !== undefined) c[key] = req.body[key];
    await c.save();
    res.json(c);
  } catch (e) { next(e); }
});

r.post("/:id/workload/estimate", roles("PLATFORM_ADMIN", "HOSPITAL_ADMIN", "CAMPAIGN_MANAGER"), async (req, res, next) => {
  try {
    const c = await Campaign.findById(req.params.id);
    if (!c) return res.status(404).json({ message: "Campaign not found" });
    if (!allowedCampaign(c, req)) return res.status(403).json({ message: "Forbidden" });
    const since = new Date(Date.now() - c.followUpDays * 86400000);
    const eligible = await Patient.countDocuments({ hospitalId: c.hospitalId, dischargeStatus: "DISCHARGED", communicationEligible: true, communicationConsent: true, dischargeDate: { $gte: since } });
    c.estimatedWorkload = { eligiblePatients: eligible, expectedAttempts: eligible * Math.max(1, c.retryLimit || 3), calculatedAt: new Date() };
    await c.save();
    res.json(c.estimatedWorkload);
  } catch (e) { next(e); }
});

r.post("/:id/transition", roles("PLATFORM_ADMIN", "HOSPITAL_ADMIN", "CAMPAIGN_MANAGER"), validateBody(transitionSchema), async (req, res, next) => {
  try {
    const c = await Campaign.findById(req.params.id);
    if (!c) return res.status(404).json({ message: "Campaign not found" });
    if (!allowedCampaign(c, req)) return res.status(403).json({ message: "Forbidden" });
    const nextStatus = String(req.body.status || "").toUpperCase();
    console.log(`[CAMPAIGN] Transition requested | campaign=${c._id} | ${c.status} -> ${nextStatus}`);
    if (!transitions[c.status]?.includes(nextStatus)) return res.status(409).json({ message: `Invalid campaign transition ${c.status} → ${nextStatus}` });
    if (nextStatus === "READY" && !c.protocolId) return res.status(400).json({ message: "A hospital protocol is required before activation" });
    if (nextStatus === "RUNNING") {
      if (c.startAt && new Date(c.startAt) > new Date()) return res.status(409).json({ message: "Campaign is scheduled for a future start time" });
      const protocol = await Protocol.findOne({ _id: c.protocolId, hospitalId: c.hospitalId, active: true });
      if (!protocol) return res.status(400).json({ message: "Active hospital protocol not found" });
    }
    c.status = nextStatus;
    await c.save();
    console.log(`[CAMPAIGN] Transition complete | campaign=${c._id} | status=${c.status}`);
    await audit({ hospitalId: c.hospitalId, actorType: "USER", actorId: String(req.user._id), action: `CAMPAIGN_${nextStatus}`, entityType: "Campaign", entityId: String(c._id) });
    await createWorkflowEvent({ hospitalId: c.hospitalId, type: `CAMPAIGN_${nextStatus}`, entityType: "Campaign", entityId: c._id, idempotencyKey: `campaign-transition:${c._id}:${nextStatus}:${Date.now()}` });
    res.json(c);
  } catch (e) { next(e); }
});

r.post("/:id/eligibility/run", roles("PLATFORM_ADMIN", "HOSPITAL_ADMIN", "CAMPAIGN_MANAGER"), async (req, res, next) => {
  try {
    const c = await Campaign.findById(req.params.id);
    if (!c) return res.status(404).json({ message: "Campaign not found" });
    if (!allowedCampaign(c, req)) return res.status(403).json({ message: "Forbidden" });
    if (!["READY", "RUNNING", "PAUSED"].includes(c.status)) return res.status(409).json({ message: "Campaign must be READY, RUNNING or PAUSED before eligibility is evaluated" });

    console.log(`[ELIGIBILITY] Starting eligibility for campaign ${c.name} (${c._id})`);
    const now = new Date();
    const patients = await Patient.find({
      hospitalId: c.hospitalId,
      dischargeStatus: "DISCHARGED",
      communicationEligible: true,
      communicationConsent: true,
      dischargeDate: { $gte: new Date(now.getTime() - c.followUpDays * 86400000) },
    });
    let created = 0;
    let skipped = 0;
    for (const p of patients) {
      const existing = await OutreachTask.findOne({ hospitalId: c.hospitalId, patientId: p._id, campaignId: c._id, status: { $nin: ["FAILED", "COMPLETED", "MANUAL_FOLLOW_UP"] } });
      if (existing) { skipped++; continue; }
      const deadline = new Date(new Date(p.dischargeDate).getTime() + c.followUpDays * 86400000);
      const demoScenario = p.metadata?.demoPatient ? scenarioByKey(p.metadata?.demoScenario) : null;
      const t = await OutreachTask.create({
        hospitalId: c.hospitalId,
        patientId: p._id,
        campaignId: c._id,
        status: "PENDING",
        deadline,
        nextAttemptAt: null,
        simulation: demoScenario
          ? {
              enabled: true,
              scenario: demoScenario.key,
              outcomes: demoScenario.outcome,
              outcomeIndex: 0,
            }
          : undefined,
      });
      t.priorityScore = priorityScore({ patient: p, campaign: c, task: t });
      await t.save();
      console.log(`[ELIGIBILITY] Created queue task ${t._id} for ${p.name} | scenario=${demoScenario?.key || "standard"} | priority=${t.priorityScore}`);
      created++;
      await createWorkflowEvent({ hospitalId: c.hospitalId, type: "PATIENT_ELIGIBLE", entityType: "OutreachTask", entityId: t._id, payload: { patientId: p._id, campaignId: c._id }, idempotencyKey: `eligible:${t._id}` });
    }
    c.estimatedWorkload = { eligiblePatients: patients.length, expectedAttempts: patients.length * Math.max(1, c.retryLimit || 3), calculatedAt: new Date() };
    await c.save();
    await audit({ hospitalId: c.hospitalId, action: "ELIGIBILITY_RUN", entityType: "Campaign", entityId: String(c._id), actorType: "USER", actorId: String(req.user._id), details: { eligible: patients.length, created, skipped } });
    console.log(`[ELIGIBILITY] Completed | eligible=${patients.length} created=${created} skipped=${skipped}`);
    res.json({ eligible: patients.length, tasksCreated: created, skipped, expectedAttempts: c.estimatedWorkload.expectedAttempts });
  } catch (e) { next(e); }
});

export default r;
