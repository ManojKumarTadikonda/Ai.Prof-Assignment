import assert from "node:assert/strict";
import { priorityScore, deadlinePressure } from "../utils/priority.js";
import { consensus, protocolCheck, validateAIOutput } from "../services/validation.js";


const patient = { risk: "urgent" };
const campaign = { priority: 20 };
const task = { deadline: new Date(Date.now() + 60 * 60000), attempts: 0, createdAt: new Date() };
assert.equal(deadlinePressure(task.deadline) >= 70, true);
assert.equal(priorityScore({ patient, campaign, task }) > 100, true);

const valid = { classification: "routine", evidence: ["improving"], uncertainty: "low", requires_human_review: false };
assert.equal(validateAIOutput(valid).ok, true);
assert.equal(validateAIOutput({ ...valid, classification: "bad" }).ok, false);

const c = consensus([
  { classification: "routine", requires_human_review: false },
  { classification: "routine", requires_human_review: false },
]);
assert.equal(c.classification, "routine");
assert.equal(c.requiresHumanReview, false);

const disagreement = consensus([
  { classification: "routine", requires_human_review: false },
  { classification: "urgent", requires_human_review: true },
]);
assert.equal(disagreement.requiresHumanReview, true);
assert.equal(disagreement.classification, "uncertain");

const protocol = { rules: [{ trigger: "difficulty breathing", classification: "urgent", requiresHumanReview: true, reason: "Urgent trigger" }] };
const check = protocolCheck({ answers: [{ questionId: "q1", text: "I have difficulty breathing" }], protocol, ai: valid });
assert.equal(check.requiresHumanReview, true);
assert.equal(check.forcedClassification, "urgent");

console.log("Core CareFlow tests passed.");

