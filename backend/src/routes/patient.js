import { Router } from "express";
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
import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";

import {
  assessPatientVoiceResponses,
  assessPatientTranscripts,
} from "../services/ai.js";

import {
  consensus,
  protocolCheck,
  validateAIOutput,
} from "../services/validation.js";

import { safeRoutineEHRUpdate } from "../services/ehr.js";
import { audit } from "../services/audit.js";

const r = Router();

/* =========================================================
   SESSION
========================================================= */

async function getSession(token) {
  return OutreachSession.findOne({
    tokenHash: hashToken(token),
    expiresAt: { $gt: new Date() },
    used: false,
  });
}

/* =========================================================
   GET PATIENT OUTREACH
========================================================= */

r.get("/outreach/:token", async (req, res, next) => {
  try {
    const s = await getSession(req.params.token);

    if (!s) {
      return res
        .status(404)
        .json({ message: "Link is invalid, expired, or already submitted" });
    }

    const [p, c] = await Promise.all([
      Patient.findById(s.patientId).lean(),
      Campaign.findById(s.campaignId).lean(),
    ]);

    if (!p || !c) {
      return res.status(404).json({
        message: "Follow-up is unavailable",
      });
    }

    const saved = await PatientResponse.find({
      outreachTaskId: s.outreachTaskId,
    })
      .select("questionId text audio transcript responseType")
      .lean();

    res.json({
      patient: {
        name: p.name,
      },

      campaign: {
        name: c.name,
        questions: c.questions,
      },

      answeredQuestionIds: saved
        .filter((x) => x.text?.trim() || x.audio?.assetId)
        .map((x) => x.questionId),

      savedResponses: saved,

      expiresAt: s.expiresAt,
    });
  } catch (e) {
    next(e);
  }
});

/* =========================================================
   STREAM SAVED AUDIO FOR PATIENT PLAYBACK

   The patient UI uses this token-protected endpoint instead of
   exposing Cloudinary authenticated assets directly.
========================================================= */

r.get("/outreach/:token/response/:questionId/audio", async (req, res, next) => {
  try {
    const s = await getSession(req.params.token);
    if (!s) return res.status(404).json({ message: "Invalid or expired link" });

    const response = await PatientResponse.findOne({
      outreachTaskId: s.outreachTaskId,
      questionId: req.params.questionId,
    }).lean();

    if (!response?.audio?.assetId) {
      return res.status(404).json({ message: "Audio response not found" });
    }

    if (response.audio.provider === "local") {
      return res.sendFile(response.audio.assetId);
    }

    const configured =
      env.cloudinary.cloudName &&
      env.cloudinary.apiKey &&
      env.cloudinary.apiSecret;

    if (!configured) {
      return res.status(404).json({ message: "Audio storage is unavailable" });
    }

    cloudinary.config({
      cloud_name: env.cloudinary.cloudName,
      api_key: env.cloudinary.apiKey,
      api_secret: env.cloudinary.apiSecret,
      secure: true,
    });

    const mime = response.audio.mimeType || "audio/webm";
    const format = mime.includes("mp4") || mime.includes("m4a") ? "m4a" : "webm";
    const signedUrl = cloudinary.utils.private_download_url(
      response.audio.assetId,
      format,
      {
        resource_type: "video",
        type: "authenticated",
        attachment: false,
      },
    );

    return res.redirect(signedUrl);
  } catch (e) {
    next(e);
  }
});

/* =========================================================
   SAVE INDIVIDUAL PATIENT RESPONSE
========================================================= */

r.post(
  "/outreach/:token/response",
  audioUpload.single("audio"),

  async (req, res, next) => {
    try {
      const s = await getSession(req.params.token);

      if (!s) {
        return res.status(404).json({
          message: "Invalid or expired link",
        });
      }

      const qid = req.body.questionId;

      const c = await Campaign.findById(s.campaignId);

      const q = c?.questions.find((x) => x.id === qid);

      if (!q) {
        return res.status(400).json({
          message: "Invalid question",
        });
      }

      /* ---------------------------------------------------
         Avoid duplicate response for same question
      --------------------------------------------------- */

      const existing = await PatientResponse.findOne({
        outreachTaskId: s.outreachTaskId,
        questionId: qid,
      });

      let audio = null;
      let text = req.body.text || "";

      /* ---------------------------------------------------
         Store audio
      --------------------------------------------------- */

      if (req.file) {
        audio = await storeAudio(req.file, {
          hospitalId: s.hospitalId,
          patientId: s.patientId,
          outreachTaskId: s.outreachTaskId,
          questionId: qid,
        });
      }

      if (!text && !audio) {
        return res.status(400).json({
          message: "Provide text or voice answer",
        });
      }

      /* ---------------------------------------------------
         Save response
      --------------------------------------------------- */

      let response;

      if (existing) {
        existing.responseType = audio ? "VOICE" : "TEXT";
        existing.text = text || undefined;
        if (audio) existing.audio = audio;
        existing.transcript = undefined;
        response = await existing.save();
      } else {
        response = await PatientResponse.create({
          hospitalId: s.hospitalId,
          patientId: s.patientId,
          campaignId: s.campaignId,
          outreachTaskId: s.outreachTaskId,
          questionId: qid,
          responseType: audio ? "VOICE" : "TEXT",
          text: text || undefined,
          audio,
        });
      }

      res.json(response);
    } catch (e) {
      next(e);
    }
  }
);

/* =========================================================
   SUBMIT COMPLETE FOLLOW-UP
========================================================= */

r.post("/outreach/:token/submit", async (req, res, next) => {
  try {
    const s = await getSession(req.params.token);

    if (!s) {
      return res.status(404).json({
        message: "Invalid, expired, or already submitted link",
      });
    }

    const c = await Campaign.findById(s.campaignId).lean();

    if (!c) {
      return res.status(404).json({
        message: "Campaign not found",
      });
    }

    /* ---------------------------------------------------
       Get all saved responses
    --------------------------------------------------- */

    const responses = await PatientResponse.find({
      outreachTaskId: s.outreachTaskId,
    }).lean();

    /* ---------------------------------------------------
       Validate required questions
    --------------------------------------------------- */

    const missing = c.questions.filter(
      (q) =>
        q.required &&
        !responses.some(
          (a) =>
            a.questionId === q.id &&
            (a.text?.trim() || a.audio?.assetId)
        )
    );

    if (missing.length) {
      return res.status(400).json({
        message: "All required questions must be answered",
        missing: missing.map((x) => x.id),
      });
    }

    /* ---------------------------------------------------
       Mark AI processing as started
       
       IMPORTANT:
       Patient does NOT wait for Gemini.
    --------------------------------------------------- */

    await OutreachTask.findByIdAndUpdate(
      s.outreachTaskId,
      {
        aiProcessingStatus: "PROCESSING",
        aiProcessingError: undefined,
      },
      {
        new: true,
      }
    );

    /* ---------------------------------------------------
       Mark session as used
    --------------------------------------------------- */

    s.used = true;
    s.submittedAt = new Date();

    await s.save();

    /* ---------------------------------------------------
       Audit patient submission
    --------------------------------------------------- */

    await audit({
      hospitalId: s.hospitalId,
      action: "FOLLOWUP_SUBMITTED",
      entityType: "OutreachTask",
      entityId: String(s.outreachTaskId),

      details: {
        responseCount: responses.length,
      },
    });

    /* ---------------------------------------------------
       BACKGROUND AI PROCESSING

       Patient already received HTTP 202.
    --------------------------------------------------- */

    processSubmittedFollowup({
      session: s,
      campaign: c,
      responses,
      taskId: s.outreachTaskId,
    }).catch(async (e) => {
      console.error(
        "Background follow-up processing failed:",
        e
      );

      await OutreachTask.findByIdAndUpdate(s.outreachTaskId, {
        aiProcessingStatus: "FAILED",
        aiProcessingError: e.message,
      });

      await audit({
        hospitalId: s.hospitalId,
        action: "AI_PROCESSING_FAILED",
        entityType: "OutreachTask",
        entityId: String(s.outreachTaskId),

        details: {
          error: e.message,
        },
      }).catch(() => {});
    });

    /* ---------------------------------------------------
       Immediately return to patient
    --------------------------------------------------- */

    return res.status(202).json({
      status: "SUBMITTED",

      message:
        "Follow-up submitted successfully. Your responses have been received.",
    });
  } catch (e) {
    next(e);
  }
});

/* =========================================================
   BACKGROUND FOLLOW-UP PROCESSING
========================================================= */

async function processSubmittedFollowup({
  session,
  campaign,
  responses,
  taskId,
}) {
  /* -------------------------------------------------------
     1. GET CLINICAL PROTOCOL
  ------------------------------------------------------- */

  const protocol = await Protocol.findById(
    campaign.protocolId
  ).lean();

  const protocolText = protocol?.sourceText || "";

  /* -------------------------------------------------------
     2. PREPARE ALL RESPONSES
     
     We do NOT transcribe each voice answer separately.
     
     Everything is sent to Gemini together.
  ------------------------------------------------------- */

  console.log(
    `Starting combined AI processing for task ${taskId}`
  );

  console.log(
    `Total patient responses: ${responses.length}`
  );

  /* -------------------------------------------------------
     3. GEMINI CALL #1

     One request containing:
       - all voice files
       - all text responses
       - protocol

     Gemini returns:
       - detected language
       - transcript for every response
       - overall clinical classification
       - evidence
       - uncertainty
       - human review requirement
  ------------------------------------------------------- */

  const aiResult1 = await assessPatientVoiceResponses({
    responses,
    protocolText,
  });

  console.log(
    "AI Assessment #1 status:",
    aiResult1.ai_status
  );

  console.log(
    "AI Assessment #1 classification:",
    aiResult1.classification
  );

  /* -------------------------------------------------------
     4. BUILD TRANSCRIPT ANSWERS

     Gemini #1 gives:

     responses: [
       {
         question_id: "...",
         transcript: "..."
       }
     ]

     Convert that into the structure required
     by Gemini #2.
  ------------------------------------------------------- */

  const answers = [];

  for (const item of aiResult1.responses || []) {
    const original = responses.find(
      (r) => r.questionId === item.question_id
    );

    const question =
      campaign.questions.find(
        (q) => q.id === item.question_id
      )?.text ||
      original?.question ||
      item.question_id;

    const transcript = item.transcript || "";

    answers.push({
      questionId: item.question_id,

      question,

      answer: transcript,
    });

    /* -----------------------------------------------------
       Save transcript back to PatientResponse
    ----------------------------------------------------- */

    if (original?._id && transcript) {
      await PatientResponse.findByIdAndUpdate(
        original._id,
        {
          transcript,
        }
      );
    }
  }

  /* -------------------------------------------------------
     5. HANDLE RESPONSES THAT WERE NOT RETURNED BY GEMINI

     This is mainly useful for text answers or unexpected
     missing transcript entries.
  ------------------------------------------------------- */

  for (const response of responses) {
    const alreadyAdded = answers.some(
      (x) => x.questionId === response.questionId
    );

    if (alreadyAdded) {
      continue;
    }

    const question =
      campaign.questions.find(
        (q) => q.id === response.questionId
      )?.text || response.questionId;

    answers.push({
      questionId: response.questionId,

      question,

      answer: response.text || "",
    });
  }

  /* -------------------------------------------------------
     6. GEMINI CALL #2

     IMPORTANT:
     DO NOT upload audio again.

     Gemini #2 receives only the transcripts/text.

     This gives us an independent assessment.
  ------------------------------------------------------- */

  const aiResult2 = await assessPatientTranscripts({
    answers,
    protocolText,
  });

  console.log(
    "AI Assessment #2 status:",
    aiResult2.ai_status
  );

  console.log(
    "AI Assessment #2 classification:",
    aiResult2.classification
  );

  /* -------------------------------------------------------
     7. BUILD PROTOCOL ANSWERS

     Used by deterministic protocolCheck().
     
     No Gemini call here.
  ------------------------------------------------------- */

  const protocolAnswers = answers.map((x) => ({
    questionId: x.questionId,
    text: x.answer,
  }));

  /* -------------------------------------------------------
     8. STORE BOTH AI ASSESSMENTS

     We first validate and protocol-check each result.
  ------------------------------------------------------- */

  const assessments = [
    aiResult1,
    aiResult2,
  ];

  for (let i = 0; i < assessments.length; i++) {
    const result = assessments[i];

    /* -----------------------------------------------------
       Validate AI JSON
    ----------------------------------------------------- */

    const valid = validateAIOutput(result);

    if (!valid.ok) {
      return escalate(
        session,
        taskId,
        `AI output validation failed for assessment ${
          i + 1
        }: ${valid.reason}`
      );
    }

    /* -----------------------------------------------------
       Deterministic protocol check
    ----------------------------------------------------- */

    const check = protocolCheck({
      answers: protocolAnswers,

      protocol,

      ai: result,
    });

    /* -----------------------------------------------------
       Protocol can force human review/classification
    ----------------------------------------------------- */

    if (check.forcedClassification) {
      result.classification =
        check.forcedClassification;
    }

    if (check.requiresHumanReview) {
      result.requires_human_review = true;
    }

    /* -----------------------------------------------------
       IMPORTANT:
       Provider failure is NOT treated as a normal
       clinical classification.

       It always requires human review.
    ----------------------------------------------------- */

    if (
      result.ai_status ===
      "PROVIDER_UNAVAILABLE"
    ) {
      result.classification = "uncertain";

      result.requires_human_review = true;
    }

    /* -----------------------------------------------------
       Save AI assessment
    ----------------------------------------------------- */

    await AIAssessment.create({
      hospitalId: session.hospitalId,

      patientId: session.patientId,

      outreachTaskId: taskId,

      assessmentNo: i + 1,

      classification:
        result.classification,

      evidence:
        result.evidence || [],

      uncertainty:
        result.uncertainty || "high",

      requiresHumanReview:
        result.requires_human_review === true,

      protocolMatches:
        check.matches || [],

      safetyFlags:
        (check.hits || []).map(
          (x) => x.trigger
        ),

      rawJson: result,
    });
  }

  /* -------------------------------------------------------
     9. CONSENSUS

     IMPORTANT:
     This is deterministic code.

     We DO NOT make another Gemini call here.

     Gemini calls = exactly 2.
  ------------------------------------------------------- */

  const cns = consensus(assessments);

  /* -------------------------------------------------------
     10. PROVIDER FAILURE OVERRIDE

     If Gemini was unavailable in either assessment,
     manual review is mandatory.
  ------------------------------------------------------- */

  const providerUnavailable =
    assessments.some(
      (a) =>
        a.ai_status ===
        "PROVIDER_UNAVAILABLE"
    );

  if (providerUnavailable) {
    cns.classification = "uncertain";

    cns.requiresHumanReview = true;

    cns.reason =
      "AI provider unavailable; manual clinical review required.";

    cns.providerUnavailable = true;
  }

  /* -------------------------------------------------------
     11. GET TASK
  ------------------------------------------------------- */

  const task =
    await OutreachTask.findById(taskId);

  if (!task) {
    throw new Error(
      "Outreach task not found"
    );
  }

  /* -------------------------------------------------------
     12. HUMAN REVIEW / ESCALATION
  ------------------------------------------------------- */

  if (cns.requiresHumanReview) {
    const existingEscalation =
      await Escalation.findOne({
        outreachTaskId: taskId,

        status: "OPEN",
      });

    /* -----------------------------------------------------
       Avoid duplicate escalation
    ----------------------------------------------------- */

    if (!existingEscalation) {
      await Escalation.create({
        hospitalId: session.hospitalId,

        patientId: session.patientId,

        outreachTaskId: taskId,

        status: "OPEN",

        reason:
          cns.reason ||
          "Clinical review required.",

        priority:
          cns.classification ||
          "uncertain",
      });
    }

    /* -----------------------------------------------------
       Mark task for human review
    ----------------------------------------------------- */

    task.status = "ESCALATED";

    task.aiProcessingStatus =
      "HUMAN_REVIEW";

    task.aiProcessedAt = new Date();

    await task.save();

    /* -----------------------------------------------------
       Audit escalation
    ----------------------------------------------------- */

    await audit({
      hospitalId: session.hospitalId,

      action: "ESCALATION_CREATED",

      entityType: "OutreachTask",

      entityId: String(task._id),

      details: {
        classification:
          cns.classification,

        reason: cns.reason,

        providerUnavailable:
          Boolean(
            cns.providerUnavailable
          ),
      },
    });

    return;
  }

  /* -------------------------------------------------------
     13. ROUTINE CASE

     Only routine cases reach here.

     The EHR update is still protected by
     safeRoutineEHRUpdate().
  ------------------------------------------------------- */

  const summary = answers
    .map(
      (x) =>
        `${x.question}: ${x.answer}`
    )
    .join(" | ");

  await safeRoutineEHRUpdate({
    hospitalId: session.hospitalId,

    patientId: session.patientId,

    outreachTaskId: taskId,

    summary,
  });

  /* -------------------------------------------------------
     14. COMPLETE TASK
  ------------------------------------------------------- */

  task.status = "COMPLETED";

  task.completedAt = new Date();

  task.aiProcessingStatus =
    "COMPLETED";

  task.aiProcessedAt = new Date();

  await task.save();

  /* -------------------------------------------------------
     15. AUDIT COMPLETION
  ------------------------------------------------------- */

  await audit({
    hospitalId: session.hospitalId,

    action: "OUTREACH_COMPLETED",

    entityType: "OutreachTask",

    entityId: String(task._id),

    details: {
      classification:
        cns.classification,
    },
  });
}

/* =========================================================
   ESCALATION HELPER
========================================================= */

async function escalate(
  session,
  taskId,
  reason
) {
  const task =
    await OutreachTask.findById(taskId);

  if (!task) {
    throw new Error(
      "Outreach task not found"
    );
  }

  /* -------------------------------------------------------
     Avoid duplicate OPEN escalation
  ------------------------------------------------------- */

  const existingEscalation =
    await Escalation.findOne({
      outreachTaskId: taskId,

      status: "OPEN",
    });

  if (!existingEscalation) {
    await Escalation.create({
      hospitalId: session.hospitalId,

      patientId: session.patientId,

      outreachTaskId: taskId,

      status: "OPEN",

      reason,

      priority: "uncertain",
    });
  }

  /* -------------------------------------------------------
     Mark task for human review
  ------------------------------------------------------- */

  task.status = "ESCALATED";

  task.aiProcessingStatus =
    "HUMAN_REVIEW";

  task.aiProcessedAt = new Date();

  await task.save();

  /* -------------------------------------------------------
     Audit
  ------------------------------------------------------- */

  await audit({
    hospitalId: session.hospitalId,

    action: "ESCALATION_CREATED",

    entityType: "OutreachTask",

    entityId: String(task._id),

    details: {
      classification: "uncertain",

      reason,
    },
  });
}

/* =========================================================
   EXPORT ROUTER
========================================================= */

export default r;