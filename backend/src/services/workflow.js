import { WorkflowEvent } from "../models/index.js";

export async function createWorkflowEvent({
  hospitalId,
  type,
  entityType,
  entityId,
  payload = {},
  idempotencyKey,
}) {
  if (!idempotencyKey) throw new Error("Workflow event idempotencyKey is required");
  try {
    return await WorkflowEvent.create({
      hospitalId,
      type,
      entityType,
      entityId: String(entityId),
      payload,
      idempotencyKey,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return WorkflowEvent.findOne({ idempotencyKey });
    }
    throw error;
  }
}

export async function processPendingEvents(limit = 50) {
  const events = await WorkflowEvent.find({ status: "PENDING" })
    .sort({ createdAt: 1 })
    .limit(limit);
  let processed = 0;
  for (const event of events) {
    const claimed = await WorkflowEvent.findOneAndUpdate(
      { _id: event._id, status: "PENDING" },
      { $set: { status: "PROCESSING" }, $inc: { attempts: 1 } },
      { returnDocument: 'after' },
    );
    if (!claimed) continue;
    try {
      // The prototype records workflow events centrally. Domain side effects are
      // already performed by their guarded services, so replaying an event is safe.
      await WorkflowEvent.updateOne(
        { _id: claimed._id },
        { $set: { status: "COMPLETED", processedAt: new Date() } },
      );
      processed++;
    } catch (error) {
      await WorkflowEvent.updateOne(
        { _id: claimed._id },
        { $set: { status: "FAILED", error: error?.message || "Event failed" } },
      );
    }
  }
  return processed;
}
