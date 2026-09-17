import {
  GoogleGenAI,
  createPartFromUri,
} from "@google/genai";

import { env } from "../config/env.js";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const ai = env.geminiKey
  ? new GoogleGenAI({ apiKey: env.geminiKey })
  : null;

const schema = {
  type: "object",

  properties: {
    detected_language: {
      type: "string",
    },

    transcript: {
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
    "transcript",
    "classification",
    "evidence",
    "uncertainty",
    "requires_human_review",
  ],
};

const transcriptSchema = {
  type: "object",

  properties: {
    detected_language: {
      type: "string",
    },

    transcript: {
      type: "string",
    },
  },

  required: [
    "detected_language",
    "transcript",
  ],
};


const system = `
You are a safety-first post-discharge intake and triage assistant.

You are NOT a diagnosing clinician.
You are NOT a prescribing clinician.

Your job is only to analyze the information explicitly provided by the patient
and the supplied hospital protocol.

STRICT RULES:

1. Never invent symptoms.
2. Never invent diagnoses.
3. Never invent medications.
4. Never invent vitals.
5. Never invent tests or medical history.
6. Never recommend medication changes.
7. Never prescribe medication.
8. Never override hospital protocol.
9. Never downgrade a protocol safety trigger.
10. If information is incomplete, ambiguous, conflicting, or unsupported,
    classify as "uncertain".
11. If uncertain, require human review.
12. Urgent cases must require human review.
13. Use only the patient-provided information and supplied protocol.
14. Evidence must be based on information actually present in the input.
15. Output only the requested JSON structure.
`;

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Safe fallback when Gemini is unavailable.
 *
 * We deliberately classify as uncertain instead of trying
 * to make a clinical decision without AI/protocol processing.
 */
function fallback(text = "") {
  return {
    detected_language: "en",

    transcript: text,

    classification: "uncertain",

    evidence: [
      "Gemini API was unavailable or not configured; no clinical automation was performed.",
    ],

    uncertainty: "high",

    requires_human_review: true,
  };
}

/**
 * Extract HTTP/provider status code from Gemini errors.
 */
function getErrorStatus(error) {
  return Number(
    error?.status ||
      error?.code ||
      error?.response?.status ||
      0,
  );
}

/**
 * Determines whether an error is transient and worth retrying.
 */
function isRetryableError(error) {
  const status = getErrorStatus(error);

  return [
    429, // Too many requests
    500, // Internal server error
    502, // Bad gateway
    503, // Service unavailable
  ].includes(status);
}

/* -------------------------------------------------------------------------- */
/*                          GEMINI GENERATION RETRY                           */
/* -------------------------------------------------------------------------- */

/**
 * Generate Gemini content with retry/backoff.
 *
 * Retryable:
 * - 429
 * - 500
 * - 502
 * - 503
 *
 * Non-retryable errors are immediately thrown.
 */
async function generateWithRetry(
  contents,
  config,
  attempts = 3,
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
      return await ai.models.generateContent({
        model: env.geminiModel,
        contents,
        config,
      });
    } catch (error) {
      lastError = error;

      const status = getErrorStatus(error);

      console.warn(
        `[Gemini] Generation attempt ${
          attempt + 1
        }/${attempts} failed. Status: ${status}`,
      );

      /*
       * Do not retry errors such as:
       * - invalid API key
       * - invalid request
       * - malformed schema
       * - unsupported model
       *
       * Only retry transient provider/rate-limit errors.
       */
      if (
        !isRetryableError(error) ||
        attempt === attempts - 1
      ) {
        throw error;
      }

      /*
       * Exponential-ish backoff:
       *
       * attempt 1 -> 1.5 sec
       * attempt 2 -> 3 sec
       * attempt 3 -> no retry
       */
      const delay = 1500 * (attempt + 1);

      await sleep(delay);
    }
  }

  throw lastError;
}

/* -------------------------------------------------------------------------- */
/*                        CLOUDINARY URL VALIDATION                           */
/* -------------------------------------------------------------------------- */

function isAllowedCloudinaryUrl(value) {
  try {
    const url = new URL(value);

    return (
      url.protocol === "https:" &&
      (
        url.hostname === "res.cloudinary.com" ||
        url.hostname.endsWith(".cloudinary.com")
      )
    );
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/*                    DOWNLOAD CLOUDINARY AUDIO TO TEMP                       */
/* -------------------------------------------------------------------------- */

/**
 * Download audio stored in Cloudinary to a temporary local file.
 *
 * IMPORTANT:
 * This function returns `filePath`, not `tempPath`.
 *
 * The rest of this file consistently uses `audio.filePath`.
 */
async function downloadCloudinaryAudio(
  audioUrl,
  mimeType = "audio/webm",
) {
  if (!audioUrl) {
    throw new Error(
      "Audio URL is required",
    );
  }

  if (!isAllowedCloudinaryUrl(audioUrl)) {
    throw new Error(
      "Invalid or unsupported audio URL",
    );
  }

  const response = await fetch(audioUrl);

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

  const isAudioContent =
    contentType.startsWith("audio/") ||
    contentType === "video/webm";

  if (!isAudioContent) {
    throw new Error(
      `Unsupported media content type: ${contentType}`,
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

  if (contentType === "audio/mpeg") {
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

  const tempPath = path.join(
    os.tmpdir(),
    `careflow-audio-${crypto.randomUUID()}${extension}`,
  );

  await fs.writeFile(
    tempPath,
    buffer,
  );

  return {
    filePath: tempPath,

    /*
     * Gemini accepts audio/webm.
     *
     * Cloudinary can sometimes return video/webm
     * for browser-recorded WebM files.
     */
    mimeType:
      contentType === "video/webm"
        ? "audio/webm"
        : contentType,
  };
}

/* -------------------------------------------------------------------------- */
/*                           ASSESS SINGLE ANSWER                             */
/* -------------------------------------------------------------------------- */

export async function assess({
  answerText = "",
  audioPath,
  audioUrl,
  audioMimeType = "audio/webm",
  protocolText = "",
}) {
  /*
   * Gemini not configured.
   */
  if (!ai) {
    return fallback(answerText);
  }

  let input = [];

  let uploadedFile = null;

  let tempAudioPath = null;

  try {
    /* ---------------------------------------------------------------------- */
    /*                                AUDIO                                   */
    /* ---------------------------------------------------------------------- */

    if (audioPath || audioUrl) {
      const audio = audioPath
        ? {
            filePath: audioPath,
            mimeType: audioMimeType,
          }
        : await downloadCloudinaryAudio(
            audioUrl,
            audioMimeType,
          );

      /*
       * IMPORTANT:
       *
       * Previously the project had:
       *
       * tempAudioPath = audio.tempPath;
       *
       * while the object actually contained `filePath`.
       *
       * That resulted in:
       *
       * Cannot read properties of undefined (reading 'size')
       *
       * because Gemini received:
       *
       * file: undefined
       */
      tempAudioPath = audio.filePath;

      uploadedFile =
        await ai.files.upload({
          file: audio.filePath,

          config: {
            mimeType: audio.mimeType,
          },
        });

      input = [
        createPartFromUri(
          uploadedFile.uri,
          uploadedFile.mimeType,
        ),

        `
Hospital protocol:

${protocolText}

${system}

Transcribe this patient voice answer and assess
only what is explicitly said.

Do not infer information that is not present.
`,
      ];
    }

    /* ---------------------------------------------------------------------- */
    /*                                TEXT                                    */
    /* ---------------------------------------------------------------------- */

    else {
      input = [
        `
Hospital protocol:

${protocolText}

${system}

Patient answer:

${answerText}
`,
      ];
    }

    /* ---------------------------------------------------------------------- */
    /*                           GEMINI REQUEST                                */
    /* ---------------------------------------------------------------------- */

    const response =
      await generateWithRetry(
        input,
        {
          systemInstruction: system,

          responseMimeType:
            "application/json",

          responseSchema: schema,

          temperature: 0,
        },
      );

    if (!response?.text) {
      return fallback(
        audioUrl ? "" : answerText,
      );
    }

    /* ---------------------------------------------------------------------- */
    /*                           PARSE RESPONSE                                */
    /* ---------------------------------------------------------------------- */

    try {
      const parsed = JSON.parse(
        response.text,
      );

      return parsed;
    } catch (parseError) {
      console.warn(
        "[Gemini] Failed to parse assessment JSON:",
        parseError.message,
      );

      return fallback(
        audioUrl ? "" : answerText,
      );
    }
  } catch (error) {
    const status = getErrorStatus(error);

    console.error(
      "[Gemini] Assessment failed:",
      {
        status,
        message: error?.message,
      },
    );

    /*
     * Provider/rate-limit errors are converted
     * into a conservative human-review result.
     */
    if (
      [
        429,
        500,
        502,
        503,
      ].includes(status)
    ) {
      return fallback(
        audioUrl ? "" : answerText,
      );
    }

    /*
     * Non-transient errors should still be visible
     * to the caller so they can be handled properly.
     */
    throw error;
  } finally {
    /* ---------------------------------------------------------------------- */
    /*                     DELETE GEMINI UPLOADED FILE                        */
    /* ---------------------------------------------------------------------- */

    if (uploadedFile?.name) {
      try {
        await ai.files.delete({
          name: uploadedFile.name,
        });
      } catch (deleteError) {
        console.warn(
          "[Gemini] Failed to delete uploaded audio:",
          deleteError?.message,
        );
      }
    }

    /* ---------------------------------------------------------------------- */
    /*                         DELETE TEMP AUDIO                               */
    /* ---------------------------------------------------------------------- */

    if (tempAudioPath) {
      try {
        await fs.unlink(
          tempAudioPath,
        );
      } catch {
        /*
         * File may already have been removed.
         */
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                         TRANSCRIBE AUDIO ONLY                              */
/* -------------------------------------------------------------------------- */

export async function transcribeAudio({
  audioPath,
  audioUrl,
  audioMimeType = "audio/webm",
}) {
  /*
   * If Gemini is not configured,
   * return an empty transcript.
   *
   * The caller should treat this as a failure/uncertain
   * case rather than assuming the patient said nothing.
   */
  if (!ai) {
    return {
      detected_language: "en",
      transcript: "",
    };
  }

  let tempAudioPath = null;

  let uploadedFile = null;

  try {
    /* ---------------------------------------------------------------------- */
    /*                                AUDIO                                   */
    /* ---------------------------------------------------------------------- */

    const audio = audioPath
      ? {
          filePath: audioPath,
          mimeType: audioMimeType,
        }
      : await downloadCloudinaryAudio(
          audioUrl,
          audioMimeType,
        );

    /*
     * IMPORTANT:
     * Use filePath consistently.
     */
    tempAudioPath = audio.filePath;

    /* ---------------------------------------------------------------------- */
    /*                           UPLOAD TO GEMINI                              */
    /* ---------------------------------------------------------------------- */

    uploadedFile =
      await ai.files.upload({
        file: audio.filePath,

        config: {
          mimeType: audio.mimeType,
        },
      });

    /* ---------------------------------------------------------------------- */
    /*                           TRANSCRIPTION                                 */
    /* ---------------------------------------------------------------------- */

    const response =
      await generateWithRetry(
        [
          createPartFromUri(
            uploadedFile.uri,
            uploadedFile.mimeType,
          ),

          `
Transcribe only the patient voice recording.

Do not infer anything.
Do not summarize.
Do not add information.
Do not diagnose.
Do not interpret.

Return JSON only.
`,
        ],

        {
          responseMimeType:
            "application/json",

          responseSchema:
            transcriptSchema,

          temperature: 0,
        },
      );

    if (!response?.text) {
      return {
        detected_language: "en",
        transcript: "",
      };
    }

    try {
      return JSON.parse(
        response.text,
      );
    } catch (parseError) {
      console.warn(
        "[Gemini] Failed to parse transcription JSON:",
        parseError.message,
      );

      return {
        detected_language: "en",
        transcript: "",
      };
    }
  } catch (error) {
    const status = getErrorStatus(error);

    console.error(
      "[Gemini] Transcription failed:",
      {
        status,
        message: error?.message,
      },
    );

    /*
     * Keep transcription failures conservative.
     *
     * We do NOT invent a transcript.
     */
    if (
      [
        429,
        500,
        502,
        503,
      ].includes(status)
    ) {
      return {
        detected_language: "en",
        transcript: "",
      };
    }

    throw error;
  } finally {
    /* ---------------------------------------------------------------------- */
    /*                     DELETE GEMINI UPLOAD                               */
    /* ---------------------------------------------------------------------- */

    if (uploadedFile?.name) {
      try {
        await ai.files.delete({
          name: uploadedFile.name,
        });
      } catch (deleteError) {
        console.warn(
          "[Gemini] Failed to delete transcription upload:",
          deleteError?.message,
        );
      }
    }

    /* ---------------------------------------------------------------------- */
    /*                         DELETE TEMP FILE                                */
    /* ---------------------------------------------------------------------- */

    if (tempAudioPath) {
      try {
        await fs.unlink(
          tempAudioPath,
        );
      } catch {
        /*
         * Temporary file may already be gone.
         */
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                         HOLISTIC ASSESSMENT                                */
/* -------------------------------------------------------------------------- */

export async function assessHolistic({
  answers,
  protocolText = "",
}) {
  /*
   * Gemini unavailable.
   */
  if (!ai) {
    return fallback(
      answers
        .map(
          (a) =>
            `${a.question}: ${a.answer}`,
        )
        .join(" | "),
    );
  }

  const prompt = `
Hospital protocol:

${protocolText}

${system}

Assess the complete post-discharge questionnaire
as one case.

Do not diagnose.
Do not prescribe.
Do not recommend medication changes.

Use only the supplied answers.

If answers are:

- incomplete
- ambiguous
- conflicting
- unsupported by the protocol

classify as "uncertain" and require human review.

Patient answers:

${answers
  .map(
    (a, i) =>
      `${i + 1}. ${a.question}: ${a.answer}`,
  )
  .join("\n")}
`;

  try {
    const response =
      await generateWithRetry(
        [prompt],

        {
          systemInstruction: system,

          responseMimeType:
            "application/json",

          responseSchema: schema,

          temperature: 0,
        },
      );

    if (!response?.text) {
      return fallback();
    }

    try {
      return JSON.parse(
        response.text,
      );
    } catch (parseError) {
      console.warn(
        "[Gemini] Failed to parse holistic assessment:",
        parseError.message,
      );

      return fallback();
    }
  } catch (error) {
    const status = getErrorStatus(error);

    console.error(
      "[Gemini] Holistic assessment failed:",
      {
        status,
        message: error?.message,
      },
    );

    /*
     * All transient Gemini failures result in
     * conservative human review.
     */
    if (
      [
        429,
        500,
        502,
        503,
      ].includes(status)
    ) {
      return fallback();
    }

    throw error;
  }
}