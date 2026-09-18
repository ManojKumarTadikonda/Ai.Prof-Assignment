import { Router } from "express";
import { auth, roles, tenantScope } from "../middleware/auth.js";
import { SimulationRun, OutreachTask, Hospital } from "../models/index.js";
import { ensureSimulationRun, resetSimulation, startSimulation, pauseSimulation, stepSimulation } from "../services/simulation.js";

const r = Router();
r.use(auth);
const allowed = roles("PLATFORM_ADMIN", "HOSPITAL_ADMIN", "CAMPAIGN_MANAGER");
r.use(allowed);

async function hospitalId(req) {
  if (req.user.role !== "PLATFORM_ADMIN") return req.user.hospitalId;
  if (req.body?.hospitalId || req.query?.hospitalId) return req.body.hospitalId || req.query.hospitalId;
  const h = await Hospital.findOne({ status: "ACTIVE" }).select("_id").lean();
  return h?._id;
}

r.get("/status", async (req, res, next) => {
  try {
    const id = await hospitalId(req);
    if (!id) return res.status(400).json({ message: "hospitalId is required for Platform Admin" });
    const run = await ensureSimulationRun(id);
    const [tasks, active] = await Promise.all([
      OutreachTask.find({ hospitalId: id, "simulation.enabled": true }).sort({ priorityScore: -1, deadline: 1 }).populate("patientId campaignId").lean(),
      OutreachTask.countDocuments({ hospitalId: id, status: { $in: ["RESERVED", "CALLING", "CONNECTED"] } }),
    ]);
    res.json({ run, active, tasks });
  } catch (e) { next(e); }
});

r.post("/reset", async (req, res, next) => {
  try { res.json(await resetSimulation(await hospitalId(req))); } catch (e) { next(e); }
});
r.post("/start", async (req, res, next) => {
  try { res.json(await startSimulation(await hospitalId(req))); } catch (e) { next(e); }
});
r.post("/pause", async (req, res, next) => {
  try { res.json(await pauseSimulation(await hospitalId(req))); } catch (e) { next(e); }
});
r.post("/step", async (req, res, next) => {
  try { res.json(await stepSimulation(await hospitalId(req))); } catch (e) { next(e); }
});

export default r;
