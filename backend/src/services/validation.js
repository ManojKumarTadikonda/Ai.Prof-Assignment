const classifications = ["routine", "concerning", "urgent", "uncertain"];
export function validateAIOutput(x) {
  if (
    !x ||
    !classifications.includes(x.classification) ||
    !Array.isArray(x.evidence) ||
    typeof x.requires_human_review !== "boolean" ||
    !["low", "medium", "high"].includes(x.uncertainty)
  )
    return { ok: false, reason: "Invalid structured AI output" };
  return { ok: true };
}
export function protocolCheck({ answers, protocol, ai }) {
  const text = answers
    .map((a) => `${a.questionId}: ${a.transcript || a.text || ""}`)
    .join("\n")
    .toLowerCase();
  const hits = [];
  for (const rule of protocol?.rules || []) {
    if (rule.trigger && text.includes(rule.trigger.toLowerCase()))
      hits.push(rule);
  }
  const forced = hits.find(
    (r) => r.classification === "urgent" || r.requiresHumanReview,
  );
  if (forced)
    return {
      matches: true,
      forcedClassification: forced.classification,
      requiresHumanReview: true,
      reason: forced.reason || `Protocol trigger: ${forced.trigger}`,
      hits,
    };
  const conflict = hits.find((r) => r.classification !== ai.classification);
  return {
    matches: !conflict,
    forcedClassification: conflict?.classification || null,
    requiresHumanReview: Boolean(conflict),
    reason: conflict
      ? `AI classification conflicts with protocol trigger ${conflict.trigger}`
      : "",
    hits,
  };
}
export function consensus(assessments) {
  if (!assessments.length)
    return {
      classification: "uncertain",
      requiresHumanReview: true,
      reason: "No assessments",
    };
  const counts = {};
  for (const a of assessments)
    counts[a.classification] = (counts[a.classification] || 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const top = sorted[0];
  const tie = sorted[1] && sorted[1][1] === top[1];
  if (tie)
    return {
      classification: "uncertain",
      requiresHumanReview: true,
      reason: "Assessment disagreement",
    };
  const classification = top[0];
  const anyReview = assessments.some((a) => a.requiresHumanReview);
  return {
    classification,
    requiresHumanReview:
      anyReview ||
      classification === "urgent" ||
      classification === "uncertain",
    reason: anyReview
      ? "One or more assessments require review"
      : "Consensus reached",
  };
}
