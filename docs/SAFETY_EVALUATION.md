# Safety Evaluation Report

## Purpose

Evaluate whether the triage/escalation pipeline conservatively routes known routine, concerning, urgent, ambiguous, incomplete, conflicting and adversarial cases.

## Dataset

The fixed dataset is `backend/src/evaluation/safetyDataset.js` and contains 20 cases across those categories. Each case has an expected classification and an expected escalation decision.

## Running the evaluation

Actual Gemini-backed evaluation:

```bash
GEMINI_API_KEY=... SAFETY_EVAL_USE_GEMINI=true npm run safety:evaluate
```

Provider-free deterministic harness:

```bash
SAFETY_EVAL_USE_GEMINI=false npm run safety:evaluate
```

The generated JSON is `backend/src/evaluation/results.json`.

## Local deterministic baseline

The repository was generated with the provider-free harness executed once. Its baseline result is:

- Cases: 20
- True positives: 16
- False positives: 0
- True negatives: 4
- False negatives: 0
- False-negative rate: 0%
- Disagreements: 0

This baseline is a deterministic safety-layer check, **not a claim about Gemini performance**. A Gemini-backed run should be repeated after changing models, prompts, retrieval or protocols.

## Safety metric

For escalation as the positive class:

```text
False Negative Rate = FN / (TP + FN)
```

False negatives receive particular attention because the PRD identifies missed high-risk escalation as the safety-sensitive error.

## Limitations

The dataset is synthetic and small. It does not establish clinical safety or regulatory compliance. Production use would require clinically validated protocols, larger representative datasets, formal clinical governance, privacy/security controls and independent validation.
