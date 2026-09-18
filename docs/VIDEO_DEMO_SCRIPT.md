# CareFlow AI — Final Demo Video Script

## Demo data

- Two seeded hospitals: Apollo Demo Hospital and CityCare Demo Hospital.
- 30 seeded demo patients total: 24 for Hospital A and 6 for Hospital B.
- Only two test inboxes are used for all demo email delivery (patient outreach and demo clinical notifications):
  - `n210519@rguktn.ac.in`
  - `manojtadikonda5@gmail.com`
- Staff demo password: `demo123`.
- There is no second simulation-patient dataset. Queue Simulation reuses the same seeded demo patients/tasks created by Campaign → Eligibility.
- Real telephony is intentionally not used; the secure email + text/voice patient portal demonstrates the outreach workflow.

## 12–15 minute recording flow

### 1. Introduction

Say:

> Hello, my name is Manoj. This is my CareFlow AI implementation of the Multi-Hospital Post-Discharge Outreach Platform. The platform manages the complete post-discharge workflow from hospital configuration and patient data through campaign eligibility, queue scheduling, simulated outreach, AI triage, escalation, human review, documentation and the mock EHR.
>
> For the prototype I seeded two hospitals and 30 synthetic demo patients. For patient outreach I use email with a secure follow-up link, where the patient can answer using text or voice. This avoids depending on paid telephony while still demonstrating the complete operational workflow.

### 2. Login

Use:

- `manager@hospital-a.local`
- password `demo123`

Say:

> The application uses authentication, role-based access control and hospital tenant context. This account is a campaign manager for Hospital A.

Watch the backend terminal for `[AUTH]` logs.

### 3. Dashboard

Show the operational cards.

Say:

> The dashboard focuses on operational activity: patients, pending work, completed outreach, escalations, AI processing and EHR activity.

### 4. Hospitals

Show both hospitals and Hospital A configuration.

Say:

> The prototype contains two independent hospital tenants. Hospital configuration includes timezone, calling hours, outbound capacity and retry policy. Patient and campaign operations are scoped to the hospital on the backend.

### 5. Patients

Show the patient list.

Say:

> I seeded 30 demo patients across the two hospitals. The same two test inboxes are reused for all patient records, so the evaluator can actually receive the outreach emails without creating 30 email accounts.

Open one patient and show discharge/clinical data.

### 6. Campaign

Open Campaigns.

Say:

> A campaign defines the post-discharge outreach program and is linked to the hospital-approved protocol. The campaign also has a follow-up window, priority and operational configuration.

### 7. Eligibility

Click `Eligibility`.

Before clicking, show the backend terminal.

Say:

> I am now running eligibility. The backend checks discharge status, communication eligibility and consent, the follow-up window and existing outreach state. Eligible patients become outreach tasks.

Watch for:

- `[ELIGIBILITY] Starting eligibility...`
- `[ELIGIBILITY] Created queue task...`
- `[ELIGIBILITY] Completed...`
- `[AUDIT] ELIGIBILITY_RUN...`

### 8. Queue

Open Outreach Queue.

Say:

> The queue is not FIFO. It uses clinical risk, deadline pressure, campaign priority, retry pressure and callback state to calculate a priority score.

Show the priority column and deadline.

### 9. Process queue / email outreach

Click `Process queue`.

Watch terminal logs.

Expected log groups:

- `[QUEUE] ===== PROCESS START | mode=EMAIL OUTREACH =====`
- `[QUEUE] Attempting capacity reservation...`
- `[QUEUE] Capacity slot reserved...`
- `[QUEUE] Task atomically claimed...`
- `[OUTREACH] Preparing email outreach...`
- `[OUTREACH] Sending secure follow-up email...`
- `[OUTREACH] Email delivered...`
- `[AUDIT] OUTREACH_SENT...`

Say:

> The hospital has a limited outbound capacity. Before processing a task, the backend reserves capacity and atomically claims the task. This prevents two workers from processing the same task and prevents the concurrency limit from being exceeded.
>
> The prototype then sends a secure email instead of making a paid outbound phone call.

### 10. Patient email

Open one of the two inboxes and open the CareFlow email.

Say:

> The email contains a secure, expiring patient follow-up link. The patient does not need a staff account.

Open the link.

### 11. Patient response

For a routine case, answer all questions with responses such as:

- Feeling better since discharge.
- Pain is improving.
- No fever or chills.
- No new or worsening symptoms.
- No additional concerns.

Use text for a couple of questions and voice for at least one question.

Say:

> The patient can answer each protocol question with text or voice. The voice recording is stored securely and becomes part of the outreach record.

Click `Submit follow-up`.

### 12. AI processing

Immediately switch to the backend terminal.

Watch for:

- `[PATIENT] Follow-up submitted...`
- `[AI] ===== START PROCESSING...`
- `[AI] Hospital protocol loaded...`
- `[AI] Tenant-aware knowledge retrieval complete...`
- `[AI] Assessment #1 started...`
- `[AI] Assessment #1 completed...`
- `[AI] Assessment #2 started...`
- `[AI] Assessment #2 completed...`
- `[PROTOCOL] Assessment...`
- `[CONSENSUS] Comparing...`
- `[CONSENSUS] Result...`
- `[EHR] Controlled routine update requested...`
- `[EHR] Record created...`
- `[AI] ===== PROCESS COMPLETE...`

Say:

> The patient receives an immediate submission response, while AI processing continues in the backend. Two independent structured assessments are produced. Their outputs are validated, checked against hospital protocol evidence and then passed through a deterministic consensus layer.
>
> For a routine result, the controlled EHR layer records the structured outreach result.

### 13. Urgent/escalation case

Use another demo task/patient and submit a response containing a seeded protocol trigger such as `difficulty breathing`.

Say:

> Now I will demonstrate the safety path. This patient reports a protocol-defined red flag.

Show terminal:

- `[PROTOCOL] ... forced=urgent ...`
- `[CONSENSUS] ... humanReview=true ...`
- `[ESCALATION] Creating clinical review...`
- `[NOTIFICATION] ...`

Say:

> The deterministic protocol layer can force a safety escalation. If the independent assessments disagree or the information is uncertain, the system uses a conservative human-review path rather than silently downgrading the case.

### 14. Clinical Review

Open Clinical Review.

Assign/acknowledge the escalation and resolve it.

Say:

> Escalations are first-class records. The reviewer can inspect the patient context, responses, AI assessments and escalation rationale before recording the human resolution.

Show terminal for `[REVIEW]` and `[AUDIT]` logs.

### 15. Mock EHR

Show the resulting EHR record.

Say:

> The final documentation is sent through the mock EHR abstraction rather than allowing the AI to write directly to MongoDB. The EHR interface can later be replaced by a real healthcare integration.

### 16. Retry and callback

Go back to Queue and show a demo task with a retry/callback scenario. If necessary, use Queue Simulation → Reset first.

Say:

> Failed outcomes such as no answer, busy, voicemail and dropped calls remain explicit queue states. The scheduler records the attempt and uses backoff before retrying. A callback request is stored with an explicit callback time instead of being returned to the generic queue.

Show the task timeline.

### 17. Queue Simulation — same demo patients

Open `Queue Simulation`.

Click `Reset`.

Say:

> This is not a second patient dataset. The queue simulation reuses the same seeded demo patients created for the application. Reset clears the previous queue interaction state and prepares those existing demo tasks for deterministic queue behavior.

Show the count for Hospital A — 24 seeded demo tasks.

Click `Start`.

Watch terminal logs:

- `[SIMULATION] Started...`
- `[SIMULATION] Tick...`
- `[QUEUE] ===== PROCESS START | mode=DEMO SIMULATION =====`
- `[QUEUE] Capacity slot reserved...`
- `[QUEUE] Task atomically claimed...`
- `[QUEUE] Dispatching task...`
- `[QUEUE] Retry scheduled...`
- `[QUEUE] Maximum attempts reached...`
- `[SIMULATION] Tick complete...`

Say:

> The same real demo workload can now be exercised in deterministic simulation mode. The simulation demonstrates constrained capacity, deadline pressure, successful completion, no answer, busy, voicemail, dropped calls, retries, callbacks, escalations and manual follow-up without requiring a telephony provider.

### 18. Safety evaluation

Run:

```bash
npm run safety:evaluate
```

or, when configured for live Gemini evaluation:

```bash
SAFETY_EVAL_USE_GEMINI=true npm run safety:evaluate
```

Say:

> Finally, the project contains a fixed safety evaluation dataset covering routine, concerning, urgent, ambiguous, incomplete, conflicting and adversarial cases. The evaluation reports true positives, true negatives, false positives, false negatives and the false-negative rate.

### 19. Closing

Say:

> To summarize, CareFlow AI is a multi-tenant post-discharge healthcare operations prototype. The same seeded demo patients are used throughout the normal workflow and the queue simulation. The platform connects eligibility, capacity-aware queue scheduling, email-based simulated outreach, text and voice responses, two structured AI assessments, protocol grounding, consensus, human escalation, mock EHR documentation, retries, callbacks, audit logging and operational monitoring.
>
> Real telephony is intentionally left as a replaceable integration because it is not required for the prototype. The focus is the operational workflow, queue correctness, AI safety and human-in-the-loop process.

## Recording tips

- Keep the backend terminal visible whenever you click an action that triggers backend work.
- Do not show `.env` files, Gemini keys, JWT secrets, Cloudinary secrets or SendGrid credentials.
- Use the two seeded patient inboxes only for patient outreach.
- For the routine AI demo, use a patient with the routine scenario and answer all required questions.
- For the safety demo, use a separate demo patient and include a seeded protocol trigger such as `difficulty breathing`.
- Before the queue simulation, click `Reset` so all existing demo tasks start from `PENDING`.
- The simulation is deterministic and reuses the existing demo tasks; it does not create `Simulation Patient XX` records.
