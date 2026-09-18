import { Router } from "express";
import bcrypt from "bcryptjs";
import { Hospital, User } from "../models/index.js";
import { auth, roles } from "../middleware/auth.js";
import { audit } from "../services/audit.js";

const r = Router();
r.use(auth);

r.get("/", async (req, res, next) => {
  try {
    const q = req.user.role === "PLATFORM_ADMIN" ? {} : { _id: req.user.hospitalId };
    res.json(await Hospital.find(q).lean());
  } catch (e) { next(e); }
});

r.post("/", roles("PLATFORM_ADMIN"), async (req, res, next) => {
  try {
    const hospital = await Hospital.create(req.body);
    await audit({ action: "HOSPITAL_CREATED", entityType: "Hospital", entityId: String(hospital._id), details: { code: hospital.code }, hospitalId: hospital._id });
    res.status(201).json(hospital);
  } catch (e) { next(e); }
});

r.patch("/:id/config", roles("PLATFORM_ADMIN", "HOSPITAL_ADMIN"), async (req, res, next) => {
  try {
    if (req.user.role !== "PLATFORM_ADMIN" && String(req.user.hospitalId) !== String(req.params.id)) return res.status(403).json({ message: "Forbidden" });
    const allowed = ["name", "contactEmail", "contactPhone", "timezone", "callingHours", "outboundCapacity", "retry", "notificationPreferences", "escalationContacts", "mockEhr"];
    const patch = {};
    for (const key of allowed) if (req.body[key] !== undefined) patch[key] = req.body[key];
    console.log(`[HOSPITAL] Updating configuration | hospital=${req.params.id} | fields=${Object.keys(patch).join(",")}`);
    const hospital = await Hospital.findByIdAndUpdate(req.params.id, { $set: patch }, { returnDocument: 'after', runValidators: true });
    if (!hospital) return res.status(404).json({ message: "Hospital not found" });
    await audit({ hospitalId: hospital._id, actorType: "USER", actorId: String(req.user._id), action: "HOSPITAL_CONFIG_UPDATED", entityType: "Hospital", entityId: String(hospital._id), details: { fields: Object.keys(patch) } });
    console.log(`[HOSPITAL] Configuration saved | hospital=${hospital.name}`);
    res.json(hospital);
  } catch (e) { next(e); }
});

r.post("/:id/ready", roles("PLATFORM_ADMIN", "HOSPITAL_ADMIN"), async (req, res, next) => {
  try {
    if (req.user.role !== "PLATFORM_ADMIN" && String(req.user.hospitalId) !== String(req.params.id)) return res.status(403).json({ message: "Forbidden" });
    const hospital = await Hospital.findByIdAndUpdate(req.params.id, { $set: { status: "ACTIVE" } }, { returnDocument: 'after'});
    if (!hospital) return res.status(404).json({ message: "Hospital not found" });
    res.json(hospital);
  } catch (e) { next(e); }
});

r.post("/:id/users", roles("PLATFORM_ADMIN", "HOSPITAL_ADMIN"), async (req, res, next) => {
  try {
    if (req.user.role !== "PLATFORM_ADMIN" && String(req.user.hospitalId) !== String(req.params.id)) return res.status(403).json({ message: "Forbidden" });
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !["HOSPITAL_ADMIN", "CAMPAIGN_MANAGER", "CLINICAL_REVIEWER"].includes(role)) return res.status(400).json({ message: "name, email, password and a valid hospital role are required" });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash, role, hospitalId: req.params.id });
    res.status(201).json({ id: user._id, name: user.name, email: user.email, role: user.role, hospitalId: user.hospitalId });
  } catch (e) { next(e); }
});

r.get("/:id/users", roles("PLATFORM_ADMIN", "HOSPITAL_ADMIN"), async (req, res, next) => {
  try {
    if (req.user.role !== "PLATFORM_ADMIN" && String(req.user.hospitalId) !== String(req.params.id)) return res.status(403).json({ message: "Forbidden" });
    res.json(await User.find({ hospitalId: req.params.id }).select("name email role active createdAt").lean());
  } catch (e) { next(e); }
});

export default r;
