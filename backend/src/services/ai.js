import {
  GoogleGenAI,
  createPartFromUri,
} from "@google/genai";

import { env } from "../config/env.js";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

/* -------------------------------------------------------------------------- */
/*                              GEMINI CLIENT                                 */
/* -------------------------------------------------------------------------- */

const ai = env.geminiKey
  ? new GoogleGenAI({
      apiKey: env.geminiKey,
    })
  : null;

/* -------------------------------------------------------------------------- */
/*                              OUTPUT SCHEMA                                 */
/* -------------------------------------------------------------------------- */

const patientAssessmentSchema = {
  type: "object",

  properties: {
    detected_language: {
      type: "string",
    },

    responses: {
      type: "array",

      items: {
        type: "object",

        properties: {
          question_id: {
            type: "string",
          },

          transcript: {
            type: "string",
          },
        },

        required: [
          "question_id",
          "transcript",
        ],
      },
    },

    classification: {
      type: "string",

      enum: [
        "routine",
        "concerning",
        "urgent",
        "uncertain",
      ],
    },

    evidence: {
      type: "array",

      items: {
        type: "string",
      },
    },

    uncertainty: {
      type: "string",

      enum: [
        "low",
        "medium",
        "high",
      ],
    },

    requires_human_review: {
      type: "boolean",
    },
  },

  required: [
    "detected_language",
    "responses",
    "classification",
    "evidence",
    "uncertainty",
    "requires_human_review",
  ],
};

/* -------------------------------------------------------------------------- */
/*                          TEXT ASSESSMENT SCHEMA                            */
/* -------------------------------------------------------------------------- */

const assessmentSchema = {
  type: "object",

  properties: {
    detected_language: {
      type: "string",
    },

    classification: {
      type: "string",

      enum: [
        "routine",
        "concerning",
        "urgent",
        "uncertain",
      ],
    },

    evidence: {
      type: "array",

      items: {
        type: "string",
      },
    },

    uncertainty: {
      type: "string",

      enum: [
        "low",
        "medium",
        "high",
      ],
    },

    requires_human_review: {
      type: "boolean",
    },
  },

  required: [
    "detected_language",
    "classification",
    "evidence",
    "uncertainty",
    "requires_human_review",
  ],
};

/* -------------------------------------------------------------------------- */
/*                              SYSTEM PROMPT                                 */
/* -------------------------------------------------------------------------- */

const system = `
You are a safety-first post-discharge patient intake and triage assistant.

You are NOT a diagnosing clinician.
You are NOT a prescribing clinician.

Your task is to analyze ONLY information explicitly provided by the patient
and the supplied hospital protocol.

STRICT SAFETY RULES:

1. Never invent symptoms.
2. Never invent diagnoses.
3. Never invent medications.
4. Never invent vital signs.
5. Never invent medical history.
6. Never recommend medication changes.
7. Never prescribe medication.
8. Never override the hospital protocol.
9. Never downgrade a protocol safety trigger.
10. If information is incomplete, ambiguous, conflicting, or unclear,
    classify the case as "uncertain".
11. If uncertain, require human review.
12. Urgent cases always require human review.
13. Do not infer facts that the patient did not state.
14. Evidence must be directly supported by patient responses.
15. Output only the requested JSON.
`;

/* -------------------------------------------------------------------------- */
/*                                  HELPERS                                   */
/* -------------------------------------------------------------------------- */

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function getErrorStatus(error) {
  return Number(
    error?.status ||
      error?.code ||
      error?.response?.status ||
      0,
  );
}

function isRetryableError(error) {
  const status = getErrorStatus(error);

  return [
    429,
    500,
    502,
    503,
  ].includes(status);
}

/* -------------------------------------------------------------------------- */
/*                           FALLBACK RESULT                                  */
/* -------------------------------------------------------------------------- */

function fallback({
  transcripts = [],
  reason = "Gemini API was unavailable or not configured.",
} = {}) {
  return {
    detected_language: "unknown",

    responses: transcripts,

    classification: "uncertain",

    evidence: [
      `${reason} No automated clinical assessment was performed.`,
    ],

    uncertainty: "high",

    requires_human_review: true,

    ai_status: "PROVIDER_UNAVAILABLE",
  };
}

/* -------------------------------------------------------------------------- */
/*                       GEMINI GENERATION WITH RETRY                         */
/* -------------------------------------------------------------------------- */

async function generateWithRetry(
  contents,
  config,
  attempts = 5,
) {
  if (!ai) {
    return null;
  }

  let lastError;

  for (
    let attempt = 0;
    attempt < attempts;
    attempt++
  ) {
    try {
      console.log(
        `[Gemini] Generation attempt ${
          attempt + 1
        }/${attempts}`,
      );

      return await ai.models.generateContent({
        model: env.geminiModel,

        contents,

        config,
      });
    } catch (error) {
      lastError = error;

      const status = getErrorStatus(error);

      console.error(
        `[Gemini] Attempt ${
          attempt + 1
        }/${attempts} failed. Status: ${status}`,
      );

      console.error(
        `[Gemini] ${error?.message || error}`,
      );

      /*
       * Do not retry permanent errors such as:
       * 400, 401, 403, invalid model, malformed request, etc.
       */
      if (
        !isRetryableError(error) ||
        attempt === attempts - 1
      ) {
        throw error;
      }

      /*
       * Exponential backoff.
       *
       * 429:
       * 5s → 10s → 20s → 30s
       *
       * Other transient errors:
       * 2s → 4s → 6s → 8s
       */
      const delay =
        status === 429
          ? Math.min(
              5000 *
                Math.pow(
                  2,
                  attempt,
                ),
              30000,
            )
          : Math.min(
              2000 *
                (attempt + 1),
              10000,
            );

      console.log(
        `[Gemini] Waiting ${delay}ms before retry...`,
      );

      await sleep(delay);
    }
  }

  throw lastError;
}

/* -------------------------------------------------------------------------- */
/*                        CLOUDINARY URL VALIDATION                           */
/* -------------------------------------------------------------------------- */

function isAllowedCloudinaryUrl(
  value,
) {
  try {
    const url = new URL(value);

    return (
      url.protocol === "https:" &&
      (
        url.hostname ===
          "res.cloudinary.com" ||
        url.hostname.endsWith(
          ".cloudinary.com",
        )
      )
    );
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/*                    DOWNLOAD CLOUDINARY AUDIO                              */
/* -------------------------------------------------------------------------- */

async function downloadCloudinaryAudio(
  audioUrl,
  mimeType = "audio/webm",
) {
  if (!audioUrl) {
    throw new Error(
      "Audio URL is required",
    );
  }

  if (
    !isAllowedCloudinaryUrl(
      audioUrl,
    )
  ) {
    throw new Error(
      "Invalid or unsupported Cloudinary audio URL",
    );
  }

  const response = await fetch(
    audioUrl,
  );

  if (!response.ok) {
    throw new Error(
      `Cloudinary audio download failed: ${response.status} ${response.statusText}`,
    );
  }

  const contentType =
    response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.toLowerCase() ||
    mimeType;

  const isAudio =
    contentType.startsWith(
      "audio/",
    ) ||
    contentType ===
      "video/webm";

  if (!isAudio) {
    throw new Error(
      `Unsupported audio content type: ${contentType}`,
    );
  }

  const buffer = Buffer.from(
    await response.arrayBuffer(),
  );

  if (!buffer.length) {
    throw new Error(
      "Downloaded audio file is empty",
    );
  }

  let extension = ".webm";

  if (
    contentType ===
    "audio/mpeg"
  ) {
    extension = ".mp3";
  } else if (
    contentType === "audio/wav" ||
    contentType === "audio/x-wav"
  ) {
    extension = ".wav";
  } else if (
    contentType === "audio/ogg"
  ) {
    extension = ".ogg";
  } else if (
    contentType === "audio/mp4" ||
    contentType === "audio/m4a"
  ) {
    extension = ".m4a";
  }

  const filePath = path.join(
    os.tmpdir(),
    `careflow-${crypto.randomUUID()}${extension}`,
  );

  await fs.writeFile(
    filePath,
    buffer,
  );

  return {
    filePath,

    mimeType:
      contentType ===
      "video/webm"
        ? "audio/webm"
        : contentType,
  };
}

/* -------------------------------------------------------------------------- */
/*                      UPLOAD MULTIPLE AUDIO FILES                           */
/* -------------------------------------------------------------------------- */

/**
 * Downloads all Cloudinary recordings and uploads them to Gemini.
 *
 * IMPORTANT:
 * This creates file-upload requests, but only ONE generateContent()
 * request is made for Assessment #1.
 */
async function preparePatientAudio(
  responses,
) {
  const prepared = [];

  try {
    for (
      let i = 0;
      i < responses.length;
      i++
    ) {
      const response =
        responses[i];

      if (
        response.responseType !==
        "VOICE"
      ) {
        continue;
      }

      const audioUrl =
        response.audio?.secureUrl;

      if (!audioUrl) {
        throw new Error(
          `Missing Cloudinary audio URL for question ${response.questionId}`,
        );
      }

      console.log(
        `[Gemini] Downloading audio ${
          i + 1
        }/${responses.length}`,
      );

      const audio =
        await downloadCloudinaryAudio(
          audioUrl,
          response.audio
            ?.mimeType ||
            "audio/webm",
        );

      console.log(
        `[Gemini] Uploading audio for question ${response.questionId}`,
      );

      const uploadedFile =
        await ai.files.upload({
          file: audio.filePath,

          config: {
            mimeType:
              audio.mimeType,
          },
        });

      prepared.push({
        questionId:
          response.questionId,

        question:
          response.question ||
          response.questionId,

        uploadedFile,

        filePath:
          audio.filePath,
      });
    }

    return prepared;
  } catch (error) {
    /*
     * Clean up anything already prepared
     * if one of the later files fails.
     */
    await cleanupPatientAudio(
      prepared,
    );

    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/*                         CLEANUP AUDIO FILES                                */
/* -------------------------------------------------------------------------- */

async function cleanupPatientAudio(
  prepared = [],
) {
  for (const item of prepared) {
    if (
      item.uploadedFile?.name &&
      ai
    ) {
      try {
        await ai.files.delete({
          name:
            item.uploadedFile.name,
        });
      } catch (error) {
        console.warn(
          "[Gemini] Failed to delete uploaded file:",
          error?.message,
        );
      }
    }

    if (item.filePath) {
      try {
        await fs.unlink(
          item.filePath,
        );
      } catch {
        // Already deleted / unavailable.
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                ONE REQUEST: TRANSCRIBE + ASSESS ALL VOICE                 */
/* -------------------------------------------------------------------------- */

export async function assessPatientVoiceResponses({
  responses = [],
  protocolText = "",
}) {
  if (!ai) {
    return fallback();
  }

  let prepared = [];

  try {
    /*
     * Prepare all voice recordings.
     */
    prepared =
      await preparePatientAudio(
        responses,
      );

    /*
     * Build ONE Gemini request containing
     * all five audio recordings.
     */
    const contents = [];

    for (const item of prepared) {
      contents.push(
        `
QUESTION ID: ${item.questionId}

QUESTION:
${item.question}
`,
      );

      contents.push(
        createPartFromUri(
          item.uploadedFile.uri,
          item.uploadedFile.mimeType,
        ),
      );
    }

    /*
     * Add text responses as well.
     */
    const textResponses =
      responses
        .filter(
          (r) =>
            r.responseType !==
            "VOICE",
        )
        .map(
          (r) =>
            `
QUESTION ID: ${r.questionId}

QUESTION:
${r.question || r.questionId}

PATIENT TEXT ANSWER:
${r.text || ""}
`,
        )
        .join("\n");

    const prompt = `
${system}

HOSPITAL PROTOCOL:

${protocolText}

You are receiving the COMPLETE post-discharge questionnaire.

There may be multiple audio recordings.

For EVERY audio recording:

1. Identify it using QUESTION ID.
2. Transcribe exactly what the patient said.
3. Preserve the patient's meaning.
4. Do not translate the transcript unless necessary.
5. Do not invent missing words.

After transcribing ALL responses:

6. Assess the patient's COMPLETE case.
7. Use all responses together.
8. Apply the supplied hospital protocol.
9. Identify concrete evidence supporting the classification.
10. If information is incomplete, ambiguous, conflicting,
    or clinically unclear, classify as "uncertain".
11. Urgent findings require human review.

TEXT RESPONSES:

${textResponses}

Return ONLY JSON matching the supplied schema.
`;

    contents.push(prompt);

    console.log(
      "\n[Gemini] Sending ONE combined voice assessment request...",
    );

    const result =
      await generateWithRetry(
        contents,
        {
          systemInstruction:
            system,

          responseMimeType:
            "application/json",

          responseSchema:
            patientAssessmentSchema,

          temperature: 0,
        },
        5,
      );

    if (!result?.text) {
      return fallback();
    }

    let parsed;

    try {
      parsed = JSON.parse(
        result.text,
      );
    } catch (error) {
      console.error(
        "[Gemini] Invalid JSON:",
        error?.message,
      );

      return fallback();
    }

    return {
      ...parsed,
      ai_status: "COMPLETED",
      ai_meta: { model: env.geminiModel, provider: "Google Gemini", usageMetadata: result.usageMetadata || null },
    };
  } catch (error) {
    const status =
      getErrorStatus(error);

    console.error(
      "[Gemini] Combined voice assessment failed:",
      {
        status,
        message: error?.message,
      },
    );

    return fallback({
      reason:
        status === 429
          ? "Gemini API rate/quota limit was reached after retries."
          : "Gemini API failed while processing the patient voice responses.",
    });
  } finally {
    await cleanupPatientAudio(
      prepared,
    );
  }
}

/* -------------------------------------------------------------------------- */
/*                 SECOND REQUEST: INDEPENDENT ASSESSMENT                     */
/* -------------------------------------------------------------------------- */

/**
 * IMPORTANT:
 *
 * Assessment #2 does NOT upload audio again.
 *
 * It receives the transcripts produced by Assessment #1.
 *
 * Therefore:
 *
 * Assessment #1:
 *   audio → transcription + assessment
 *
 * Assessment #2:
 *   transcripts → independent assessment
 */
export async function assessPatientTranscripts({
  answers = [],
  protocolText = "",
}) {
  if (!ai) {
    return fallback();
  }

  const prompt = `
${system}

HOSPITAL PROTOCOL:

${protocolText}

You are performing an INDEPENDENT second assessment.

The patient has already answered the complete
post-discharge questionnaire.

Do NOT assume that another assessment is correct.

Review the complete patient information independently.

PATIENT RESPONSES:

${answers
  .map(
    (answer, index) => `
QUESTION ${index + 1}
QUESTION ID: ${
      answer.questionId ||
      answer.id ||
      `q${index + 1}`
    }

QUESTION:
${answer.question}

PATIENT RESPONSE:
${answer.answer}
`,
  )
  .join("\n")}

Determine:

1. routine
2. concerning
3. urgent
4. uncertain

Rules:

- Do not diagnose.
- Do not prescribe.
- Do not recommend medication changes.
- Do not invent information.
- Follow the hospital protocol.
- Incomplete information → uncertain.
- Ambiguous information → uncertain.
- Conflicting information → uncertain.
- Urgent findings → human review.

Return ONLY JSON.
`;

  try {
    console.log(
      "\n[Gemini] Sending independent Assessment #2...",
    );

    const result =
      await generateWithRetry(
        [prompt],
        {
          systemInstruction:
            system,

          responseMimeType:
            "application/json",

          responseSchema:
            assessmentSchema,

          temperature: 0,
        },
        5,
      );

    if (!result?.text) {
      return fallback();
    }

    try {
      const parsed =
        JSON.parse(
          result.text,
        );

      return {
        ...parsed,
        ai_status: "COMPLETED",
        ai_meta: { model: env.geminiModel, provider: "Google Gemini", usageMetadata: result.usageMetadata || null },
      };
    } catch (error) {
      console.error(
        "[Gemini] Assessment #2 JSON parsing failed:",
        error?.message,
      );

      return fallback();
    }
  } catch (error) {
    const status =
      getErrorStatus(error);

    console.error(
      "[Gemini] Assessment #2 failed:",
      {
        status,
        message: error?.message,
      },
    );

    return fallback({
      reason:
        status === 429
          ? "Gemini API rate/quota limit was reached during the second assessment."
          : "Gemini API failed during the second independent assessment.",
    });
  }
}

/* -------------------------------------------------------------------------- */
/*                     LEGACY SINGLE TEXT ASSESSMENT                          */
/* -------------------------------------------------------------------------- */

/**
 * Kept for compatibility with any existing code that still imports assess().
 *
 * New patient voice flow should use:
 *
 * assessPatientVoiceResponses()
 * assessPatientTranscripts()
 */
export async function assess({
  answerText = "",
  protocolText = "",
}) {
  if (!ai) {
    return fallback({
      reason:
        "Gemini API was unavailable or not configured.",
    });
  }

  const prompt = `
${system}

HOSPITAL PROTOCOL:

${protocolText}

PATIENT ANSWER:

${answerText}

Assess this answer conservatively.

Return JSON only.
`;

  try {
    const result =
      await generateWithRetry(
        [prompt],
        {
          systemInstruction:
            system,

          responseMimeType:
            "application/json",

          responseSchema:
            assessmentSchema,

          temperature: 0,
        },
        5,
      );

    if (!result?.text) {
      return fallback();
    }

    const parsed =
      JSON.parse(
        result.text,
      );

    return {
      ...parsed,

      transcript:
        answerText,

      ai_status:
        "COMPLETED",
    };
  } catch (error) {
    console.error(
      "[Gemini] Single assessment failed:",
      error?.message,
    );

    return fallback({
      reason:
        "Gemini API failed during assessment.",
    });
  }
}

/* -------------------------------------------------------------------------- */
/*                     LEGACY HOLISTIC ASSESSMENT                             */
/* -------------------------------------------------------------------------- */

/**
 * Kept for test scripts / backwards compatibility.
 *
 * For the REAL patient flow, use:
 *
 * 1. assessPatientVoiceResponses()
 * 2. assessPatientTranscripts()
 */
export async function assessHolistic({
  answers = [],
  protocolText = "",
}) {
  if (!ai) {
    return fallback({
      reason:
        "Gemini API was unavailable or not configured.",
    });
  }

  const prompt = `
${system}

HOSPITAL PROTOCOL:

${protocolText}

Assess the complete patient questionnaire.

PATIENT ANSWERS:

${answers
  .map(
    (answer, index) => `
${index + 1}. ${answer.question}

PATIENT ANSWER:
${answer.answer}
`,
  )
  .join("\n")}

Return JSON only.
`;

  try {
    const result =
      await generateWithRetry(
        [prompt],
        {
          systemInstruction:
            system,

          responseMimeType:
            "application/json",

          responseSchema:
            assessmentSchema,

          temperature: 0,
        },
        5,
      );

    if (!result?.text) {
      return fallback();
    }

    const parsed =
      JSON.parse(
        result.text,
      );

    return {
      ...parsed,

      ai_status:
        "COMPLETED",
    };
  } catch (error) {
    const status =
      getErrorStatus(error);

    console.error(
      "[Gemini] Holistic assessment failed:",
      {
        status,
        message: error?.message,
      },
    );

    return fallback({
      reason:
        status === 429
          ? "Gemini API rate/quota limit was reached after retries."
          : "Gemini API failed during holistic assessment.",
    });
  }
}