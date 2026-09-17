import bcrypt from "bcryptjs";
import { connectDB } from "./config/db.js";
import { Hospital, User, Patient, Protocol, Campaign } from "./models/index.js";
await connectDB();
await Promise.all([
  Hospital.deleteMany({}),
  User.deleteMany({}),
  Patient.deleteMany({}),
  Protocol.deleteMany({}),
  Campaign.deleteMany({}),
]);
const [a, b] = await Hospital.create([
  { name: "Apollo Demo Hospital", code: "HOSP-A", outboundCapacity: 2 },
  { name: "CityCare Demo Hospital", code: "HOSP-B", outboundCapacity: 1 },
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
const testEmails = [
  "n210519@rguktn.ac.in",
  "manojtadikonda5@gmail.com",
  "n210519@rguktn.ac.in",
  "manojtadikonda5@gmail.com",
  "n210519@rguktn.ac.in",
  "manojtadikonda5@gmail.com",
  "n210519@rguktn.ac.in",
  "manojtadikonda5@gmail.com",
  "n210519@rguktn.ac.in",
  "manojtadikonda5@gmail.com",
  "n210519@rguktn.ac.in",
  "manojtadikonda5@gmail.com",
];

// These are synthetic patients. The real inboxes above are used only as test delivery addresses.
// Scenario labels make it easy to test every important corner of the prototype.
const scenarios = [
  { scenario: "routine", hospital: a, risk: "routine", daysAgo: 1 },
  { scenario: "concerning", hospital: a, risk: "concerning", daysAgo: 2 },
  { scenario: "urgent", hospital: a, risk: "urgent", daysAgo: 2 },
  { scenario: "ambiguous", hospital: a, risk: "unknown", daysAgo: 3 },
  { scenario: "incomplete", hospital: a, risk: "routine", daysAgo: 3 },
  { scenario: "conflicting", hospital: a, risk: "concerning", daysAgo: 4 },
  { scenario: "no-answer-retry", hospital: a, risk: "routine", daysAgo: 4 },
  {
    scenario: "max-retries-manual-follow-up",
    hospital: a,
    risk: "routine",
    daysAgo: 5,
  },
  { scenario: "callback", hospital: a, risk: "routine", daysAgo: 5 },
  {
    scenario: "deadline-pressure",
    hospital: a,
    risk: "concerning",
    daysAgo: 6,
  },
  { scenario: "voice-routine", hospital: b, risk: "routine", daysAgo: 1 },
  { scenario: "tenant-isolation", hospital: b, risk: "concerning", daysAgo: 2 },
];

const makePatient = (s, i, email) => ({
  hospitalId: s.hospital._id,
  externalId: `${s.hospital.code}-P${String(i).padStart(3, "0")}`,
  name: `Demo Patient ${String(i).padStart(3, "0")}`,
  email,
  dischargeDate: new Date(now.getTime() - s.daysAgo * 86400000),
  dischargeStatus: "DISCHARGED",
  communicationConsent: true,
  communicationEligible: true,
  risk: s.risk,
  requirements: ["post-discharge-follow-up"],
  metadata: {
    testScenario: s.scenario,
    testEmail: true,
    notes: "Synthetic demo patient. Do not treat as real clinical data.",
  },
});

const patients = scenarios.map((s, index) =>
  makePatient(s, index + 1, testEmails[index]),
);
await Patient.create(patients);

console.log("\nSeed complete. Test patients:");
patients.forEach((p, index) =>
  console.log(
    `${index + 1}. ${p.externalId} | ${p.email} | ${scenarios[index].scenario} | ${p.risk}`,
  ),
);
console.log("\nCampaigns:", ca._id, cb._id);
console.log("Password for seeded users: demo123");
process.exit(0);
