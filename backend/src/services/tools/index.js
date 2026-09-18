import { Patient, Encounter, Protocol, OutreachTask, Escalation } from "../../models/index.js";
import { audit } from "../audit.js";
import { ehr, safeRoutineEHRUpdate } from "../ehr.js";
import { createWorkflowEvent } from "../workflow.js";

function assertTenant(context, hospitalId) {
  if (!context?.hospitalId || String(context.hospitalId) !== String(hospitalId)) {
    throw new Error("Tenant boundary violation");
  }
}

export async function lookupPatient(context, patientId) {
  const patient = await Patient.findOne({ _id: patientId, hospitalId: context.hospitalId }).lean();
  if (!patient) throw new Error("Patient not found");
  return patient;
}

export async function lookupEncounter(context, encounterId) {
  return ehr.getEncounter({ hospitalId: context.hospitalId, encounterId });
}

export async function searchProtocol(context, protocolId) {
  return Protocol.findOne({ _id: protocolId, hospitalId: context.hospitalId, active: true }).lean();
}

export async function recordCallOutcome(context, taskId, outcome) {
  const task = await OutreachTask.findOne({ _id: taskId, hospitalId: context.hospitalId });
  if (!task) throw new Error("Outreach task not found");
  task.lastOutcome = outcome;
  task.outcomeHistory.push({ status: outcome, attempt: task.attempts, note: "Controlled tool operation" });
  await task.save();
  await audit({ hospitalId: context.hospitalId, action: "CALL_OUTCOME_RECORDED", entityType: "OutreachTask", entityId: String(task._id), details: { outcome } });
  return task;
}

export async function scheduleCallback(context, taskId, callbackAt) {
  const date = new Date(callbackAt);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) throw new Error("Callback time must be in the future");
  const task = await OutreachTask.findOneAndUpdate(
    { _id: taskId, hospitalId: context.hospitalId, status: { $nin: ["COMPLETED", "ESCALATED", "MANUAL_FOLLOW_UP"] } },
    { $set: { status: "CALLBACK_SCHEDULED", callbackAt: date, callbackRequestedAt: new Date(), nextAttemptAt: date } },
    { new: true },
  );
  if (!task) throw new Error("Task cannot be scheduled for callback");
  await createWorkflowEvent({ hospitalId: context.hospitalId, type: "CALLBACK_REQUESTED", entityType: "OutreachTask", entityId: task._id, payload: { callbackAt: date }, idempotencyKey: `callback:${task._id}:${date.toISOString()}` });
  return task;
}

export async function createEscalation(context, data) {
  assertTenant(context, data.hospitalId);
  const existing = await Escalation.findOne({ hospitalId: data.hospitalId, outreachTaskId: data.outreachTaskId, status: { $in: ["OPEN", "ASSIGNED", "IN_REVIEW"] } });
  if (existing) return existing;
  const escalation = await Escalation.create({ ...data, status: data.status || "OPEN" });
  await audit({ hospitalId: data.hospitalId, action: "ESCALATION_CREATED", entityType: "Escalation", entityId: String(escalation._id), details: { trigger: data.trigger, priority: data.priority } });
  return escalation;
}

export async function updateMockEHR(context, operation, data) {
  assertTenant(context, data.hospitalId);
  if (operation === "communication") return ehr.createCommunication(data);
  if (operation === "observation") return ehr.createObservation(data);
  if (operation === "follow_up") return ehr.createFollowUpTask(data);
  if (operation === "routine") return safeRoutineEHRUpdate(data);
  throw new Error(`Unsupported EHR operation: ${operation}`);
}
