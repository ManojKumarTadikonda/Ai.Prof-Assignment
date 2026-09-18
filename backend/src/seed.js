import bcrypt from "bcryptjs";
import { connectDB } from "./config/db.js";
import { DEMO_SCENARIOS } from "./utils/demoScenarios.js";
import { Hospital, User, Patient, Protocol, Campaign, KnowledgeResource, OutreachTask, PatientResponse, OutreachSession, AIAssessment, Escalation, EHRRecord, AuditLog, WorkflowEvent, SimulationRun, Communication, Notification, Encounter, Condition, Observation, Medication, CarePlan } from "./models/index.js";
await connectDB();
await Promise.all([
  Hospital.deleteMany({}),
  User.deleteMany({}),
  Patient.deleteMany({}),
  Protocol.deleteMany({}),
  Campaign.deleteMany({}),
  KnowledgeResource.deleteMany({}),
  OutreachTask.deleteMany({}), PatientResponse.deleteMany({}), OutreachSession.deleteMany({}), AIAssessment.deleteMany({}), Escalation.deleteMany({}), EHRRecord.deleteMany({}), AuditLog.deleteMany({}), WorkflowEvent.deleteMany({}), SimulationRun.deleteMany({}), Communication.deleteMany({}), Notification.deleteMany({}), Encounter.deleteMany({}), Condition.deleteMany({}), Observation.deleteMany({}), Medication.deleteMany({}), CarePlan.deleteMany({}),
]);
const [a, b] = await Hospital.create([
  { name: "Apollo Demo Hospital", code: "HOSP-A", outboundCapacity: 2, contactEmail: "manojtadikonda5@gmail.com", escalationContacts: [{ name: "Demo Clinical Reviewer", email: "n210519@rguktn.ac.in", role: "Clinical Reviewer" }] },
  { name: "CityCare Demo Hospital", code: "HOSP-B", outboundCapacity: 1, contactEmail: "n210519@rguktn.ac.in", escalationContacts: [{ name: "Demo Clinical Reviewer B", email: "manojtadikonda5@gmail.com", role: "Clinical Reviewer" }] },
]);
const hash = await bcrypt.hash("demo123", 10);
await User.create([
  {
    name: "Platform Admin",
    email: "platform@careflow.local",
    passwordHash: hash,
    role: "PLATFORM_ADMIN",
  },
  {
    name: "Hospital A Admin",
    email: "admin@hospital-a.local",
    passwordHash: hash,
    role: "HOSPITAL_ADMIN",
    hospitalId: a._id,
  },
  {
    name: "Hospital A Manager",
    email: "manager@hospital-a.local",
    passwordHash: hash,
    role: "CAMPAIGN_MANAGER",
    hospitalId: a._id,
  },
  {
    name: "Hospital A Reviewer",
    email: "reviewer@hospital-a.local",
    passwordHash: hash,
    role: "CLINICAL_REVIEWER",
    hospitalId: a._id,
  },
  {
    name: "Hospital B Admin",
    email: "admin@hospital-b.local",
    passwordHash: hash,
    role: "HOSPITAL_ADMIN",
    hospitalId: b._id,
  },
]);
const protocolData = (h, name) => ({
  hospitalId: h,
  name,
  version: "1.0",
  sourceText: `Post-discharge follow-up protocol. Treat incomplete or conflicting information as uncertain and require human review. Worsening pain, fever, difficulty breathing, severe bleeding, or fainting require escalation. Improving symptoms with no safety triggers may be routine.`,
  rules: [
    {
      trigger: "worsening pain",
      classification: "concerning",
      requiresHumanReview: true,
      reason: "Worsening pain requires review",
    },
    {
      trigger: "fever",
      classification: "concerning",
      requiresHumanReview: true,
      reason: "Fever reported",
    },
    {
      trigger: "difficulty breathing",
      classification: "urgent",
      requiresHumanReview: true,
      reason: "Breathing difficulty is an urgent trigger",
    },
    {
      trigger: "severe bleeding",
      classification: "urgent",
      requiresHumanReview: true,
      reason: "Severe bleeding is an urgent trigger",
    },
    {
      trigger: "fainting",
      classification: "urgent",
      requiresHumanReview: true,
      reason: "Fainting is an urgent trigger",
    },
  ],
});
const [pa, pb] = await Protocol.create([
  protocolData(a, "General Post-Discharge"),
  protocolData(b, "General Post-Discharge"),
]);
await KnowledgeResource.create([
  { hospitalId: a._id, title: "Apollo Post-Discharge Safety Guidance", type: "CLINICAL_PROTOCOL", content: "Patients reporting difficulty breathing, severe bleeding, fainting, worsening pain, or fever require conservative human review. Incomplete or conflicting information is uncertain.", sourceReference: "Apollo protocol knowledge v1.0", tags: ["post-discharge", "safety", "triage"] },
  { hospitalId: b._id, title: "CityCare Post-Discharge Safety Guidance", type: "CLINICAL_PROTOCOL", content: "Patients reporting difficulty breathing, severe bleeding, fainting, worsening pain, or fever require conservative human review. Incomplete or conflicting information is uncertain.", sourceReference: "CityCare protocol knowledge v1.0", tags: ["post-discharge", "safety", "triage"] },
]);
const qs = [
  {
    id: "q1",
    text: "How are you feeling since discharge?",
    required: true,
    responseTypes: ["TEXT", "VOICE"],
  },
  {
    id: "q2",
    text: "Are you experiencing any pain, and is it improving or worsening?",
    required: true,
    responseTypes: ["TEXT", "VOICE"],
  },
  {
    id: "q3",
    text: "Do you have a fever or chills?",
    required: true,
    responseTypes: ["TEXT", "VOICE"],
  },
  {
    id: "q4",
    text: "Do you have any new or worsening symptoms?",
    required: true,
    responseTypes: ["TEXT", "VOICE"],
  },
  {
    id: "q5",
    text: "Do you have any other concerns you want the care team to know about?",
    required: true,
    responseTypes: ["TEXT", "VOICE"],
  },
];
const [ca, cb] = await Campaign.create([
  {
    hospitalId: a._id,
    name: "General Post-Discharge",
    status: "RUNNING",
    priority: 20,
    followUpDays: 7,
    protocolId: pa,
    questions: qs,
  },
  {
    hospitalId: b._id,
    name: "General Post-Discharge",
    status: "RUNNING",
    priority: 20,
    followUpDays: 7,
    protocolId: pb,
    questions: qs,
  },
]);
const now = new Date();
const DEMO_EMAILS = [
  "n210519@rguktn.ac.in",
  "manojtadikonda5@gmail.com",
];

// One single demo dataset is used throughout the application.
// 24 patients belong to Hospital A and 6 to Hospital B. Every patient uses
// one of the two real test inboxes above so the outreach flow can be demonstrated.
const makePatient = (scenario, index) => {
  const hospital = index < 24 ? a : b;
  const daysAgo = [
    0.4, 0.8, 1.1, 1.4, 1.8, 2.1, 2.5, 2.9, 3.2, 3.6,
    4.0, 4.3, 4.7, 5.0, 5.3, 5.6, 5.9, 6.1, 6.3, 6.5,
    6.7, 6.8, 6.9, 6.95, 1.7, 3.8, 4.9, 5.5, 6.2, 6.85,
  ][index];

  return {
    hospitalId: hospital._id,
    externalId: `${hospital.code}-P${String(index + 1).padStart(3, "0")}`,
    name: `Demo Patient ${String(index + 1).padStart(3, "0")}`,
    email: DEMO_EMAILS[index % DEMO_EMAILS.length],
    phone: `+91000000${String(index + 1).padStart(4, "0")}`,
    dischargeDate: new Date(now.getTime() - daysAgo * 86400000),
    dischargeStatus: "DISCHARGED",
    communicationConsent: true,
    communicationEligible: true,
    risk: scenario.risk,
    requirements: ["post-discharge-follow-up"],
    metadata: {
      demoPatient: true,
      demoScenario: scenario.key,
      demoEmail: true,
      notes: "Synthetic demo patient for CareFlow prototype. Not real clinical data.",
    },
  };
};

if (DEMO_SCENARIOS.length !== 30) {
  throw new Error(`Expected exactly 30 demo scenarios, found ${DEMO_SCENARIOS.length}`);
}

const patients = DEMO_SCENARIOS.map((scenario, index) => makePatient(scenario, index));
const createdPatients = await Patient.create(patients);

await Promise.all(createdPatients.map(async (p, index) => {
  const encounter = await Encounter.create({
    hospitalId: p.hospitalId,
    patientId: p._id,
    externalId: `ENC-${p.externalId}`,
    careSetting: "INPATIENT",
    admissionAt: new Date(new Date(p.dischargeDate).getTime() - 2 * 86400000),
    dischargeAt: p.dischargeDate,
    status: "FINISHED",
  });

  await Promise.all([
    Condition.create({
      hospitalId: p.hospitalId,
      patientId: p._id,
      encounterId: encounter._id,
      code: "DEMO",
      display: index % 2 ? "Post-operative recovery" : "General recovery",
      clinicalStatus: "ACTIVE",
    }),
    CarePlan.create({
      hospitalId: p.hospitalId,
      patientId: p._id,
      encounterId: encounter._id,
      title: "Post-discharge follow-up",
      instructions: "Complete the scheduled post-discharge check-in and contact the care team if symptoms worsen.",
      followUpWindowDays: 7,
      status: "ACTIVE",
    }),
  ]);
}));

console.log("\n============================================================");
console.log("CARE FLOW DEMO DATA SEEDED");
console.log("============================================================");
console.log("Hospitals: 2");
console.log("Demo patients: 30 (24 Hospital A + 6 Hospital B)");
console.log("Outreach inboxes: 2 test addresses used by all 30 patients");
console.log(`Inbox 1: ${DEMO_EMAILS[0]}`);
console.log(`Inbox 2: ${DEMO_EMAILS[1]}`);
console.log("Password for seeded staff users: demo123");
console.log("\nPatient scenarios:");
patients.forEach((p, index) => {
  console.log(`${index + 1}. ${p.externalId} | ${p.email} | ${DEMO_SCENARIOS[index].key} | ${p.risk}`);
});
console.log("\nNext demo step: Login → Campaigns → Eligibility → Outreach Queue.");
console.log("\nSeed complete. Test patients:");
patients.forEach((p, index) =>
  console.log(
    `${index + 1}. ${p.externalId} | ${p.email} | ${scenarios[index].scenario} | ${p.risk}`,
  ),
);
console.log("\nCampaigns:", ca._id, cb._id);
console.log("Password for seeded users: demo123");
process.exit(0);
