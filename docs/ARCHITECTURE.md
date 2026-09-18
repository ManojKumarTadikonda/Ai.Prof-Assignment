# CareFlow Prototype Architecture

```text
React Staff UI / Patient Follow-up UI
                   (Multilingual Text & Audio Follow-up / Review Queue)
                                          |
                                          v
                            Express REST API + Auth/RBAC
                  (Role Enforcement, Hospital/Tenant Isolation)
                                          |
                   +----------------------+----------------------+
                   |                      |                      |
                   v                      v                      v
            Campaign Service         Queue Engine            AI Pipeline
                   |                      |                  (Dual-Pass)
                   |               • Atomic claim                |
                   |               • Capacity lease              +-- Tenant Protocol Load
                   |               • Retries & callbacks         +-- Gemini Pass 1
                   |               • Deadline control            +-- Gemini Pass 2
                   |                                             +-- Consensus Check
                   |                                             +-- Protocol Evaluation
                   |                                                     |
                   |                        +----------------------------+
                   |                        |
                   |                        v
                   |              Case Classification Decision
                   |                        |
                   |         +--------------+--------------+
                   |         | Routine                     | Urgent / Concerning
                   |         v                             v
                   |   Controlled Tools         [HUMAN REVIEW ESCALATION PATH]
                   |         |                  • State -> HUMAN_REVIEW
                   |         |                  • Escalation created & queued
                   |         |                  • Reviewer claim & acknowledge
                   |         |                  • Clinical notes & manual resolve
                   |         |                             |
                   +---------+--------------+--------------+
                                            |
                                            v
                                     Controlled Layers
                                            |
                         +------------------+------------------+
                         |                                     |
                         v                                     v
               Mock EHR Layer Interface              Tenant Knowledge Retrieval
            (Gated; No direct AI writes;             (Hospital-scoped protocols
             reserved for verified rules)               & source references)
                         |                                     |
                         +------------------+------------------+
                                            |
                                            v
                                         MongoDB
                               (State, Queues, Tenants)
                                            |
                         +------------------+------------------+
                         |                  |                  |
                         v                  v                  v
                    Audit Logs       Workflow Events        AI Usage
                   (Full trace:       (State machine:      (Tokens, latency,
                   claims/reviews)     HUMAN_REVIEW)         dual-passes)
                         |                  |                  |
                         +------------------+------------------+
                                            |
                                            v
                           Operational Dashboard & Simulation
                       (Live Metrics, Reset/Step deterministic
                        evaluation using the same 30 patients)
```

## Boundaries

- Authentication and tenant scope are enforced before hospital-scoped operations.
- Queue capacity is centrally reserved in MongoDB and protected by atomic updates.
- AI output is treated as untrusted until schema validation and deterministic protocol checks complete.
- AI does not receive unrestricted database access; application operations are exposed through controlled tools.
- Mock EHR operations are separated behind an interface so a future FHIR/EHR adapter can replace the mock implementation.
- Knowledge retrieval is hospital-scoped and returns source references used by the AI pipeline.
- Background queue, simulation and workflow processing are observable through persisted state and dashboard metrics.
