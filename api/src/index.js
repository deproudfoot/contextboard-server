import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const prisma = new PrismaClient();
const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const jwtSecret = process.env.JWT_SECRET;
const inviteAllowlist = process.env.INVITE_ALLOWLIST || "";

if (!jwtSecret) {
  throw new Error("JWT_SECRET is required");
}

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, jwtSecret, { expiresIn: "7d" });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Missing token" });
  }
  try {
    const payload = jwt.verify(token, jwtSecret);
    req.userId = payload.sub;
    req.userEmail = payload.email;
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function isInvited(email) {
  const allowlist = inviteAllowlist
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(email.toLowerCase());
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/auth/register", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  if (!isInvited(email)) {
    return res.status(403).json({ error: "Not invited" });
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "User already exists" });
  }
  const hashed = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, password: hashed }
  });
  const token = signToken(user);
  return res.json({ token });
});

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const token = signToken(user);
  return res.json({ token });
});

app.get("/me", authMiddleware, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  return res.json({ id: user.id, email: user.email, createdAt: user.createdAt });
});

app.get("/boards", authMiddleware, async (req, res) => {
  const boards = await prisma.board.findMany({
    where: { ownerId: req.userId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, updatedAt: true, createdAt: true }
  });
  return res.json({ boards });
});

app.post("/boards", authMiddleware, async (req, res) => {
  const { title, data } = req.body ?? {};
  const board = await prisma.board.create({
    data: {
      ownerId: req.userId,
      title: typeof title === "string" && title.trim() ? title.trim() : "Untitled Board",
      data: data ?? {}
    }
  });
  return res.status(201).json({ board });
});

app.get("/boards/:id", authMiddleware, async (req, res) => {
  const board = await prisma.board.findFirst({
    where: { id: req.params.id, ownerId: req.userId }
  });
  if (!board) {
    return res.status(404).json({ error: "Board not found" });
  }
  return res.json({ board });
});

app.put("/boards/:id", authMiddleware, async (req, res) => {
  const { title, data } = req.body ?? {};
  const board = await prisma.board.findFirst({
    where: { id: req.params.id, ownerId: req.userId }
  });
  if (!board) {
    return res.status(404).json({ error: "Board not found" });
  }
  const updated = await prisma.board.update({
    where: { id: board.id },
    data: {
      title: typeof title === "string" && title.trim() ? title.trim() : board.title,
      data: data ?? board.data
    }
  });
  return res.json({ board: updated });
});

app.delete("/boards/:id", authMiddleware, async (req, res) => {
  const board = await prisma.board.findFirst({
    where: { id: req.params.id, ownerId: req.userId }
  });
  if (!board) {
    return res.status(404).json({ error: "Board not found" });
  }
  await prisma.board.delete({ where: { id: board.id } });
  return res.json({ ok: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`API listening on ${port}`);
});
