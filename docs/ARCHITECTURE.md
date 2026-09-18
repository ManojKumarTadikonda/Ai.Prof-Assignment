# CareFlow Prototype Architecture

```text
React Staff UI / Patient Follow-up UI
                 |
                 v
        Express REST API + Auth/RBAC
                 |
      +----------+-----------+
      |          |           |
      v          v           v
 Campaign     Queue       AI Pipeline
 Service      Engine      (existing core)
      |          |           |
      |      atomic claim    +-- Gemini Pass 1
      |      lease/capacity  +-- Gemini Pass 2
      |      retries         +-- schema validation
      |      callbacks       +-- protocol check
      |      deadlines       +-- consensus
      |                         |
      |                    Controlled Tools
      |                         |
      +------------+------------+----------+
                   |                       |
                   v                       v
             Mock EHR Layer          Tenant Knowledge
                   |                  Retrieval Layer
                   +---------+-------------+
                             |
                             v
                          MongoDB
                             |
           +-----------------+------------------+
           |                 |                  |
        Audit Logs      Workflow Events    AI Usage
           |                 |                  |
           +-----------------+------------------+
                             |
                      Operational Dashboard
                             |
                     Queue Simulation
```

## Boundaries

- Authentication and tenant scope are enforced before hospital-scoped operations.
- Queue capacity is centrally reserved in MongoDB and protected by atomic updates.
- AI output is treated as untrusted until schema validation and deterministic protocol checks complete.
- AI does not receive unrestricted database access; application operations are exposed through controlled tools.
- Mock EHR operations are separated behind an interface so a future FHIR/EHR adapter can replace the mock implementation.
- Knowledge retrieval is hospital-scoped and returns source references used by the AI pipeline.
- Background queue, simulation and workflow processing are observable through persisted state and dashboard metrics.
