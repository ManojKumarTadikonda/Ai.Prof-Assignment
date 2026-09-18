import { z } from "zod";

export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ message: "Invalid request body", errors: result.error.issues });
    req.body = result.data;
    next();
  };
}

export const transitionSchema = z.object({
  status: z.enum(["READY", "SCHEDULED", "RUNNING", "PAUSED", "COMPLETED", "CANCELLED", "FAILED"]),
});

export const callbackSchema = z.object({
  callbackAt: z.string().datetime(),
});
