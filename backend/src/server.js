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
app.get("/health", (req, res) => res.json({ ok: true }));
app.use(errorHandler);
app.listen(env.port, () => console.log(`CareFlow backend on ${env.port}`));
startWorker();
