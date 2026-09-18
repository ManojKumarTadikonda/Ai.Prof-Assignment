import mongoose from "mongoose";
const { Schema, model } = mongoose;
const opts = { timestamps: true };
const tenant = {
  type: Schema.Types.ObjectId,
  ref: "Hospital",
  required: true,
  index: true,
};

const outcomeHistorySchema = new Schema(
  {
    status: String,
    at: { type: Date, default: Date.now },
    attempt: Number,
    note: String,
  },
  { _id: false },
);

export const Hospital = model(
  "Hospital",
  new Schema(
    {
      name: { type: String, required: true },
      code: { type: String, required: true, unique: true },
      contactEmail: String,
      contactPhone: String,
      timezone: { type: String, default: "Asia/Kolkata" },
      callingHours: {
        start: { type: String, default: "09:00" },
        end: { type: String, default: "18:00" },
      },
      outboundCapacity: { type: Number, default: 5, min: 1 },
      activeOutboundCount: { type: Number, default: 0, min: 0 },
      retry: {
        maxAttempts: { type: Number, default: 3 },
        backoffMinutes: { type: Number, default: 5 },
      },
      notificationPreferences: {
        escalationEmail: { type: Boolean, default: true },
        retryEmail: { type: Boolean, default: false },
        enabled: { type: Boolean, default: true },
      },
      escalationContacts: [
        {
          name: String,
          email: String,
          phone: String,
          role: String,
        },
      ],
      mockEhr: {
        enabled: { type: Boolean, default: true },
        baseUrl: String,
      },
      status: { type: String, default: "ACTIVE" },
    },
    opts,
  ),
);

export const User = model(
  "User",
  new Schema(
    {
      hospitalId: { ...tenant, required: false },
      name: String,
      email: { type: String, unique: true },
      passwordHash: String,
      role: {
        type: String,
        enum: [
          "PLATFORM_ADMIN",
          "HOSPITAL_ADMIN",
          "CAMPAIGN_MANAGER",
          "CLINICAL_REVIEWER",
        ],
        required: true,
      },
      active: { type: Boolean, default: true },
    },
    opts,
  ),
);

export const Patient = model(
  "Patient",
  new Schema(
    {
      hospitalId: tenant,
      externalId: String,
      name: String,
      email: String,
      phone: String,
      dischargeDate: Date,
      dischargeStatus: { type: String, default: "DISCHARGED" },
      communicationConsent: { type: Boolean, default: true },
      communicationEligible: { type: Boolean, default: true },
      risk: {
        type: String,
        enum: ["urgent", "concerning", "routine", "unknown"],
        default: "unknown",
      },
      requirements: [String],
      metadata: Schema.Types.Mixed,
    },
    {
      ...opts,
      indexes: [
        { hospitalId: 1, email: 1 },
        { hospitalId: 1, dischargeDate: 1 },
      ],
    },
  ),
);

export const Encounter = model(
  "Encounter",
  new Schema(
    {
      hospitalId: tenant,
      patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
      externalId: String,
      careSetting: String,
      admissionAt: Date,
      dischargeAt: Date,
      status: { type: String, default: "FINISHED" },
    },
    opts,
  ),
);

export const Condition = model(
  "Condition",
  new Schema(
    {
      hospitalId: tenant,
      patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
      encounterId: { type: Schema.Types.ObjectId, ref: "Encounter" },
      code: String,
      display: String,
      clinicalStatus: String,
    },
    opts,
  ),
);

export const Observation = model(
  "Observation",
  new Schema(
    {
      hospitalId: tenant,
      patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
      encounterId: { type: Schema.Types.ObjectId, ref: "Encounter" },
      code: String,
      display: String,
      value: Schema.Types.Mixed,
      effectiveAt: Date,
      source: String,
    },
    opts,
  ),
);

export const Medication = model(
  "Medication",
  new Schema(
    {
      hospitalId: tenant,
      patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
      encounterId: { type: Schema.Types.ObjectId, ref: "Encounter" },
      medication: String,
      status: String,
      instructions: String,
    },
    opts,
  ),
);

export const CarePlan = model(
  "CarePlan",
  new Schema(
    {
      hospitalId: tenant,
      patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
      encounterId: { type: Schema.Types.ObjectId, ref: "Encounter" },
      title: String,
      instructions: String,
      followUpWindowDays: Number,
      status: String,
    },
    opts,
  ),
);

export const Communication = model(
  "Communication",
  new Schema(
    {
      hospitalId: tenant,
      patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
      encounterId: { type: Schema.Types.ObjectId, ref: "Encounter" },
      outreachTaskId: { type: Schema.Types.ObjectId, ref: "OutreachTask" },
      channel: String,
      status: String,
      payload: Schema.Types.Mixed,
    },
    opts,
  ),
);

export const Protocol = model(
  "Protocol",
  new Schema(
    {
      hospitalId: tenant,
      name: String,
      version: String,
      active: { type: Boolean, default: true },
      rules: [
        {
          trigger: String,
          classification: {
            type: String,
            enum: ["routine", "concerning", "urgent", "uncertain"],
          },
          requiresHumanReview: Boolean,
          reason: String,
        },
      ],
      sourceText: String,
    },
    opts,
  ),
);

export const KnowledgeResource = model(
  "KnowledgeResource",
  new Schema(
    {
      hospitalId: tenant,
      title: String,
      type: { type: String, default: "PROTOCOL" },
      content: String,
      sourceReference: String,
      active: { type: Boolean, default: true },
      tags: [String],
    },
    opts,
  ),
);

export const Campaign = model(
  "Campaign",
  new Schema(
    {
      hospitalId: tenant,
      name: String,
      description: String,
      status: {
        type: String,
        enum: ["DRAFT", "READY", "SCHEDULED", "RUNNING", "PAUSED", "COMPLETED", "CANCELLED", "FAILED"],
        default: "DRAFT",
      },
      priority: { type: Number, default: 10 },
      followUpDays: { type: Number, default: 7 },
      callingHours: {
        start: String,
        end: String,
      },
      startAt: Date,
      endAt: Date,
      outboundCapacity: { type: Number, default: 5, min: 1 },
      retryLimit: { type: Number, default: 3, min: 1 },
      eligibilityRules: Schema.Types.Mixed,
      escalationConfig: Schema.Types.Mixed,
      estimatedWorkload: {
        eligiblePatients: Number,
        expectedAttempts: Number,
        calculatedAt: Date,
      },
      protocolId: { type: Schema.Types.ObjectId, ref: "Protocol" },
      questions: [
        {
          id: String,
          text: String,
          required: { type: Boolean, default: true },
          responseTypes: { type: [String], default: ["TEXT", "VOICE"] },
        },
      ],
    },
    opts,
  ),
);

export const OutreachTask = model(
  "OutreachTask",
  new Schema(
    {
      hospitalId: tenant,
      patientId: {
        type: Schema.Types.ObjectId,
        ref: "Patient",
        required: true,
      },
      campaignId: {
        type: Schema.Types.ObjectId,
        ref: "Campaign",
        required: true,
      },
      status: {
        type: String,
        enum: [
          "PENDING",
          "SCHEDULED",
          "CALLING",
          "CONNECTED",
          "COMPLETED",
          "NO_ANSWER",
          "BUSY",
          "VOICEMAIL",
          "DROPPED",
          "RETRY_SCHEDULED",
          "CALLBACK_SCHEDULED",
          "ESCALATED",
          "MANUAL_FOLLOW_UP",
          "FAILED",
          "RESERVED",
        ],
        default: "PENDING",
      },
      aiProcessingStatus: {
        type: String,
        enum: ["NOT_STARTED", "PROCESSING", "COMPLETED", "HUMAN_REVIEW", "FAILED"],
        default: "NOT_STARTED",
      },
      aiProcessingError: String,
      aiProcessedAt: Date,
      priorityScore: { type: Number, default: 0 },
      attempts: { type: Number, default: 0 },
      nextAttemptAt: Date,
      deadline: Date,
      callbackAt: Date,
      callbackRequestedAt: Date,
      manualFollowUpAt: Date,
      lockId: String,
      lockedAt: Date,
      leaseExpiresAt: Date,
      lastError: String,
      lastOutcome: String,
      lastAttemptAt: Date,
      contactedAt: Date,
      completedAt: Date,
      reservation: {
        id: String,
        reservedAt: Date,
        leaseExpiresAt: Date,
      },
      outcomeHistory: { type: [outcomeHistorySchema], default: [] },
      simulation: {
        enabled: { type: Boolean, default: false },
        scenario: String,
        outcomes: { type: [String], default: [] },
        outcomeIndex: { type: Number, default: 0 },
        outcomeDueAt: Date,
        currentOutcome: String,
      },
    },
    {
      ...opts,
      indexes: [
        { hospitalId: 1, status: 1, priorityScore: -1 },
        { hospitalId: 1, status: 1, nextAttemptAt: 1 },
        { hospitalId: 1, deadline: 1 },
        { hospitalId: 1, lockId: 1 },
      ],
    },
  ),
);

export const PatientResponse = model(
  "PatientResponse",
  new Schema(
    {
      hospitalId: tenant,
      patientId: { type: Schema.Types.ObjectId, ref: "Patient" },
      campaignId: { type: Schema.Types.ObjectId, ref: "Campaign" },
      outreachTaskId: { type: Schema.Types.ObjectId, ref: "OutreachTask" },
      questionId: String,
      responseType: { type: String, enum: ["TEXT", "VOICE"] },
      text: String,
      audio: {
        provider: String,
        assetId: String,
        secureUrl: String,
        mimeType: String,
        duration: Number,
      },
      transcript: String,
      aiAssessment: Schema.Types.Mixed,
    },
    opts,
  ),
);

export const OutreachSession = model(
  "OutreachSession",
  new Schema(
    {
      hospitalId: tenant,
      patientId: { type: Schema.Types.ObjectId, ref: "Patient" },
      campaignId: { type: Schema.Types.ObjectId, ref: "Campaign" },
      outreachTaskId: { type: Schema.Types.ObjectId, ref: "OutreachTask" },
      tokenHash: { type: String, unique: true },
      expiresAt: Date,
      submittedAt: Date,
      used: { type: Boolean, default: false },
    },
    opts,
  ),
);

export const AIAssessment = model(
  "AIAssessment",
  new Schema(
    {
      hospitalId: tenant,
      patientId: { type: Schema.Types.ObjectId, ref: "Patient" },
      outreachTaskId: { type: Schema.Types.ObjectId, ref: "OutreachTask" },
      assessmentNo: Number,
      modelProvider: String,
      modelName: String,
      latencyMs: Number,
      tokenUsage: Schema.Types.Mixed,
      retrievalSources: [String],
      validationStatus: String,
      classification: String,
      evidence: [String],
      uncertainty: String,
      requiresHumanReview: Boolean,
      protocolMatches: Schema.Types.Mixed,
      safetyFlags: [String],
      rawJson: Schema.Types.Mixed,
    },
    opts,
  ),
);

export const Escalation = model(
  "Escalation",
  new Schema(
    {
      hospitalId: tenant,
      patientId: { type: Schema.Types.ObjectId, ref: "Patient" },
      outreachTaskId: { type: Schema.Types.ObjectId, ref: "OutreachTask" },
      trigger: String,
      clinicalIndicators: [String],
      triageResult: String,
      consensusResult: Schema.Types.Mixed,
      status: {
        type: String,
        enum: ["OPEN", "ASSIGNED", "IN_REVIEW", "WAITING_FOR_INFORMATION", "RESOLVED", "CLOSED"],
        default: "OPEN",
      },
      reason: String,
      priority: String,
      assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
      resolution: String,
      resolvedAt: Date,
      resolutionTimestamp: Date,
    },
    opts,
  ),
);

export const EHRRecord = model(
  "EHRRecord",
  new Schema(
    {
      hospitalId: tenant,
      patientId: { type: Schema.Types.ObjectId, ref: "Patient" },
      encounterId: String,
      followUpStatus: String,
      summary: String,
      source: String,
      updatedBy: String,
      idempotencyKey: { type: String, unique: true, sparse: true },
    },
    opts,
  ),
);

export const AuditLog = model(
  "AuditLog",
  new Schema(
    {
      hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital" },
      actorType: String,
      actorId: String,
      action: String,
      entityType: String,
      entityId: String,
      details: Schema.Types.Mixed,
    },
    opts,
  ),
);

export const WorkflowEvent = model(
  "WorkflowEvent",
  new Schema(
    {
      hospitalId: tenant,
      type: String,
      entityType: String,
      entityId: String,
      idempotencyKey: { type: String, unique: true },
      status: { type: String, enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"], default: "PENDING" },
      attempts: { type: Number, default: 0 },
      payload: Schema.Types.Mixed,
      error: String,
      processedAt: Date,
    },
    opts,
  ),
);

export const Notification = model(
  "Notification",
  new Schema(
    {
      hospitalId: tenant,
      type: String,
      recipient: String,
      subject: String,
      message: String,
      status: { type: String, enum: ["PENDING", "SENT", "FAILED"], default: "PENDING" },
      entityType: String,
      entityId: String,
      deliveredAt: Date,
      error: String,
    },
    opts,
  ),
);

export const SimulationRun = model(
  "SimulationRun",
  new Schema(
    {
      hospitalId: tenant,
      status: { type: String, enum: ["IDLE", "RUNNING", "PAUSED", "COMPLETED"], default: "IDLE" },
      tick: { type: Number, default: 0 },
      speedMs: { type: Number, default: 2500 },
      startedAt: Date,
      completedAt: Date,
      lastTickAt: Date,
      totalTasks: { type: Number, default: 0 },
    },
    opts,
  ),
);
