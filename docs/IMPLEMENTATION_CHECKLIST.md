# PRD Implementation Checklist

| PRD area | Prototype implementation |
|---|---|
| Multi-tenancy / RBAC | Existing JWT + role middleware + hospitalId scoping retained |
| Hospital onboarding | Hospital configuration UI + admin assignment endpoint |
| Patient / discharge data | Existing Patient model retained; added Encounter, Condition, Observation, Medication, CarePlan |
| Campaigns | Lifecycle transitions, workload estimation, eligibility |
| Queue | Atomic capacity reservation, task leasing, priority refresh, deadline pressure |
| Retries | Exponential backoff, max-attempt manual follow-up |
| Call outcomes | Simulation covers completion, no answer, busy, voicemail, dropped, failure |
| Callbacks | Explicit CALLBACK_SCHEDULED and callbackAt |
| Failure recovery | Lease timeout + stale worker recovery + capacity reconciliation |
| Voice / text | Existing patient portal retained |
| AI triage | Existing dual Gemini assessment retained |
| Grounding | Tenant-aware knowledge retrieval + protocol source references |
| Consensus | Existing deterministic consensus retained and strengthened to honor both AI review flags |
| Controlled tools | Patient/protocol/outreach/escalation/EHR tool layer added |
| Mock EHR | Replaceable EHR service abstraction + FHIR-shaped prototype resources |
| Human review | Acknowledge, wait, assign and resolve actions |
| Notifications | Persisted notification records + optional email delivery |
| Events | Idempotent workflow event records |
| Observability | Queue health, dashboard metrics, AI metadata and workflow failures |
| Safety evaluation | 20-case fixed dataset + repeatable metrics |
| Testing | Core automated tests for priority, protocol checks and consensus |
| Queue simulation | Seeded demo patients reused for dynamic start/pause/step/reset; 30 total across two hospitals |
| Real telephony | Intentionally omitted; simulation is the prototype outreach mechanism |
