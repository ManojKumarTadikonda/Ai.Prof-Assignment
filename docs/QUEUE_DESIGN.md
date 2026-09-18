# CareFlow Queue Design

## Goal

Coordinate post-discharge outreach while respecting hospital capacity, clinical deadlines, retries, callbacks, campaign priority and worker failure.

## State machine

```text
PENDING -> RESERVED -> CALLING/CONNECTED -> SCHEDULED or terminal outcome
                         |
                         +-> NO_ANSWER/BUSY/VOICEMAIL/DROPPED/FAILED
                                  -> RETRY_SCHEDULED -> RESERVED
                                  -> MANUAL_FOLLOW_UP (max retries/deadline)
                         |
                         +-> CALLBACK_SCHEDULED -> RESERVED
                         |
                         +-> ESCALATED
```

`RESERVED` is an additive internal state used to make capacity reservation observable and atomic. Existing application states remain supported.

## Priority calculation

```text
Priority = Risk + DeadlinePressure + CampaignPriority + RetryPressure + CallbackBonus + AgingBonus
```

Risk: urgent 50, unknown 40, concerning 35, routine 10.

Deadline pressure: expired 90, <2h 70, <6h 50, <12h 35, <24h 20, otherwise 10.

Retry pressure is capped; callbacks receive a fixed bonus; aging prevents starvation of lower-risk tasks.

## Concurrency control

The scheduler first atomically increments `Hospital.activeOutboundCount` only while it is below configured capacity. It then atomically changes one eligible task to `RESERVED` with a unique lease. If the task claim fails, the capacity slot is released.

A task lease expires after two minutes. Stale `RESERVED`, `CALLING` or `CONNECTED` tasks are recovered and either retried or moved to manual follow-up. Capacity is reconciled from active task states before/after queue processing.

## Retries and backoff

Retryable outcomes are `NO_ANSWER`, `BUSY`, `VOICEMAIL`, `DROPPED` and technical `FAILED`. Backoff is exponential from the hospital's configured base delay. The next attempt is allowed only when the clinical deadline and calling window still permit outreach. Maximum attempts produce `MANUAL_FOLLOW_UP`.

## Callbacks

A callback request is stored as `CALLBACK_SCHEDULED` with an explicit `callbackAt` and `nextAttemptAt`. It is not returned to the generic queue until the requested time.

## Calling windows

Real outbound processing respects hospital/campaign calling hours and hospital timezone. The deterministic simulation bypasses wall-clock calling-hour restrictions so evaluators can demonstrate the queue at any time.

## Fairness and starvation

Priority uses deadline pressure and an aging bonus. Sorting also uses deadline and creation time as deterministic tie breakers. A routine patient that waits several hours therefore gains priority rather than remaining indefinitely behind high campaign priorities.

## Idempotency

Workflow events use unique idempotency keys. EHR routine writes also use task-based idempotency keys. Task claims use atomic status transitions and lock IDs to prevent duplicate outbound work.

## Failure recovery

Worker leases, stale-task scanning, capacity reconciliation, retry states and explicit manual follow-up states ensure a worker crash does not permanently consume capacity.
