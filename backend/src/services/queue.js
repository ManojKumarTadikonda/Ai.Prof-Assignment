import crypto from "node:crypto";
import {
  Hospital,
  OutreachTask,
  Patient,
  Campaign,
  OutreachSession,
  Escalation,
  Communication,
  EHRRecord,
} from "../models/index.js";
import { randomToken, hashToken } from "../utils/security.js";
import { sendOutreachEmail } from "./email.js";
import { audit } from "./audit.js";
import { env } from "../config/env.js";
import { priorityScore } from "../utils/priority.js";
import { createWorkflowEvent } from "./workflow.js";

const ACTIVE_STATUSES = ["RESERVED", "CALLING", "CONNECTED"];
const DUE_STATUSES = ["PENDING", "RETRY_SCHEDULED", "CALLBACK_SCHEDULED"];
const RETRYABLE_OUTCOMES = ["NO_ANSWER", "BUSY", "VOICEMAIL", "DROPPED", "FAILED"];
const TERMINAL_OUTCOMES = ["COMPLETED", "ESCALATED", "MANUAL_FOLLOW_UP"];

function parseMinutes(value) {
  const [h, m] = String(value || "00:00").split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

export function isWithinCallingHours(hospital, campaign, at = new Date()) {
  const tz = hospital?.timezone || "Asia/Kolkata";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const hour = Number(parts.find((x) => x.type === "hour")?.value || 0);
  const minute = Number(parts.find((x) => x.type === "minute")?.value || 0);
  const current = hour * 60 + minute;
  const hours = campaign?.callingHours?.start && campaign?.callingHours?.end
    ? campaign.callingHours
    : hospital.callingHours;
  const start = parseMinutes(hours?.start);
  const end = parseMinutes(hours?.end);
  if (start === end) return true;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function activeStatusesQuery(hospitalId) {
  return { hospitalId, status: { $in: ACTIVE_STATUSES } };
}

export async function reconcileHospitalCapacity(hospitalId) {
  const active = await OutreachTask.countDocuments(activeStatusesQuery(hospitalId));
  await Hospital.updateOne({ _id: hospitalId }, { $set: { activeOutboundCount: active } });
  return active;
}

export async function recoverStaleTasks(hospital) {
  const now = new Date();
  const stale = await OutreachTask.find({
    hospitalId: hospital._id,
    status: { $in: ACTIVE_STATUSES },
    leaseExpiresAt: { $lt: now },
  }).limit(100);

  for (const task of stale) {
    const next = task.attempts >= hospital.retry.maxAttempts ? "MANUAL_FOLLOW_UP" : "RETRY_SCHEDULED";
    const nextAt = next === "RETRY_SCHEDULED" ? new Date(now.getTime() + backoffMs(hospital.retry.backoffMinutes, task.attempts)) : null;
    task.status = next;
    task.nextAttemptAt = nextAt;
    task.lastError = "Worker lease expired; task recovered by scheduler.";
    task.lastOutcome = "WORKER_TIMEOUT";
    task.leaseExpiresAt = null;
    task.lockId = null;
    task.lockedAt = null;
    task.reservation = undefined;
    task.outcomeHistory.push({ status: next, attempt: task.attempts, note: "Recovered stale worker lease" });
    await task.save();
    await audit({
      hospitalId: hospital._id,
      action: "WORKER_TASK_RECOVERED",
      entityType: "OutreachTask",
      entityId: String(task._id),
      details: { nextStatus: next },
    });
  }
}

function backoffMs(baseMinutes = 5, attempts = 1) {
  const exponent = Math.max(0, Math.min(Number(attempts || 1) - 1, 3));
  return Math.max(1, Number(baseMinutes || 5)) * Math.pow(2, exponent) * 60000;
}

export function nextRetryAt(hospital, attempts, now = Date.now()) {
  return new Date(now + backoffMs(hospital?.retry?.backoffMinutes, attempts));
}

async function refreshPriorityScores(hospitalId) {
  const tasks = await OutreachTask.find({
    hospitalId,
    status: { $in: DUE_STATUSES },
  }).sort({ deadline: 1 }).limit(200);

  for (const task of tasks) {
    const [patient, campaign] = await Promise.all([
      Patient.findById(task.patientId).lean(),
      Campaign.findById(task.campaignId).lean(),
    ]);
    if (!patient || !campaign) continue;
    const score = priorityScore({ patient, campaign, task });
    if (task.priorityScore !== score) {
      await OutreachTask.updateOne({ _id: task._id }, { $set: { priorityScore: score } });
    }
  }
}

async function reserveHospitalSlot(hospitalId, capacity) {
  return Hospital.findOneAndUpdate(
    {
      _id: hospitalId,
      activeOutboundCount: { $lt: Math.max(1, Number(capacity || 1)) },
    },
    { $inc: { activeOutboundCount: 1 } },
    { new: true },
  ).lean();
}

async function releaseHospitalSlot(hospitalId) {
  await Hospital.updateOne(
    { _id: hospitalId, activeOutboundCount: { $gt: 0 } },
    { $inc: { activeOutboundCount: -1 } },
  );
}

export async function claimNextTask(hospital, { blockedCampaignIds = [], simulationOnly = false } = {}) {
  const now = new Date();
  console.log(`[QUEUE] Attempting capacity reservation | hospital=${hospital.name} | active=${hospital.activeOutboundCount}/${hospital.outboundCapacity}`);
  const reservation = await reserveHospitalSlot(hospital._id, hospital.outboundCapacity);
  if (!reservation) {
    console.log(`[QUEUE] Capacity full | hospital=${hospital.name} | active=${hospital.activeOutboundCount}/${hospital.outboundCapacity}`);
    return null;
  }
  console.log(`[QUEUE] Capacity slot reserved | hospital=${hospital.name} | active=${reservation.activeOutboundCount}/${reservation.outboundCapacity}`);

  const lockId = crypto.randomUUID();
  const leaseExpiresAt = new Date(Date.now() + 2 * 60000);
  const filter = {
    hospitalId: hospital._id,
    status: { $in: DUE_STATUSES },
    ...(blockedCampaignIds.length ? { campaignId: { $nin: blockedCampaignIds } } : {}),
    ...(simulationOnly ? { "simulation.enabled": true } : {}),
    $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
  };

  const task = await OutreachTask.findOneAndUpdate(
    filter,
    {
      $set: {
        status: "RESERVED",
        lockId,
        lockedAt: now,
        leaseExpiresAt,
        reservation: { id: lockId, reservedAt: now, leaseExpiresAt },
        lastAttemptAt: now,
      },
      $inc: { attempts: 1 },
    },
    { sort: { priorityScore: -1, deadline: 1, createdAt: 1 }, new: true },
  ).populate("patientId campaignId");

  if (!task) {
    console.log(`[QUEUE] No due task available after reserving capacity | hospital=${hospital.name}`);
    await releaseHospitalSlot(hospital._id);
    return null;
  }

  console.log(`[QUEUE] Task atomically claimed | task=${task._id} | patient=${task.patientId?.name} | priority=${task.priorityScore} | attempt=${task.attempts}`);

  const campaign = task.campaignId;
  if (campaign?.outboundCapacity) {
    const campaignActive = await OutreachTask.countDocuments({
      campaignId: campaign._id,
      status: { $in: ACTIVE_STATUSES },
    });
    if (campaignActive > Number(campaign.outboundCapacity)) {
      await OutreachTask.updateOne(
        { _id: task._id, lockId },
        { $set: { status: "PENDING", nextAttemptAt: null, lockId: null, lockedAt: null, leaseExpiresAt: null }, $unset: { reservation: 1 }, $inc: { attempts: -1 } },
      );
      await releaseHospitalSlot(hospital._id);
      return claimNextTask(hospital, { blockedCampaignIds: [...blockedCampaignIds, String(campaign._id)], simulationOnly });
    }
  }

  return task;
}

export async function releaseReservation(task, status = null) {
  const hospitalId = task.hospitalId;
  if (status) task.status = status;
  task.lockId = null;
  task.lockedAt = null;
  task.leaseExpiresAt = null;
  task.reservation = undefined;
  await task.save();
  await releaseHospitalSlot(hospitalId);
}

async function createPatientSession({ hospital, patient, campaign, task }) {
  const token = randomToken();
  const session = await OutreachSession.create({
    hospitalId: hospital._id,
    patientId: patient._id,
    campaignId: campaign._id,
    outreachTaskId: task._id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 72 * 3600000),
  });
  return { session, token };
}

async function recordOutcome(task, status, note = "") {
  task.lastOutcome = status;
  task.outcomeHistory.push({ status, attempt: task.attempts, note });
}

async function scheduleRetry(task, hospital, status, note) {
  console.log(`[QUEUE] Retry decision | task=${task._id} | outcome=${status} | attempt=${task.attempts}`);
  const maxAttempts = Number(task.campaignId?.retryLimit || hospital.retry.maxAttempts || 3);
  if (task.attempts >= maxAttempts) {
    task.status = "MANUAL_FOLLOW_UP";
    console.log(`[QUEUE] Maximum attempts reached | task=${task._id} | moving to MANUAL_FOLLOW_UP`);
    task.manualFollowUpAt = new Date();
    await recordOutcome(task, "MANUAL_FOLLOW_UP", `Maximum attempts reached after ${status}`);
    await createWorkflowEvent({
      hospitalId: hospital._id,
      type: "MANUAL_FOLLOW_UP_CREATED",
      entityType: "OutreachTask",
      entityId: task._id,
      payload: { reason: note },
      idempotencyKey: `manual-follow-up:${task._id}:${task.attempts}`,
    });
  } else {
    task.status = "RETRY_SCHEDULED";
    task.nextAttemptAt = nextRetryAt(hospital, task.attempts);
    console.log(`[QUEUE] Retry scheduled | task=${task._id} | next=${task.nextAttemptAt.toISOString()}`);
    await recordOutcome(task, "RETRY_SCHEDULED", `${status}: retry scheduled`);
    await createWorkflowEvent({
      hospitalId: hospital._id,
      type: "RETRY_SCHEDULED",
      entityType: "OutreachTask",
      entityId: task._id,
      payload: { attempt: task.attempts, nextAttemptAt: task.nextAttemptAt },
      idempotencyKey: `retry:${task._id}:${task.attempts}`,
    });
  }
  task.lockId = null;
  task.lockedAt = null;
  task.leaseExpiresAt = null;
  task.reservation = undefined;
  await task.save();
  await releaseHospitalSlot(hospital._id);
}

export async function processRealOutreachTask(task, hospital) {
  const patient = task.patientId;
  console.log(`[OUTREACH] Preparing email outreach | task=${task._id} | patient=${patient?.name} | email=${patient?.email}`);
  const campaign = task.campaignId;
  if (!patient?.email || !campaign) {
    await scheduleRetry(task, hospital, "FAILED", "Patient email or campaign is unavailable.");
    return { outcome: "FAILED" };
  }

  const { token } = await createPatientSession({ hospital, patient, campaign, task });
  const link = `${env.appUrl.replace(/\/$/, "")}/patient/followup/${token}`;

  try {
    console.log(`[OUTREACH] Sending secure follow-up email | task=${task._id} | to=${patient.email}`);
    await sendOutreachEmail({
      to: patient.email,
      patientName: patient.name,
      link,
      hospitalName: hospital.name,
    });

    task.status = "SCHEDULED";
    task.contactedAt = new Date();
    task.nextAttemptAt = null;
    await recordOutcome(task, "SCHEDULED", "Patient follow-up link delivered.");
    task.lockId = null;
    task.lockedAt = null;
    task.leaseExpiresAt = null;
    task.reservation = undefined;
    await task.save();
    await releaseHospitalSlot(hospital._id);
    console.log(`[OUTREACH] Email delivered | task=${task._id} | status=SCHEDULED`);
    await audit({ hospitalId: hospital._id, action: "OUTREACH_SENT", entityType: "OutreachTask", entityId: String(task._id), details: { attempt: task.attempts } });
    return { outcome: "SCHEDULED" };
  } catch (error) {
    task.lastError = error?.message || "Outbound delivery failed";
    await scheduleRetry(task, hospital, "FAILED", task.lastError);
    return { outcome: "FAILED" };
  }
}

async function completeSimulated(task, hospital) {
  task.status = "COMPLETED";
  task.completedAt = new Date();
  task.contactedAt = task.contactedAt || new Date();
  await recordOutcome(task, "COMPLETED", "Simulation completed successfully.");
  await Communication.create({
    hospitalId: hospital._id,
    patientId: task.patientId._id,
    outreachTaskId: task._id,
    channel: "SIMULATED_VOICE",
    status: "COMPLETED",
    payload: { simulated: true, attempt: task.attempts },
  });
  await EHRRecord.create({
    hospitalId: hospital._id,
    patientId: task.patientId._id,
    encounterId: `SIM-${task._id}`,
    followUpStatus: "SIMULATED_COMPLETED",
    summary: "Simulated successful post-discharge outreach.",
    source: "queue_simulation",
    updatedBy: "SIMULATION",
    idempotencyKey: `sim-ehr:${task._id}:${task.attempts}`,
  }).catch(() => {});
  await task.save();
  await releaseHospitalSlot(hospital._id);
}

async function escalateSimulated(task, hospital, reason) {
  const existing = await Escalation.findOne({ outreachTaskId: task._id, status: { $in: ["OPEN", "ASSIGNED", "IN_REVIEW"] } });
  if (!existing) {
    await Escalation.create({
      hospitalId: hospital._id,
      patientId: task.patientId._id,
      outreachTaskId: task._id,
      trigger: "SIMULATION_ESCALATION",
      clinicalIndicators: [reason],
      triageResult: task.patientId.risk,
      consensusResult: { simulated: true, classification: task.patientId.risk },
      status: "OPEN",
      reason,
      priority: task.patientId.risk === "urgent" ? "urgent" : "concerning",
    });
  }
  task.status = "ESCALATED";
  await recordOutcome(task, "ESCALATED", reason);
  task.lockId = null;
  task.lockedAt = null;
  task.leaseExpiresAt = null;
  task.reservation = undefined;
  await task.save();
  await releaseHospitalSlot(hospital._id);
  await createWorkflowEvent({
    hospitalId: hospital._id,
    type: "ESCALATION_CREATED",
    entityType: "OutreachTask",
    entityId: task._id,
    payload: { reason },
    idempotencyKey: `simulation-escalation:${task._id}:${task.attempts}`,
  });
}

export async function processSimulationTask(task, hospital) {
  const sequence = task.simulation?.outcomes?.length ? task.simulation.outcomes : ["COMPLETED"];
  const index = Math.min(Number(task.simulation?.outcomeIndex || 0), sequence.length - 1);
  const outcome = sequence[index];
  task.status = "CALLING";
  task.contactedAt = task.contactedAt || new Date();
  task.simulation.currentOutcome = outcome;
  task.simulation.outcomeDueAt = new Date(Date.now() + 2500);
  task.outcomeHistory.push({ status: "CALLING", attempt: task.attempts, note: `Simulation processing: ${outcome}` });
  await task.save();
}

export async function finishSimulationTask(task, hospital) {
  const outcome = task.simulation?.currentOutcome || "COMPLETED";
  task.simulation.outcomeIndex = Number(task.simulation?.outcomeIndex || 0) + 1;
  task.simulation.currentOutcome = null;
  task.simulation.outcomeDueAt = null;

  if (outcome === "COMPLETED") return completeSimulated(task, hospital);
  if (outcome === "ESCALATED") return escalateSimulated(task, hospital, "Simulation produced a case requiring human review.");
  if (outcome === "CALLBACK") {
    task.status = "CALLBACK_SCHEDULED";
    task.callbackRequestedAt = new Date();
    task.callbackAt = new Date(Date.now() + 5000);
    task.nextAttemptAt = task.callbackAt;
    await recordOutcome(task, "CALLBACK_SCHEDULED", "Patient requested a callback.");
    task.lockId = null; task.lockedAt = null; task.leaseExpiresAt = null; task.reservation = undefined;
    await task.save();
    await releaseHospitalSlot(hospital._id);
    return;
  }
  if (RETRYABLE_OUTCOMES.includes(outcome)) {
    task.lastError = outcome === "FAILED" ? "Simulated technical failure" : null;
    await scheduleRetry(task, hospital, outcome, `Simulated ${outcome.toLowerCase()} outcome.`);
    return;
  }
  await scheduleRetry(task, hospital, "FAILED", `Unsupported simulation outcome: ${outcome}`);
}

export async function processQueueOnce({ simulation = false, hospitalIds = null } = {}) {
  console.log(`[QUEUE] ===== PROCESS START | mode=${simulation ? "DEMO SIMULATION" : "EMAIL OUTREACH"} =====`);
  const hospitalFilter = hospitalIds?.length ? { _id: { $in: hospitalIds }, status: "ACTIVE" } : { status: "ACTIVE" };
  await Campaign.updateMany({ status: "SCHEDULED", startAt: { $lte: new Date() } }, { $set: { status: "RUNNING" } });
  const hospitals = await Hospital.find(hospitalFilter);
  const summary = { hospitals: 0, processed: 0, sent: 0, recovered: 0, outcomes: {} };

  for (const hospital of hospitals) {
    await recoverStaleTasks(hospital);
    if (simulation) {
      const due = await OutreachTask.find({
        hospitalId: hospital._id,
        status: "CALLING",
        "simulation.enabled": true,
        "simulation.outcomeDueAt": { $lte: new Date() },
      }).populate("patientId campaignId").limit(50);
      for (const task of due) await finishSimulationTask(task, hospital);
    }
    await reconcileHospitalCapacity(hospital._id);
    await refreshPriorityScores(hospital._id);
    summary.hospitals++;
    console.log(`[QUEUE] Hospital ${hospital.name} | capacity=${hospital.outboundCapacity} | queue ready`);

    let safety = 0;
    while (safety++ < Math.max(1, Number(hospital.outboundCapacity || 1))) {
      const task = await claimNextTask(hospital, { simulationOnly: simulation });
      if (!task) break;

      const campaign = task.campaignId;
      if (!campaign || campaign.status !== "RUNNING") {
        await scheduleRetry(task, hospital, "FAILED", "Campaign is not running.");
        continue;
      }
      if (!simulation && !isWithinCallingHours(hospital, campaign)) {
        task.status = task.callbackAt ? "CALLBACK_SCHEDULED" : "PENDING";
        task.nextAttemptAt = task.callbackAt || new Date(Date.now() + 60 * 60000);
        await recordOutcome(task, "PENDING", "Outside configured calling hours; returned to queue.");
        task.lockId = null; task.lockedAt = null; task.leaseExpiresAt = null; task.reservation = undefined;
        await task.save();
        await releaseHospitalSlot(hospital._id);
        continue;
      }

      summary.processed++;
      console.log(`[QUEUE] Dispatching task=${task._id} | patient=${task.patientId?.name} | priority=${task.priorityScore} | mode=${simulation ? "SIMULATION" : "EMAIL"}`);
      if (simulation) {
        await processSimulationTask(task, hospital);
        summary.outcomes[task.lastOutcome || task.status] = (summary.outcomes[task.lastOutcome || task.status] || 0) + 1;
      } else {
        const result = await processRealOutreachTask(task, hospital);
        summary.sent += result.outcome === "SCHEDULED" ? 1 : 0;
        summary.outcomes[result.outcome] = (summary.outcomes[result.outcome] || 0) + 1;
      }
    }
    await reconcileHospitalCapacity(hospital._id);
    console.log(`[QUEUE] Hospital complete | ${hospital.name}`);
  }
  console.log(`[QUEUE] ===== PROCESS END | processed=${summary.processed} sent=${summary.sent} =====`);
  return summary;
}
