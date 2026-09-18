import "dotenv/config";

import { connectDB } from "./config/db.js";
import {
  Patient,
  OutreachTask,
  PatientResponse,
  Campaign,
  Protocol,
} from "./models/index.js";

import {
  transcribeAudio,
  assessHolistic,
} from "./services/ai.js";

/* -------------------------------------------------------------------------- */
/*                              CONFIGURATION                                 */
/* -------------------------------------------------------------------------- */

const PATIENT_NAME = "Demo Patient 003";

if (!process.env.GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY is missing");
  process.exit(1);
}

if (!process.env.MONGODB_URI) {
  console.error("❌ MONGODB_URI is missing");
  process.exit(1);
}

console.log(
  `Testing Gemini model: ${
    process.env.GEMINI_MODEL || "gemini-2.5-flash"
  }`,
);

console.log(
  `Testing patient: ${PATIENT_NAME}`,
);

console.log(
  "This test reads MongoDB and Cloudinary only.",
);

console.log(
  "It does NOT write responses, EHR records, assessments, or escalations.",
);

console.log(
  "It does NOT send emails.",
);

/* -------------------------------------------------------------------------- */
/*                              CONNECT DATABASE                              */
/* -------------------------------------------------------------------------- */

await connectDB();

console.log("\n✅ MongoDB connected");

/* -------------------------------------------------------------------------- */
/*                              FIND PATIENT                                  */
/* -------------------------------------------------------------------------- */

const patient = await Patient.findOne({
  name: PATIENT_NAME,
}).lean();

if (!patient) {
  console.error(
    `❌ Patient "${PATIENT_NAME}" was not found in MongoDB.`,
  );

  process.exit(1);
}

console.log("\n👤 Patient found");
console.log("----------------------------------------");

console.log({
  id: String(patient._id),
  name: patient.name,
  email: patient.email,
  hospitalId: String(patient.hospitalId),
  risk: patient.risk,
  dischargeDate: patient.dischargeDate,
});

/* -------------------------------------------------------------------------- */
/*                            FIND OUTREACH TASK                              */
/* -------------------------------------------------------------------------- */

const task = await OutreachTask.findOne({
  patientId: patient._id,
})
  .sort({
    createdAt: -1,
  })
  .lean();

if (!task) {
  console.error(
    `❌ No outreach task found for ${PATIENT_NAME}`,
  );

  process.exit(1);
}

console.log("\n📋 Outreach task found");
console.log("----------------------------------------");

console.log({
  taskId: String(task._id),
  status: task.status,
  aiProcessingStatus: task.aiProcessingStatus,
  campaignId: String(task.campaignId),
});

/* -------------------------------------------------------------------------- */
/*                               FIND CAMPAIGN                                */
/* -------------------------------------------------------------------------- */

const campaign = await Campaign.findById(
  task.campaignId,
).lean();

if (!campaign) {
  console.error(
    "❌ Campaign not found for outreach task.",
  );

  process.exit(1);
}

console.log("\n📢 Campaign");
console.log("----------------------------------------");

console.log({
  id: String(campaign._id),
  name: campaign.name,
  protocolId: campaign.protocolId
    ? String(campaign.protocolId)
    : null,
});

/* -------------------------------------------------------------------------- */
/*                               FIND PROTOCOL                                */
/* -------------------------------------------------------------------------- */

let protocol = null;

if (campaign.protocolId) {
  protocol = await Protocol.findById(
    campaign.protocolId,
  ).lean();
}

const protocolText =
  protocol?.sourceText || "";

console.log("\n🏥 Protocol");
console.log("----------------------------------------");

if (protocol) {
  console.log({
    id: String(protocol._id),
    name: protocol.name,
    version: protocol.version,
  });

  console.log("\nProtocol text:");
  console.log(protocolText);
} else {
  console.log(
    "⚠️ No protocol found. Continuing with empty protocol.",
  );
}

/* -------------------------------------------------------------------------- */
/*                           GET PATIENT RESPONSES                            */
/* -------------------------------------------------------------------------- */

const responses = await PatientResponse.find({
  patientId: patient._id,
  outreachTaskId: task._id,
})
  .sort({
    createdAt: 1,
  })
  .lean();

if (!responses.length) {
  console.error(
    `❌ No responses found for ${PATIENT_NAME}`,
  );

  process.exit(1);
}

console.log("\n📝 Patient responses found");
console.log("----------------------------------------");

console.log(
  `Total responses: ${responses.length}`,
);

console.log(
  `Voice responses: ${
    responses.filter(
      (r) => r.responseType === "VOICE",
    ).length
  }`,
);

console.log(
  `Text responses: ${
    responses.filter(
      (r) => r.responseType === "TEXT",
    ).length
  }`,
);

/* -------------------------------------------------------------------------- */
/*                         QUESTION LOOKUP MAP                                */
/* -------------------------------------------------------------------------- */

const questionMap = new Map();

for (const question of campaign.questions || []) {
  questionMap.set(
    question.id,
    question.text,
  );
}

/* -------------------------------------------------------------------------- */
/*                         PROCESS EACH RESPONSE                              */
/* -------------------------------------------------------------------------- */

const answers = [];

console.log(
  "\n🎙️ Processing patient voice responses",
);

console.log(
  "========================================",
);

for (
  let i = 0;
  i < responses.length;
  i++
) {
  const response = responses[i];

  const question =
    questionMap.get(
      response.questionId,
    ) || response.questionId;

  console.log(
    `\n[${i + 1}/${responses.length}]`,
  );

  console.log(
    `Question: ${question}`,
  );

  console.log(
    `Response type: ${response.responseType}`,
  );

  /* ------------------------------------------------------------------------ */
  /*                               TEXT                                       */
  /* ------------------------------------------------------------------------ */

  if (
    response.responseType === "TEXT"
  ) {
    const answer = response.text || "";

    console.log(
      `Text answer: ${answer}`,
    );

    answers.push({
      question,
      answer,
      detectedLanguage: "en",
    });

    continue;
  }

  /* ------------------------------------------------------------------------ */
  /*                               VOICE                                      */
  /* ------------------------------------------------------------------------ */

  if (
    response.responseType === "VOICE"
  ) {
    const audioUrl =
      response.audio?.secureUrl;

    if (!audioUrl) {
      console.log(
        "❌ No Cloudinary secureUrl found.",
      );

      /*
       * We intentionally keep an empty answer.
       * The holistic model should treat missing voice
       * information conservatively.
       */
      answers.push({
        question,
        answer: "",
        detectedLanguage: "en",
      });

      continue;
    }

    console.log(
      `Cloudinary URL: ${audioUrl}`,
    );

    console.log(
      `MIME type: ${
        response.audio?.mimeType ||
        "audio/webm"
      }`,
    );

    try {
      console.log(
        "⏳ Sending Cloudinary audio to Gemini...",
      );

      const transcription =
        await transcribeAudio({
          audioUrl,
          audioMimeType:
            response.audio?.mimeType ||
            "audio/webm",
        });

      const transcript =
        transcription?.transcript || "";

      const detectedLanguage =
        transcription?.detected_language ||
        "en";

      console.log(
        "✅ Gemini transcription completed",
      );

      console.log(
        `Detected language: ${detectedLanguage}`,
      );

      console.log(
        `Transcript: ${transcript || "(empty)"}`,
      );

      /*
       * Keep the transcribed answer in memory only.
       *
       * This test file does NOT update PatientResponse.
       */
      answers.push({
        question,
        answer: transcript,
        detectedLanguage,
      });
    } catch (error) {
      console.error(
        "❌ Voice transcription failed",
      );

      console.error(
        "Error:",
        error?.message || error,
      );

      /*
       * Do not invent an answer if transcription fails.
       */
      answers.push({
        question,
        answer: "",
        detectedLanguage: "en",
      });
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                          PRINT FINAL ANSWERS                               */
/* -------------------------------------------------------------------------- */

console.log(
  "\n\n🧾 FINAL ANSWERS USED FOR AI",
);

console.log(
  "========================================",
);

for (
  let i = 0;
  i < answers.length;
  i++
) {
  const answer = answers[i];

  console.log(
    `\n${i + 1}. ${answer.question}`,
  );

  console.log(
    `Language: ${answer.detectedLanguage}`,
  );

  console.log(
    `Answer: ${
      answer.answer || "(empty)"
    }`,
  );
}

/* -------------------------------------------------------------------------- */
/*                         CHECK MISSING ANSWERS                              */
/* -------------------------------------------------------------------------- */

const missingAnswers =
  answers.filter(
    (a) => !a.answer?.trim(),
  );

if (missingAnswers.length) {
  console.log(
    "\n⚠️ Missing/empty answers detected:",
  );

  for (const item of missingAnswers) {
    console.log(
      `- ${item.question}`,
    );
  }

  console.log(
    "\nThe AI should conservatively classify this case as uncertain/human review.",
  );
}

/* -------------------------------------------------------------------------- */
/*                         GEMINI HOLISTIC TEST                              */
/* -------------------------------------------------------------------------- */

console.log(
  "\n\n🤖 GEMINI HOLISTIC ASSESSMENT",
);

console.log(
  "========================================",
);

/* -------------------------------------------------------------------------- */
/*                            ASSESSMENT #1                                  */
/* -------------------------------------------------------------------------- */

console.log(
  "\n🔹 Running assessment #1...",
);

let assessment1;

try {
  assessment1 =
    await assessHolistic({
      answers,
      protocolText,
    });

  console.log(
    "\n✅ Assessment #1 completed",
  );

  console.log(
    JSON.stringify(
      assessment1,
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    "\n❌ Assessment #1 failed",
  );

  console.error(
    error?.message || error,
  );

  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/*                            ASSESSMENT #2                                  */
/* -------------------------------------------------------------------------- */

console.log(
  "\n🔹 Running assessment #2...",
);

let assessment2;

try {
  assessment2 =
    await assessHolistic({
      answers,
      protocolText,
    });

  console.log(
    "\n✅ Assessment #2 completed",
  );

  console.log(
    JSON.stringify(
      assessment2,
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    "\n❌ Assessment #2 failed",
  );

  console.error(
    error?.message || error,
  );

  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/*                             COMPARE RESULTS                                */
/* -------------------------------------------------------------------------- */

console.log(
  "\n\n🔎 ASSESSMENT COMPARISON",
);

console.log(
  "========================================",
);

console.log(
  `Assessment #1 classification: ${
    assessment1?.classification
  }`,
);

console.log(
  `Assessment #2 classification: ${
    assessment2?.classification
  }`,
);

console.log(
  `Assessment #1 human review: ${
    assessment1?.requires_human_review
  }`,
);

console.log(
  `Assessment #2 human review: ${
    assessment2?.requires_human_review
  }`,
);

console.log(
  `Assessment #1 uncertainty: ${
    assessment1?.uncertainty
  }`,
);

console.log(
  `Assessment #2 uncertainty: ${
    assessment2?.uncertainty
  }`,
);

/* -------------------------------------------------------------------------- */
/*                            FINAL RESULT                                    */
/* -------------------------------------------------------------------------- */

console.log(
  "\n\n✅ GEMINI AUDIO TEST COMPLETED",
);

console.log(
  "========================================",
);

console.log(
  `Patient: ${PATIENT_NAME}`,
);

console.log(
  `Voice responses tested: ${
    responses.filter(
      (r) =>
        r.responseType === "VOICE",
    ).length
  }`,
);

console.log(
  `Total responses: ${responses.length}`,
);

console.log(
  "\nNo MongoDB documents were modified.",
);

console.log(
  "No PatientResponse documents were modified.",
);

console.log(
  "No AIAssessment documents were created.",
);

console.log(
  "No EHR records were created.",
);

console.log(
  "No escalation was created.",
);

console.log(
  "No email was sent.",
);

console.log(
  "\nGemini audio + transcription + holistic assessment test finished successfully.",
);

/* -------------------------------------------------------------------------- */
/*                              CLOSE DB                                     */
/* -------------------------------------------------------------------------- */

process.exit(0);