import {
  AIAssessment,
  Campaign,
  Communication,
  EHRRecord,
  Escalation,
  Hospital,
  OutreachSession,
  OutreachTask,
  PatientResponse,
  SimulationRun,
} from "../models/index.js";
import { processQueueOnce } from "./queue.js";
import { audit } from "./audit.js";
import { scenarioByKey } from "../utils/demoScenarios.js";

/*
 * The PRD simulation uses the SAME seeded demo patients as the normal product.
 * There is no second "simulation patient" dataset. The simulation simply
 * attaches deterministic outcomes to the demo outreach tasks so the evaluator
 * can watch queue behavior without paid telephony.
 */

export async function ensureSimulationRun(hospitalId) {
  return SimulationRun.findOneAndUpdate(
    { hospitalId },
    { $setOnInsert: { hospitalId, status: "IDLE", speedMs: 2500 } },
    { upsert: true, returnDocument: 'after' },
  );
}

export async function resetSimulation(hospitalId) {
  const hospital = await Hospital.findById(hospitalId).lean();
  if (!hospital) throw new Error("Hospital not found");

  const campaign = await Campaign.findOne({
    hospitalId,
    status: { $in: ["RUNNING", "READY", "PAUSED"] },
  }).sort({ priority: -1 });
  if (!campaign) throw new Error("Activate a campaign and run eligibility before starting the queue simulation");

  const tasks = await OutreachTask.find({
    hospitalId,
    "simulation.enabled": true,
  }).populate("patientId campaignId");

  if (!tasks.length) {
    throw new Error("No demo outreach tasks found. Run Campaigns → Eligibility first.");
  }

  console.log(`[SIMULATION] Resetting existing demo tasks | hospital=${hospital.name} | tasks=${tasks.length}`);

  const taskIds = tasks.map((task) => task._id);
  await Promise.all([
    Escalation.deleteMany({ hospitalId, outreachTaskId: { $in: taskIds } }),
    Communication.deleteMany({ hospitalId, outreachTaskId: { $in: taskIds } }),
    EHRRecord.deleteMany({ hospitalId, patientId: { $in: tasks.map((x) => x.patientId?._id).filter(Boolean) } }),
    AIAssessment.deleteMany({ hospitalId, outreachTaskId: { $in: taskIds } }),
    PatientResponse.deleteMany({ hospitalId, outreachTaskId: { $in: taskIds } }),
    OutreachSession.deleteMany({ hospitalId, outreachTaskId: { $in: taskIds } }),
  ]);

  for (const task of tasks) {
    const scenario = scenarioByKey(task.patientId?.metadata?.demoScenario);
    task.status = "PENDING";
    task.attempts = 0;
    task.nextAttemptAt = null;
    task.callbackAt = null;
    task.callbackRequestedAt = null;
    task.manualFollowUpAt = null;
    task.lockId = null;
    task.lockedAt = null;
    task.leaseExpiresAt = null;
    task.reservation = undefined;
    task.lastError = null;
    task.lastOutcome = null;
    task.lastAttemptAt = null;
    task.contactedAt = null;
    task.completedAt = null;
    task.aiProcessingStatus = "NOT_STARTED";
    task.aiProcessingError = null;
    task.aiProcessedAt = null;
    task.outcomeHistory = [];
    task.simulation = {
      enabled: true,
      scenario: scenario.key,
      outcomes: scenario.outcome,
      outcomeIndex: 0,
      outcomeDueAt: null,
      currentOutcome: null,
    };
    await task.save();
    console.log(`[SIMULATION] Reset task=${task._id} | patient=${task.patientId?.name} | scenario=${scenario.key} | outcomes=${scenario.outcome.join(" → ")}`);
  }

  await Hospital.updateOne({ _id: hospitalId }, { $set: { activeOutboundCount: 0 } });

  const run = await SimulationRun.findOneAndUpdate(
    { hospitalId },
    {
      $set: {
        status: "IDLE",
        tick: 0,
        speedMs: 2500,
        startedAt: null,
        completedAt: null,
        lastTickAt: null,
        totalTasks: tasks.length,
      },
    },
    { upsert: true, returnDocument: 'after' },
  );

  await audit({
    hospitalId,
    action: "QUEUE_SIMULATION_RESET",
    entityType: "SimulationRun",
    entityId: String(run._id),
    details: {
      totalTasks: tasks.length,
      capacity: hospital.outboundCapacity,
      usesSeededDemoPatients: true,
    },
  });

  console.log(`[SIMULATION] Reset complete | ${tasks.length} existing demo patients/tasks ready`);
  return run;
}

export async function stepSimulation(hospitalId) {
  const run = await ensureSimulationRun(hospitalId);
  if (run.status !== "RUNNING") return { run, result: null, remaining: await countRemaining(hospitalId) };

  console.log(`[SIMULATION] Tick ${run.tick + 1} | hospital=${hospitalId}`);
  const result = await processQueueOnce({ simulation: true, hospitalIds: [hospitalId] });
  const remaining = await countRemaining(hospitalId);
  const nextStatus = remaining === 0 ? "COMPLETED" : "RUNNING";

  const updated = await SimulationRun.findOneAndUpdate(
    { hospitalId },
    {
      $inc: { tick: 1 },
      $set: {
        lastTickAt: new Date(),
        status: nextStatus,
        completedAt: remaining === 0 ? new Date() : null,
      },
    },
    { returnDocument: 'after'},
  );

  console.log(`[SIMULATION] Tick complete | processed=${result.processed} | remaining=${remaining} | status=${nextStatus}`);
  return { run: updated, result, remaining };
}

async function countRemaining(hospitalId) {
  return OutreachTask.countDocuments({
    hospitalId,
    "simulation.enabled": true,
    status: { $nin: ["COMPLETED", "ESCALATED", "MANUAL_FOLLOW_UP", "FAILED"] },
  });
}

export async function startSimulation(hospitalId) {
  let run = await ensureSimulationRun(hospitalId);
  const taskCount = await OutreachTask.countDocuments({ hospitalId, "simulation.enabled": true });
  if (taskCount === 0) throw new Error("No demo outreach tasks found. Run Campaigns → Eligibility first.");

  if (run.status === "COMPLETED") run = await resetSimulation(hospitalId);

  const updated = await SimulationRun.findOneAndUpdate(
    { hospitalId },
    { $set: { status: "RUNNING", startedAt: new Date(), completedAt: null } },
    { returnDocument: 'after' },
  );
  console.log(`[SIMULATION] Started | hospital=${hospitalId} | tasks=${taskCount}`);
  return updated;
}

export async function pauseSimulation(hospitalId) {
  const run = await SimulationRun.findOneAndUpdate(
    { hospitalId },
    { $set: { status: "PAUSED" } },
    { returnDocument: 'after'},
  );
  console.log(`[SIMULATION] Paused | hospital=${hospitalId}`);
  return run;
}
