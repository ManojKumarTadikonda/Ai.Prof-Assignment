import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/index.js";
import { env } from "../config/env.js";

const r = Router();

r.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    console.log(`[AUTH] Login attempt | email=${email || "missing"}`);

    const u = await User.findOne({ email });
    if (!u || !(await bcrypt.compare(password, u.passwordHash))) {
      console.log(`[AUTH] Login failed | email=${email || "missing"}`);
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { userId: u._id, role: u.role, hospitalId: u.hospitalId },
      env.jwtSecret,
      { expiresIn: "8h" },
    );

    console.log(`[AUTH] Login success | user=${u.email} | role=${u.role} | hospital=${u.hospitalId || "PLATFORM"}`);
    res.json({
      token,
      user: {
        id: u._id,
        name: u.name,
        email: u.email,
        role: u.role,
        hospitalId: u.hospitalId,
      },
    });
  } catch (e) {
    next(e);
  }
});

export default r;
