// Shared deterministic demo scenarios. These are behaviors attached to the
// seeded demo patients/tasks; they do NOT create a second simulation dataset.
export const DEMO_SCENARIOS = [
  { key: "routine-01", risk: "routine", outcome: ["COMPLETED"] },
  { key: "routine-02", risk: "routine", outcome: ["NO_ANSWER", "COMPLETED"] },
  { key: "routine-03", risk: "routine", outcome: ["BUSY", "COMPLETED"] },
  { key: "routine-04", risk: "routine", outcome: ["VOICEMAIL", "COMPLETED"] },
  { key: "routine-05", risk: "routine", outcome: ["DROPPED", "COMPLETED"] },
  { key: "routine-06", risk: "routine", outcome: ["CALLBACK", "COMPLETED"] },
  { key: "concerning-01", risk: "concerning", outcome: ["ESCALATED"] },
  { key: "concerning-02", risk: "concerning", outcome: ["NO_ANSWER", "ESCALATED"] },
  { key: "concerning-03", risk: "concerning", outcome: ["COMPLETED"] },
  { key: "concerning-04", risk: "concerning", outcome: ["BUSY", "COMPLETED"] },
  { key: "urgent-01", risk: "urgent", outcome: ["ESCALATED"] },
  { key: "urgent-02", risk: "urgent", outcome: ["ESCALATED"] },
  { key: "urgent-03", risk: "urgent", outcome: ["DROPPED", "ESCALATED"] },
  { key: "urgent-04", risk: "urgent", outcome: ["COMPLETED"] },
  { key: "unknown-01", risk: "unknown", outcome: ["ESCALATED"] },
  { key: "unknown-02", risk: "unknown", outcome: ["NO_ANSWER", "NO_ANSWER", "NO_ANSWER"] },
  { key: "deadline-01", risk: "concerning", outcome: ["NO_ANSWER", "COMPLETED"] },
  { key: "deadline-02", risk: "routine", outcome: ["BUSY", "VOICEMAIL", "COMPLETED"] },
  { key: "deadline-03", risk: "urgent", outcome: ["ESCALATED"] },
  { key: "callback-01", risk: "routine", outcome: ["CALLBACK", "COMPLETED"] },
  { key: "callback-02", risk: "concerning", outcome: ["CALLBACK", "ESCALATED"] },
  { key: "dropped-01", risk: "routine", outcome: ["DROPPED", "NO_ANSWER", "COMPLETED"] },
  { key: "retry-limit-01", risk: "routine", outcome: ["NO_ANSWER", "NO_ANSWER", "NO_ANSWER"] },
  { key: "retry-limit-02", risk: "concerning", outcome: ["BUSY", "VOICEMAIL", "NO_ANSWER"] },
  { key: "routine-07", risk: "routine", outcome: ["COMPLETED"] },
  { key: "routine-08", risk: "routine", outcome: ["NO_ANSWER", "COMPLETED"] },
  { key: "concerning-05", risk: "concerning", outcome: ["ESCALATED"] },
  { key: "urgent-05", risk: "urgent", outcome: ["ESCALATED"] },
  { key: "routine-09", risk: "routine", outcome: ["VOICEMAIL", "COMPLETED"] },
  { key: "deadline-04", risk: "concerning", outcome: ["DROPPED", "COMPLETED"] },
];

export function scenarioByKey(key) {
  return DEMO_SCENARIOS.find((x) => x.key === key) || DEMO_SCENARIOS[0];
}
