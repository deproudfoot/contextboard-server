import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

/* -------------------- helpers -------------------- */

function isEmailAllowed(email) {
  const allowlist = process.env.INVITE_ALLOWLIST;
  if (!allowlist) return false;

  const allowed = allowlist
    .split(",")
    .map(e => e.trim().toLowerCase());

  email = email.toLowerCase();

  return allowed.some(entry =>
    entry.startsWith("@")
      ? email.endsWith(entry)
      : email === entry
  );
}

function createToken(userId) {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing token" });
  }

  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

/* -------------------- health -------------------- */

app.get("/health", (_, res) => {
  res.json({ ok: true });
});

/* -------------------- auth -------------------- */

app.post("/auth/register", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: "Missing fields" });

  if (!isEmailAllowed(email))
    return res.status(403).json({ error: "Not invited" });

  const existing = await prisma.user.findUnique({
    where: { email }
  });

  if (existing)
    return res.status(400).json({ error: "User already exists" });

  const hash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: { email, password: hash }
  });

  const token = createToken(user.id);

  res.json({ token });
});

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({
    where: { email }
  });

  if (!user)
    return res.status(401).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok)
    return res.status(401).json({ error: "Invalid credentials" });

  const token = createToken(user.id);

  res.json({ token });
});

/* -------------------- protected -------------------- */

app.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, email: true, createdAt: true }
  });

  res.json(user);
});

/* -------------------- server -------------------- */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("API running on port", PORT);
});
