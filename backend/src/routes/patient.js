import { Router } from "express";
import fs from "node:fs";
import {
  OutreachSession,
  Patient,
  Campaign,
  OutreachTask,
  PatientResponse,
  Protocol,
  AIAssessment,
  Escalation,
} from "../models/index.js";
import { hashToken } from "../utils/security.js";
import { audioUpload } from "../middleware/upload.js";
import { storeAudio } from "../services/storage.js";
import { assessHolistic, transcribeAudio } from "../services/ai.js";
import {
  consensus,
  protocolCheck,
  validateAIOutput,
} from "../services/validation.js";
import { safeRoutineEHRUpdate } from "../services/ehr.js";
import { audit } from "../services/audit.js";
const r = Router();

async function getSession(token) {
  return OutreachSession.findOne({
    tokenHash: hashToken(token),
    expiresAt: { $gt: new Date() },
    used: false,
  });
}

r.get("/outreach/:token", async (req, res, next) => {
  try {
    const s = await getSession(req.params.token);
    if (!s)
      return res
        .status(404)
        .json({ message: "Link is invalid, expired, or already submitted" });
    const [p, c] = await Promise.all([
      Patient.findById(s.patientId).lean(),
      Campaign.findById(s.campaignId).lean(),
    ]);
    if (!p || !c)
      return res.status(404).json({ message: "Follow-up is unavailable" });
    const saved = await PatientResponse.find({
      outreachTaskId: s.outreachTaskId,
    })
      .select("questionId text audio")
      .lean();
    res.json({
      patient: { name: p.name },
      campaign: { name: c.name, questions: c.questions },
      answeredQuestionIds: saved
        .filter((x) => x.text?.trim() || x.audio?.assetId)
        .map((x) => x.questionId),
      expiresAt: s.expiresAt,
    });
  } catch (e) {
    next(e);
  }
});

r.post(
  "/outreach/:token/response",
  audioUpload.single("audio"),
  async (req, res, next) => {
    try {
      const s = await getSession(req.params.token);
      if (!s)
        return res.status(404).json({ message: "Invalid or expired link" });
      const qid = req.body.questionId;
      const c = await Campaign.findById(s.campaignId);
      const q = c?.questions.find((x) => x.id === qid);
      if (!q) return res.status(400).json({ message: "Invalid question" });
      const existing = await PatientResponse.findOne({
        outreachTaskId: s.outreachTaskId,
        questionId: qid,
      });
      if (existing) return res.json(existing);
      let audio = null,
        text = req.body.text || "";
      if (req.file)
        audio = await storeAudio(req.file, {
          hospitalId: s.hospitalId,
          patientId: s.patientId,
          outreachTaskId: s.outreachTaskId,
          questionId: qid,
        });
      if (!text && !audio)
        return res
          .status(400)
          .json({ message: "Provide text or voice answer" });
      const response = await PatientResponse.create({
        hospitalId: s.hospitalId,
        patientId: s.patientId,
        campaignId: s.campaignId,
        outreachTaskId: s.outreachTaskId,
        questionId: qid,
        responseType: audio ? "VOICE" : "TEXT",
        text: text || undefined,
        audio,
      });
      res.json(response);
    } catch (e) {
      next(e);
    }
  },
);

r.post("/outreach/:token/submit", async (req, res, next) => {
  try {
    const s = await getSession(req.params.token);
    if (!s)
      return res
        .status(404)
        .json({ message: "Invalid, expired, or already submitted link" });
    const c = await Campaign.findById(s.campaignId).lean();
    const responses = await PatientResponse.find({
      outreachTaskId: s.outreachTaskId,
    }).lean();
    const missing = c.questions.filter(
      (q) =>
        q.required &&
        !responses.some(
          (a) => a.questionId === q.id && (a.text?.trim() || a.audio?.assetId),
        ),
    );
    if (missing.length)
      return res
        .status(400)
        .json({
          message: "All required questions must be answered",
          missing: missing.map((x) => x.id),
        });

    // Mark the patient submission complete BEFORE any Gemini call. The patient should never wait for AI availability.
    const task = await OutreachTask.findByIdAndUpdate(
      s.outreachTaskId,
      { aiProcessingStatus: "PROCESSING" },
      { new: true },
    );
    s.used = true;
    s.submittedAt = new Date();
    await s.save();
    await audit({
      hospitalId: s.hospitalId,
      action: "FOLLOWUP_SUBMITTED",
      entityType: "OutreachTask",
      entityId: String(s.outreachTaskId),
      details: { responseCount: responses.length },
    });

    // Fire-and-forget background processing. The answers are already persisted above.
    processSubmittedFollowup({
      session: s,
      campaign: c,
      responses,
      taskId: s.outreachTaskId,
    }).catch(async (e) => {
      await OutreachTask.findByIdAndUpdate(s.outreachTaskId, {
        aiProcessingStatus: "FAILED",
        aiProcessingError: e.message,
      });
      await audit({
        hospitalId: s.hospitalId,
        action: "AI_PROCESSING_FAILED",
        entityType: "OutreachTask",
        entityId: String(s.outreachTaskId),
        details: { error: e.message },
      }).catch(() => {});
    });

    return res
      .status(202)
      .json({
        status: "SUBMITTED",
        message:
          "Follow-up submitted successfully. Your responses have been received.",
      });
  } catch (e) {
    next(e);
  }
});

async function processSubmittedFollowup({
  session,
  campaign,
  responses,
  taskId,
}) {
  const protocol = await Protocol.findById(campaign.protocolId).lean();
  const byQuestion = new Map(campaign.questions.map((q) => [q.id, q.text]));
  const answers = [];
  for (const response of responses) {
    let transcript = response.text || "";
    let detectedLanguage = "en";
    if (response.responseType === "VOICE") {
      const audioPath =
        response.audio?.provider === "local" ? response.audio.assetId : null;
      const audioUrl = response.audio?.secureUrl || null;
      if (!audioPath && !audioUrl)
        throw new Error(
          "Voice response is not locally available for AI processing",
        );
      const tr = await transcribeAudio({
        audioPath,
        audioUrl,
        audioMimeType: response.audio?.mimeType || "audio/webm",
      });
      transcript = tr.transcript;
      detectedLanguage = tr.detected_language || "en";
      if (audioPath) {
        try {
          fs.unlinkSync(audioPath);
        } catch {}
      }
      await PatientResponse.findByIdAndUpdate(response._id, { transcript });
    }
    answers.push({
      question: byQuestion.get(response.questionId) || response.questionId,
      answer: transcript,
      detectedLanguage,
    });
  }

  const protocolAnswers = answers.map((x) => ({
    questionId:
      campaign.questions.find((q) => q.text === x.question)?.id || x.question,
    text: x.answer,
  }));
  const assessments = [
    await assessHolistic({ answers, protocolText: protocol?.sourceText || "" }),
    await assessHolistic({ answers, protocolText: protocol?.sourceText || "" }),
  ];
  for (let i = 0; i < assessments.length; i++) {
    const result = assessments[i];
    const valid = validateAIOutput(result);
    if (!valid.ok)
      return escalate(
        session,
        taskId,
        `AI output validation failed: ${valid.reason}`,
      );
    const check = protocolCheck({
      answers: protocolAnswers,
      protocol,
      ai: result,
    });
    if (check.forcedClassification)
      result.classification = check.forcedClassification;
    if (check.requiresHumanReview) result.requires_human_review = true;
    await AIAssessment.create({
      hospitalId: session.hospitalId,
      patientId: session.patientId,
      outreachTaskId: taskId,
      assessmentNo: i + 1,
      classification: result.classification,
      evidence: result.evidence,
      uncertainty: result.uncertainty,
      requiresHumanReview: result.requires_human_review,
      protocolMatches: check.matches,
      safetyFlags: check.hits.map((x) => x.trigger),
      rawJson: result,
    });
  }

  const cns = consensus(assessments);
  const task = await OutreachTask.findById(taskId);
  if (!task) throw new Error("Outreach task not found");
  if (cns.requiresHumanReview) {
    await Escalation.create({
      hospitalId: session.hospitalId,
      patientId: session.patientId,
      outreachTaskId: taskId,
      status: "OPEN",
      reason: cns.reason,
      priority: cns.classification,
    });
    task.status = "ESCALATED";
    task.aiProcessingStatus = "HUMAN_REVIEW";
    task.aiProcessedAt = new Date();
    await task.save();
    await audit({
      hospitalId: session.hospitalId,
      action: "ESCALATION_CREATED",
      entityType: "OutreachTask",
      entityId: String(task._id),
      details: { classification: cns.classification, reason: cns.reason },
    });
    return;
  }
  const summary = answers.map((x) => `${x.question}: ${x.answer}`).join(" | ");
  await safeRoutineEHRUpdate({
    hospitalId: session.hospitalId,
    patientId: session.patientId,
    outreachTaskId: taskId,
    summary,
  });
  task.status = "COMPLETED";
  task.completedAt = new Date();
  task.aiProcessingStatus = "COMPLETED";
  task.aiProcessedAt = new Date();
  await task.save();
  await audit({
    hospitalId: session.hospitalId,
    action: "OUTREACH_COMPLETED",
    entityType: "OutreachTask",
    entityId: String(task._id),
    details: { classification: cns.classification },
  });
}

async function escalate(session, taskId, reason) {
  const task = await OutreachTask.findById(taskId);
  if (!task) throw new Error("Outreach task not found");
  await Escalation.create({
    hospitalId: session.hospitalId,
    patientId: session.patientId,
    outreachTaskId: taskId,
    status: "OPEN",
    reason,
    priority: "uncertain",
  });
  task.status = "ESCALATED";
  task.aiProcessingStatus = "HUMAN_REVIEW";
  task.aiProcessedAt = new Date();
  await task.save();
}

export default r;
