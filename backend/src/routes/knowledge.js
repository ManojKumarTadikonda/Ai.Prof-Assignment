import { Router } from "express";
import { KnowledgeResource } from "../models/index.js";
import { auth, roles, tenantScope } from "../middleware/auth.js";
import { audit } from "../services/audit.js";

const r = Router();
r.use(auth);

r.get("/", roles("PLATFORM_ADMIN", "HOSPITAL_ADMIN", "CAMPAIGN_MANAGER", "CLINICAL_REVIEWER"), async (req, res, next) => {
  try { res.json(await KnowledgeResource.find(tenantScope(req)).sort({ createdAt: -1 }).lean()); }
  catch (e) { next(e); }
});

r.post("/", roles("PLATFORM_ADMIN", "HOSPITAL_ADMIN"), async (req, res, next) => {
  try {
    const data = { ...req.body };
    if (req.user.role !== "PLATFORM_ADMIN") data.hospitalId = req.user.hospitalId;
    const resource = await KnowledgeResource.create(data);
    await audit({ hospitalId: resource.hospitalId, actorType: "USER", actorId: String(req.user._id), action: "KNOWLEDGE_RESOURCE_CREATED", entityType: "KnowledgeResource", entityId: String(resource._id) });
    res.status(201).json(resource);
  } catch (e) { next(e); }
});

r.patch("/:id", roles("PLATFORM_ADMIN", "HOSPITAL_ADMIN"), async (req, res, next) => {
  try {
    const resource = await KnowledgeResource.findOne({ _id: req.params.id, ...tenantScope(req) });
    if (!resource) return res.status(404).json({ message: "Knowledge resource not found" });
    for (const key of ["title", "type", "content", "sourceReference", "tags", "active"]) if (req.body[key] !== undefined) resource[key] = req.body[key];
    await resource.save();
    res.json(resource);
  } catch (e) { next(e); }
});

export default r;
