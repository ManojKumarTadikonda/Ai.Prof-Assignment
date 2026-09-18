import cron from "node-cron";
import { Campaign, SimulationRun } from "../models/index.js";
import { processQueueOnce } from "./queueLogic.js";
import { stepSimulation } from "../services/simulation.js";
import { processPendingEvents } from "../services/workflow.js";

export function startWorker() {
  if (String(process.env.AUTO_QUEUE_WORKER || "false").toLowerCase() !== "true") return;
  cron.schedule("*/1 * * * *", async () => {
    try {
      await Campaign.updateMany(
        { status: "SCHEDULED", startAt: { $lte: new Date() } },
        { $set: { status: "RUNNING" } },
      );
      const result = await processQueueOnce({ simulation: false });
      await processPendingEvents();
      console.log("[QUEUE WORKER] processed queue", result);
    } catch (e) {
      console.error("[QUEUE WORKER]", e);
    }
  });

  setInterval(async () => {
    try {
      const runs = await SimulationRun.find({ status: "RUNNING" }).select("hospitalId").lean();
      for (const run of runs) await stepSimulation(run.hospitalId);
    } catch (e) {
      console.error("[SIMULATION WORKER]", e);
    }
  }, 2500);
}
