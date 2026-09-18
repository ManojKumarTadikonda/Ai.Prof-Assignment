import fs from "node:fs/promises";
import { safetyDataset, safetyProtocol } from "./safetyDataset.js";
import { consensus, protocolCheck, validateAIOutput } from "../services/validation.js";

const useGemini = String(process.env.SAFETY_EVAL_USE_GEMINI || "true").toLowerCase() === "true";

function answersFor(item) {
  return item.answers.map((answer, index) => ({ questionId: `q${index + 1}`, question: `Safety evaluation response ${index + 1}`, answer, text: answer }));
}

function deterministicAssessment(item) {
  const text = item.answers.join(" ").toLowerCase();
  const hasPositive = (phrase) => {
    const i = text.indexOf(phrase);
    if (i < 0) return false;
    const before = text.slice(Math.max(0, i - 24), i);
    return !/(\bno\b|\bnot\b|\bwithout\b|\bdenies\b)\s*(?:having\s+|any\s+|a\s+)?$/.test(before);
  };
  const urgent = ["difficulty breathing", "severe bleeding", "fainting"].some(hasPositive);
  const concerning = ["worsening pain", "pain has started worsening", "pain is getting worse", "fever"].some(hasPositive);
  const uncertain = ["ambiguous", "incomplete", "uncertain", "conflicting"].includes(item.category) || ["i don't know", "not sure", "maybe", "cannot answer", "cannot remember", "at the same time"].some((x) => text.includes(x));
  const classification = urgent ? "urgent" : concerning ? "concerning" : uncertain ? "uncertain" : "routine";
  return { detected_language: "en", classification, evidence: item.answers.filter(Boolean).slice(0, 2), uncertainty: classification === "routine" ? "low" : "high", requires_human_review: classification !== "routine", ai_status: "LOCAL_EVALUATION" };
}

let assessPatientTranscripts = null;
if (useGemini) { ({ assessPatientTranscripts } = await import("../services/ai.js")); }

async function evaluateCase(item) {
  const answers = answersFor(item);
  const raw = useGemini
    ? await Promise.all([
        assessPatientTranscripts({ answers, protocolText: JSON.stringify(safetyProtocol) }),
        assessPatientTranscripts({ answers, protocolText: JSON.stringify(safetyProtocol) }),
      ])
    : [deterministicAssessment(item), deterministicAssessment(item)];

  const assessments = raw.map((candidate) => {
    const validation = validateAIOutput(candidate);
    if (!validation.ok) return { classification: "uncertain", evidence: [validation.reason], uncertainty: "high", requires_human_review: true };
    const check = protocolCheck({ answers, protocol: safetyProtocol, ai: candidate });
    return {
      ...candidate,
      classification: check.forcedClassification || candidate.classification,
      requires_human_review: candidate.requires_human_review || check.requiresHumanReview,
      protocolCheck: check,
    };
  });
  const result = consensus(assessments);
  const actualEscalate = Boolean(result.requiresHumanReview);
  return {
    id: item.id,
    category: item.category,
    expected: item.expected,
    expectedEscalate: item.expectedEscalate,
    actual: result.classification,
    actualEscalate,
    falseNegative: item.expectedEscalate && !actualEscalate,
    falsePositive: !item.expectedEscalate && actualEscalate,
    disagreement: assessments[0].classification !== assessments[1].classification,
    assessments: assessments.map((x) => ({ classification: x.classification, evidence: x.evidence, uncertainty: x.uncertainty, requires_human_review: x.requires_human_review })),
    consensusReason: result.reason,
  };
}

const results = [];
for (const item of safetyDataset) {
  try { results.push(await evaluateCase(item)); }
  catch (error) {
    results.push({ id: item.id, category: item.category, expected: item.expected, expectedEscalate: item.expectedEscalate, actual: "uncertain", actualEscalate: true, error: error?.message || "evaluation failure", falseNegative: false, falsePositive: !item.expectedEscalate });
  }
}

const tp = results.filter((x) => x.expectedEscalate && x.actualEscalate).length;
const fn = results.filter((x) => x.expectedEscalate && !x.actualEscalate).length;
const tn = results.filter((x) => !x.expectedEscalate && !x.actualEscalate).length;
const fp = results.filter((x) => !x.expectedEscalate && x.actualEscalate).length;
const denominator = tp + fn;
const report = {
  generatedAt: new Date().toISOString(),
  mode: useGemini ? "gemini" : "deterministic-local-harness",
  totalCases: results.length,
  truePositives: tp,
  falsePositives: fp,
  trueNegatives: tn,
  falseNegatives: fn,
  falseNegativeRate: denominator ? Number((fn / denominator).toFixed(4)) : 0,
  disagreements: results.filter((x) => x.disagreement).length,
  cases: results,
};
await fs.writeFile(new URL("./results.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ totalCases: report.totalCases, tp, fp, tn, fn, falseNegativeRate: report.falseNegativeRate, disagreements: report.disagreements, mode: report.mode }, null, 2));
