import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { connectDB } from "./config/db.js";
import auth from "./routes/auth.js";
import hospitals from "./routes/hospitals.js";
import patients from "./routes/patients.js";
import campaigns from "./routes/campaigns.js";
import queue from "./routes/queue.js";
import patient from "./routes/patient.js";
import reviews from "./routes/reviews.js";
import dashboard from "./routes/dashboard.js";
import simulation from "./routes/simulation.js";
import knowledge from "./routes/knowledge.js";
import { errorHandler } from "./middleware/error.js";
import { startWorker } from "./workers/queueWorker.js";
await connectDB();
const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(
  "/api/patient",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }),
  patient,
);
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }), auth);
app.use("/api/hospitals", hospitals);
app.use("/api/patients", patients);
app.use("/api/campaigns", campaigns);
app.use("/api/queue", queue);
app.use("/api/reviews", reviews);
app.use("/api/dashboard", dashboard);
app.use("/api/simulation", simulation);
app.use("/api/knowledge", knowledge);
app.get("/health", (req, res) =>
  res.json({
    ok: true,
    status: "Healthy",
    service: "careflow-backend",
    time: new Date().toISOString(),
  }),
);
app.get("/health/system", async (req, res) => {
  try {
    const { WorkflowEvent, OutreachTask, Hospital } =
      await import("./models/index.js");
    const [h, stuck, failedEvents] = await Promise.all([
      Hospital.countDocuments({ status: "ACTIVE" }),
      OutreachTask.countDocuments({
        status: { $in: ["RESERVED", "CALLING", "CONNECTED"] },
        leaseExpiresAt: { $lt: new Date() },
      }),
      WorkflowEvent.countDocuments({ status: "FAILED" }),
    ]);
    res.json({
      status: stuck || failedEvents ? "Degraded" : "Healthy",
      activeHospitals: h,
      stuckTasks: stuck,
      failedWorkflowEvents: failedEvents,
      time: new Date().toISOString(),
    });
  } catch (e) {
    res.status(503).json({ status: "Unavailable", message: e.message });
  }
});
app.use(errorHandler);
app.listen(env.port, () => console.log(`CareFlow backend on ${env.port}`));
startWorker();
