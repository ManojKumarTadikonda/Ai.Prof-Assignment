import {
  Patient,
  Encounter,
  Condition,
  Observation,
  Medication,
  CarePlan,
  Communication,
  EHRRecord,
} from "../models/index.js";
import { audit } from "./audit.js";

function tenantFilter(hospitalId, filter = {}) {
  return { ...filter, hospitalId };
}

export const mockEhr = {
  async getPatient({ hospitalId, patientId }) {
    return Patient.findOne(tenantFilter(hospitalId, { _id: patientId })).lean();
  },
  async getEncounter({ hospitalId, encounterId }) {
    return Encounter.findOne(tenantFilter(hospitalId, { _id: encounterId })).lean();
  },
  async getConditions({ hospitalId, patientId }) {
    return Condition.find(tenantFilter(hospitalId, { patientId })).lean();
  },
  async getObservations({ hospitalId, patientId }) {
    return Observation.find(tenantFilter(hospitalId, { patientId })).sort({ effectiveAt: -1 }).limit(50).lean();
  },
  async getMedications({ hospitalId, patientId }) {
    return Medication.find(tenantFilter(hospitalId, { patientId })).lean();
  },
  async getCarePlan({ hospitalId, patientId }) {
    return CarePlan.findOne(tenantFilter(hospitalId, { patientId })).sort({ createdAt: -1 }).lean();
  },
  async createCommunication({ hospitalId, patientId, outreachTaskId, channel, status, payload = {}, idempotencyKey }) {
    const existing = idempotencyKey ? await Communication.findOne({ hospitalId, outreachTaskId, "payload.idempotencyKey": idempotencyKey }).lean() : null;
    if (existing) {
    console.log(`[EHR] Idempotent replay prevented duplicate write | task=${outreachTaskId}`);
    return existing;
  }
    return Communication.create({ hospitalId, patientId, outreachTaskId, channel, status, payload: { ...payload, idempotencyKey } });
  },
  async createObservation({ hospitalId, patientId, encounterId, display, value, source }) {
    return Observation.create({ hospitalId, patientId, encounterId, display, value, source, effectiveAt: new Date() });
  },
  async createFollowUpTask({ hospitalId, patientId, outreachTaskId, summary }) {
    return EHRRecord.create({
      hospitalId,
      patientId,
      encounterId: `FOLLOWUP-${outreachTaskId}`,
      followUpStatus: "FOLLOW_UP_REQUIRED",
      summary,
      source: "mock_ehr_follow_up_task",
      updatedBy: "SYSTEM",
      idempotencyKey: `followup:${outreachTaskId}`,
    });
  },
};

export async function safeRoutineEHRUpdate({ hospitalId, patientId, outreachTaskId, summary }) {
  console.log(`[EHR] Controlled routine update requested | task=${outreachTaskId}`);
  const idempotencyKey = `routine:${outreachTaskId}`;
  const existing = await EHRRecord.findOne({ idempotencyKey }).lean();
  if (existing) return existing;

  const rec = await EHRRecord.create({
    hospitalId,
    patientId,
    encounterId: `OUT-${outreachTaskId}`,
    followUpStatus: "ROUTINE_COMPLETED",
    summary,
    source: "post_discharge_outreach",
    updatedBy: "SYSTEM",
    idempotencyKey,
  });
  console.log(`[EHR] Record created | id=${rec._id} | task=${outreachTaskId}`);
  await audit({
    hospitalId,
    action: "EHR_UPDATE",
    entityType: "EHRRecord",
    entityId: String(rec._id),
    details: { patientId: String(patientId), outreachTaskId: String(outreachTaskId), reason: "validated routine follow-up" },
  });
  return rec;
}

export const ehr = mockEhr;
