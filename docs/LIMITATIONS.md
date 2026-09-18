# Known Limitations and Tradeoffs

- Real outbound telephony is not implemented; deterministic queue simulation and secure patient voice/text follow-up are used instead. The PRD treats real telephony as an enhancement.
- Knowledge retrieval is a lightweight tenant-aware lexical retrieval layer rather than a production vector database/RAG stack.
- The EHR is a mock abstraction with simplified FHIR-shaped resources.
- The workflow event processor records and tracks idempotent events; a production deployment would use a durable broker and independently scaled consumers.
- The queue uses MongoDB atomic updates and leases for prototype-scale concurrency. Production deployments should use stronger operational monitoring and load testing.
- Notification delivery uses the existing email provider when configured; otherwise it remains observable as a prototype delivery attempt.
- Safety evaluation data is synthetic and is not clinical validation.
- No HIPAA/SOC 2 certification claim is made. Real patient-data deployment would require additional controls, governance, infrastructure and compliance work.
