import {
  GoogleGenAI,
  createUserContent,
  createPartFromUri,
} from "@google/genai";
import { env } from "../config/env.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const ai = env.geminiKey ? new GoogleGenAI({ apiKey: env.geminiKey }) : null;
const schema = {
  type: "object",
  properties: {
    detected_language: { type: "string" },
    transcript: { type: "string" },
    classification: {
      type: "string",
      enum: ["routine", "concerning", "urgent", "uncertain"],
    },
    evidence: { type: "array", items: { type: "string" } },
    uncertainty: { type: "string", enum: ["low", "medium", "high"] },
    requires_human_review: { type: "boolean" },
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
    detected_language: { type: "string" },
    transcript: { type: "string" },
  },
  required: ["detected_language", "transcript"],
};
const system = `You are a safety-first post-discharge intake and triage assistant. You are not a diagnosing or prescribing clinician. Use only the patient answers and supplied hospital protocol. Never invent symptoms, diagnoses, medications, vitals, tests, or facts. If information is incomplete, ambiguous, conflicting, or unsupported by the protocol, classify uncertain and require human review. If a protocol safety trigger is present, do not downgrade it. Output only the requested JSON.`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
async function generateWithRetry(contents, config, attempts = 3) {
  if (!ai) return null;
  let last;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await ai.models.generateContent({
        model: env.geminiModel,
        contents,
        config,
      });
    } catch (e) {
      last = e;
      const status = e?.status || e?.code;
      if (status !== 503 || attempt === attempts - 1) throw e;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw last;
}
export async function assess({
  answerText = "",
  audioPath,
  audioUrl,
  audioMimeType = "audio/webm",
  protocolText = "",
}) {
  if (!ai) return fallback(answerText);
  let input = [];
  let uploadedFile = null;
  let tempAudioPath = null;

  if (audioPath || audioUrl) {
    const audio = audioPath
      ? { filePath: audioPath, mimeType: audioMimeType }
      : await downloadCloudinaryAudio(audioUrl, audioMimeType);

    tempAudioPath = audio.tempPath;

    uploadedFile = await ai.files.upload({
      file: audio.filePath,
      config: {
        mimeType: audio.mimeType,
      },
    });

    input = [
      createPartFromUri(uploadedFile.uri, uploadedFile.mimeType),
      `Hospital protocol:
${protocolText}

${system}

Transcribe this patient voice answer and assess only what is explicitly said.`,
    ];
  } else {
    input = [
      `Hospital protocol:
${protocolText}

${system}

Patient answer:
${answerText}`,
    ];
  }
  try {
    const r = await generateWithRetry(input, {
      systemInstruction: system,
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature: 0,
    });

    try {
      return JSON.parse(r.text);
    } catch {
      return fallback(answerText);
    }
  } catch (e) {
    const status = Number(e?.status || e?.code);

    if ([429, 500, 502, 503].includes(status)) {
      return fallback(audioUrl ? "" : answerText);
    }

    throw e;
  } finally {
    if (uploadedFile?.name) {
      try {
        await ai.files.delete({
          name: uploadedFile.name,
        });
      } catch (deleteError) {
        console.warn(
          "[Gemini] Failed to delete uploaded audio:",
          deleteError.message,
        );
      }
    }

    if (tempAudioPath) {
      try {
        await fs.unlink(tempAudioPath);
      } catch {
        // Temporary file may already be gone.
      }
    }
  }
}
export async function transcribeAudio({
  audioPath,
  audioUrl,
  audioMimeType = "audio/webm",
}) {
  if (!ai) {
    return {
      detected_language: "en",
      transcript: "",
    };
  }

  let tempAudioPath = null;
  let uploadedFile = null;

  try {
    const audio = audioPath
      ? { filePath: audioPath, mimeType: audioMimeType }
      : await downloadCloudinaryAudio(audioUrl, audioMimeType);

    tempAudioPath = audio.tempPath;

    uploadedFile = await ai.files.upload({
      file: audio.filePath,
      config: {
        mimeType: audio.mimeType,
      },
    });

    const r = await generateWithRetry(
      [
        createPartFromUri(uploadedFile.uri, uploadedFile.mimeType),
        "Transcribe only the patient voice recording. Do not infer or add any information. Return JSON only.",
      ],
      {
        responseMimeType: "application/json",
        responseSchema: transcriptSchema,
        temperature: 0,
      },
    );

    try {
      return JSON.parse(r.text);
    } catch {
      return {
        detected_language: "en",
        transcript: "",
      };
    }
  } catch (e) {
    const status = Number(e?.status || e?.code);

    if ([429, 500, 502, 503].includes(status)) {
      return {
        detected_language: "en",
        transcript: "",
      };
    }

    throw e;
  } finally {
    if (uploadedFile?.name) {
      try {
        await ai.files.delete({
          name: uploadedFile.name,
        });
      } catch {}
    }

    if (tempAudioPath) {
      try {
        await fs.unlink(tempAudioPath);
      } catch {}
    }
  }
}
export async function assessHolistic({ answers, protocolText = "" }) {
  if (!ai)
    return fallback(
      answers.map((a) => `${a.question}: ${a.answer}`).join(" | "),
    );
  const prompt = `Hospital protocol:\n${protocolText}\n\n${system}\n\nAssess the complete post-discharge questionnaire as one case. Do not diagnose or prescribe. Use only the supplied answers. If answers are incomplete, ambiguous, conflicting, or unsupported, classify uncertain and require human review.\n\nPatient answers:\n${answers.map((a, i) => `${i + 1}. ${a.question}: ${a.answer}`).join("\n")}`;
  try {
    const r = await generateWithRetry([prompt], {
      systemInstruction: system,
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature: 0,
    });
    try {
      return JSON.parse(r.text);
    } catch {
      return fallback(prompt);
    }
  } catch (e) {
    if (e?.status === 503 || e?.code === 503) return fallback();
    throw e;
  }
}

function isAllowedCloudinaryUrl(value) {
  try {
    const url = new URL(value);

    return (
      url.protocol === "https:" &&
      (url.hostname === "res.cloudinary.com" ||
        url.hostname.endsWith(".cloudinary.com"))
    );
  } catch {
    return false;
  }
}

async function downloadCloudinaryAudio(audioUrl, mimeType = "audio/webm") {
  if (!isAllowedCloudinaryUrl(audioUrl)) {
    throw new Error("Invalid or unsupported audio URL");
  }

  const response = await fetch(audioUrl);

  if (!response.ok) {
    throw new Error(
      `Cloudinary audio download failed: ${response.status} ${response.statusText}`,
    );
  }

  const contentType =
    response.headers.get("content-type")?.split(";")[0] || mimeType;

  const isAudioContent =
    contentType.startsWith("audio/") || contentType === "video/webm";

  if (!isAudioContent) {
    throw new Error(`Unsupported media content type: ${contentType}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (!buffer.length) {
    throw new Error("Downloaded audio file is empty");
  }

  const extension =
    contentType === "audio/mpeg"
      ? ".mp3"
      : contentType === "audio/wav"
        ? ".wav"
        : contentType === "audio/ogg"
          ? ".ogg"
          : ".webm";

  const tempPath = path.join(
    os.tmpdir(),
    `careflow-audio-${crypto.randomUUID()}${extension}`,
  );

  await fs.writeFile(tempPath, buffer);

  return {
    tempPath,
    mimeType: contentType === "video/webm" ? "audio/webm" : contentType,
  };
}
