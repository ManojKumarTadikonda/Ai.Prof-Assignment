import { testSendEmail } from "./services/email.js";

const TEST_EMAIL = "n210519@rguktn.ac.in";

try {
  const result = await testSendEmail(TEST_EMAIL);

  console.log("✅ EMAIL SENT SUCCESSFULLY");
  console.log(result);
} catch (error) {
  console.error("❌ EMAIL FAILED");

  if (error.response?.body) {
    console.error(
      JSON.stringify(error.response.body, null, 2)
    );
  } else {
    console.error(error);
  }
}