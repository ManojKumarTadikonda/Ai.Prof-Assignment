import dotenv from 'dotenv';
dotenv.config();
export const env = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || "dev-secret",
  appUrl: process.env.APP_URL || "https://ai-prof-assignment.vercel.app/",
  geminiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  sendgridKey: process.env.SENDGRID_API_KEY,
  sendgridFrom: process.env.SENDGRID_FROM_EMAIL,
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
};
