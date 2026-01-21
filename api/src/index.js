import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import http from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";
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

function isEditor(role) {
  return role === "owner" || role === "editor";
}

async function getBoardForUser(boardId, userId) {
  return prisma.board.findFirst({
    where: {
      id: boardId,
      OR: [{ ownerId: userId }, { collaborators: { some: { userId } } }]
    },
    include: {
      collaborators: {
        where: { userId },
        select: { role: true }
      },
      owner: {
        select: { id: true, email: true }
      }
    }
  });
}

function getAccessRole(board, userId) {
  if (!board) return null;
  if (board.ownerId === userId) return "owner";
  return board.collaborators?.[0]?.role || "viewer";
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
  const owned = await prisma.board.findMany({
    where: { ownerId: req.userId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, updatedAt: true, createdAt: true }
  });
  const shared = await prisma.board.findMany({
    where: { collaborators: { some: { userId: req.userId } } },
    orderBy: { updatedAt: "desc" },
    include: {
      owner: { select: { email: true } },
      collaborators: {
        where: { userId: req.userId },
        select: { role: true }
      }
    }
  });
  const sharedItems = shared.map((board) => ({
    id: board.id,
    title: board.title,
    updatedAt: board.updatedAt,
    createdAt: board.createdAt,
    accessRole: board.collaborators?.[0]?.role || "viewer",
    ownerEmail: board.owner?.email || "Unknown"
  }));
  const ownedItems = owned.map((board) => ({
    ...board,
    accessRole: "owner",
    ownerEmail: null
  }));
  const boards = [...ownedItems, ...sharedItems].sort((a, b) => {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
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
  const board = await getBoardForUser(req.params.id, req.userId);
  if (!board) {
    return res.status(404).json({ error: "Board not found" });
  }
  return res.json({
    board: {
      id: board.id,
      ownerId: board.ownerId,
      title: board.title,
      data: board.data,
      createdAt: board.createdAt,
      updatedAt: board.updatedAt,
      accessRole: getAccessRole(board, req.userId),
      ownerEmail: board.owner?.email || null
    }
  });
});

app.put("/boards/:id", authMiddleware, async (req, res) => {
  const { title, data } = req.body ?? {};
  const board = await getBoardForUser(req.params.id, req.userId);
  if (!board) {
    return res.status(404).json({ error: "Board not found" });
  }
  const role = getAccessRole(board, req.userId);
  if (!isEditor(role)) {
    return res.status(403).json({ error: "Read-only access" });
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

app.post("/boards/:id/collaborators", authMiddleware, async (req, res) => {
  const { email, role } = req.body ?? {};
  if (!email || !role) {
    return res.status(400).json({ error: "Email and role are required" });
  }
  if (!["editor", "viewer"].includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }
  const board = await prisma.board.findFirst({
    where: { id: req.params.id, ownerId: req.userId }
  });
  if (!board) {
    return res.status(404).json({ error: "Board not found" });
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  const collaborator = await prisma.boardCollaborator.upsert({
    where: { boardId_userId: { boardId: board.id, userId: user.id } },
    update: { role },
    create: { boardId: board.id, userId: user.id, role }
  });
  return res.status(201).json({ collaborator });
});

app.get("/boards/:id/collaborators", authMiddleware, async (req, res) => {
  const board = await prisma.board.findFirst({
    where: { id: req.params.id, ownerId: req.userId }
  });
  if (!board) {
    return res.status(404).json({ error: "Board not found" });
  }
  const collaborators = await prisma.boardCollaborator.findMany({
    where: { boardId: board.id },
    include: { user: { select: { email: true } } }
  });
  return res.json({
    collaborators: collaborators.map((item) => ({
      id: item.id,
      email: item.user.email,
      role: item.role,
      createdAt: item.createdAt
    }))
  });
});

app.delete("/boards/:id/collaborators/:collaboratorId", authMiddleware, async (req, res) => {
  const board = await prisma.board.findFirst({
    where: { id: req.params.id, ownerId: req.userId }
  });
  if (!board) {
    return res.status(404).json({ error: "Board not found" });
  }
  await prisma.boardCollaborator.deleteMany({
    where: { id: req.params.collaboratorId, boardId: board.id }
  });
  return res.json({ ok: true });
});

app.post("/boards/:id/shares", authMiddleware, async (req, res) => {
  const { role } = req.body ?? {};
  if (!role || !["view", "comment"].includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }
  const board = await prisma.board.findFirst({
    where: { id: req.params.id, ownerId: req.userId }
  });
  if (!board) {
    return res.status(404).json({ error: "Board not found" });
  }
  const share = await prisma.boardShare.create({
    data: {
      boardId: board.id,
      role,
      token: crypto.randomUUID()
    }
  });
  return res.status(201).json({ share });
});

app.get("/boards/:id/shares", authMiddleware, async (req, res) => {
  const board = await prisma.board.findFirst({
    where: { id: req.params.id, ownerId: req.userId }
  });
  if (!board) {
    return res.status(404).json({ error: "Board not found" });
  }
  const shares = await prisma.boardShare.findMany({
    where: { boardId: board.id },
    orderBy: { createdAt: "desc" }
  });
  return res.json({ shares });
});

app.delete("/boards/:id/shares/:shareId", authMiddleware, async (req, res) => {
  const board = await prisma.board.findFirst({
    where: { id: req.params.id, ownerId: req.userId }
  });
  if (!board) {
    return res.status(404).json({ error: "Board not found" });
  }
  await prisma.boardShare.deleteMany({
    where: { id: req.params.shareId, boardId: board.id }
  });
  return res.json({ ok: true });
});

app.get("/share/:token", async (req, res) => {
  const share = await prisma.boardShare.findUnique({
    where: { token: req.params.token },
    include: { board: true }
  });
  if (!share) {
    return res.status(404).json({ error: "Share link not found" });
  }
  return res.json({
    role: share.role,
    board: {
      id: share.board.id,
      title: share.board.title,
      data: share.board.data,
      updatedAt: share.board.updatedAt
    }
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const rooms = new Map();

function addToRoom(boardId, socket) {
  if (!rooms.has(boardId)) {
    rooms.set(boardId, new Set());
  }
  rooms.get(boardId).add(socket);
}

function removeFromRoom(boardId, socket) {
  if (!rooms.has(boardId)) return;
  const room = rooms.get(boardId);
  room.delete(socket);
  if (room.size === 0) {
    rooms.delete(boardId);
  }
}

wss.on("connection", async (socket, req) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get("token");
    const boardId = url.searchParams.get("boardId");
    if (!token || !boardId) {
      socket.close(1008, "Missing token or boardId");
      return;
    }
    const payload = jwt.verify(token, jwtSecret);
    const board = await getBoardForUser(boardId, payload.sub);
    if (!board) {
      socket.close(1008, "Unauthorized");
      return;
    }
    socket.boardId = boardId;
    socket.userId = payload.sub;
    socket.accessRole = getAccessRole(board, payload.sub);
    addToRoom(boardId, socket);
    socket.on("message", (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!message) return;
      if (message.type === "board_update") {
        if (!isEditor(socket.accessRole)) {
          return;
        }
        const payload = JSON.stringify({
          type: "board_update",
          boardId,
          data: message.data,
          sender: message.sender
        });
        const room = rooms.get(boardId) || new Set();
        room.forEach((client) => {
          if (client !== socket && client.readyState === client.OPEN) {
            client.send(payload);
          }
        });
        return;
      }
      if (message.type === "presence") {
        const payload = JSON.stringify({
          type: "presence",
          boardId,
          sender: message.sender,
          cursor: message.cursor,
          label: message.label
        });
        const room = rooms.get(boardId) || new Set();
        room.forEach((client) => {
          if (client !== socket && client.readyState === client.OPEN) {
            client.send(payload);
          }
        });
      }
    });
    socket.on("close", () => {
      removeFromRoom(boardId, socket);
    });
  } catch (error) {
    socket.close(1011, "Server error");
  }
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`API listening on ${port}`);
});
