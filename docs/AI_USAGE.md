# AI Usage Documentation

## Agents / reasoning paths

1. Voice Intake / multimodal assessment: the existing Gemini path transcribes voice responses and produces structured triage output.
2. Independent transcript assessment: the existing second Gemini path evaluates the transcript without relying on the first assessment.
3. Deterministic protocol engine: hospital protocol triggers are checked outside the model.
4. Consensus resolver: two assessments are compared deterministically; disagreement or uncertainty escalates.
5. Documentation/EHR path: only validated routine cases can use the guarded mock EHR operation.

## Structured output

AI output is validated for classification, evidence, uncertainty and human-review flag before application logic uses it.

## Grounding

The application retrieves tenant-scoped hospital knowledge and the selected hospital protocol. Retrieved resources retain a source reference. Patient text is treated as untrusted content and does not override system safety rules.

## Model abstraction

The existing Gemini provider remains the current implementation. AI assessment records now capture provider/model, latency, validation status and retrieval source references where available. The surrounding application services are provider-independent enough to replace the model later.

## Failure handling

Transient Gemini failures are retried by the existing retry helper. Provider-unavailable or malformed results are converted to an uncertain/manual-review path rather than silently treated as routine.
