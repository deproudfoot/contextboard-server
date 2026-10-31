const http = require("http");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { WebSocketServer } = require("ws");
const { FileLibrary, nowIso } = require("./store.cjs");

function createId() {
  return crypto.randomUUID();
}

function startServer(options = {}) {
  const dataDir = options.dataDir;
  if (!dataDir) {
    return Promise.reject(new Error("dataDir is required"));
  }
  const preferredPort = Number(options.port || process.env.CONTEXTBOARD_PORT || 18765);
  const library = new FileLibrary(dataDir);
  library.load();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "8mb" }));

  function signToken(user) {
    return jwt.sign({ sub: user.id, email: user.email }, library.get().secret, {
      expiresIn: "10y"
    });
  }

  function publicOrigin(req) {
    if (options.publicOrigin) return options.publicOrigin.replace(/\/$/, "");
    const host = req.headers.host || `127.0.0.1:${preferredPort}`;
    return `http://${host}`;
  }

  function authMiddleware(req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: "Missing token" });
    }
    try {
      const payload = jwt.verify(token, library.get().secret);
      req.userId = payload.sub;
      req.userEmail = payload.email;
      return next();
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }
  }

  function getUser() {
    return library.get().user;
  }

  function getBoard(boardId) {
    return library.get().boards.find((board) => board.id === boardId) || null;
  }

  app.get("/health", (_req, res) => {
    res.json({ ok: true, mode: "desktop", dataDir });
  });

  app.get("/health/uploads", (_req, res) => {
    res.json({
      ok: true,
      configured: {
        localFiles: true
      }
    });
  });

  app.get("/desktop/info", authMiddleware, (_req, res) => {
    const lib = library.get();
    res.json({
      mode: "desktop",
      dataDir,
      boardCount: lib.boards.length,
      fileCount: lib.files.length,
      createdAt: lib.createdAt,
      updatedAt: lib.updatedAt
    });
  });

  app.post("/auth/desktop", (_req, res) => {
    const user = getUser();
    return res.json({ token: signToken(user), user });
  });

  app.post("/auth/login", (_req, res) => {
    const user = getUser();
    return res.json({ token: signToken(user), user });
  });

  app.post("/auth/register", (_req, res) => {
    const user = getUser();
    return res.json({ token: signToken(user), user });
  });

  app.get("/me", authMiddleware, (_req, res) => {
    const user = getUser();
    return res.json({ id: user.id, email: user.email, createdAt: user.createdAt });
  });

  app.get("/boards", authMiddleware, (_req, res) => {
    const boards = [...library.get().boards]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map((board) => ({
        id: board.id,
        title: board.title,
        updatedAt: board.updatedAt,
        createdAt: board.createdAt,
        accessRole: "owner",
        ownerEmail: null
      }));
    return res.json({ boards });
  });

  app.post("/boards", authMiddleware, async (req, res) => {
    const { title, data } = req.body ?? {};
    const createdAt = nowIso();
    const board = {
      id: createId(),
      ownerId: getUser().id,
      title: typeof title === "string" && title.trim() ? title.trim() : "Untitled Board",
      data: data ?? { hexagons: [], connections: [], viewport: {} },
      createdAt,
      updatedAt: createdAt
    };
    await library.mutate((lib) => {
      lib.boards.unshift(board);
    });
    return res.status(201).json({ board });
  });

  app.get("/boards/:id", authMiddleware, (req, res) => {
    const board = getBoard(req.params.id);
    if (!board) {
      return res.status(404).json({ error: "Board not found" });
    }
    return res.json({
      board: {
        ...board,
        accessRole: "owner",
        ownerEmail: null
      }
    });
  });

  app.put("/boards/:id", authMiddleware, async (req, res) => {
    const { title, data } = req.body ?? {};
    let updated = null;
    await library.mutate((lib) => {
      const board = lib.boards.find((item) => item.id === req.params.id);
      if (!board) return;
      if (typeof title === "string" && title.trim()) board.title = title.trim();
      if (data !== undefined) board.data = data;
      board.updatedAt = nowIso();
      updated = board;
    });
    if (!updated) {
      return res.status(404).json({ error: "Board not found" });
    }
    return res.json({ board: updated });
  });

  app.delete("/boards/:id", authMiddleware, async (req, res) => {
    let removed = false;
    await library.mutate((lib) => {
      const next = lib.boards.filter((board) => board.id !== req.params.id);
      removed = next.length !== lib.boards.length;
      lib.boards = next;
      lib.shares = lib.shares.filter((share) => share.boardId !== req.params.id);
      lib.collaborators = lib.collaborators.filter((item) => item.boardId !== req.params.id);
    });
    if (!removed) {
      return res.status(404).json({ error: "Board not found" });
    }
    return res.json({ ok: true });
  });

  app.post("/uploads", authMiddleware, async (req, res) => {
    const { filename, contentType } = req.body ?? {};
    if (!filename || !contentType) {
      return res.status(400).json({ error: "Filename and contentType are required" });
    }
    const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `${createId()}-${safeName}`;
    await library.mutate((lib) => {
      lib.files.push({
        key,
        filename: String(filename),
        contentType: String(contentType),
        createdAt: nowIso()
      });
    });
    const origin = publicOrigin(req);
    return res.json({
      uploadUrl: `${origin}/uploads/put/${encodeURIComponent(key)}`,
      publicUrl: `${origin}/files/${encodeURIComponent(key)}`,
      key
    });
  });

  app.put("/uploads/put/:key", express.raw({ type: "*/*", limit: "80mb" }), async (req, res) => {
    const key = decodeURIComponent(req.params.key);
    const record = library.get().files.find((item) => item.key === key);
    if (!record) {
      return res.status(404).json({ error: "Upload is not reserved" });
    }
    const dest = library.filePath(key);
    require("fs").writeFileSync(dest, req.body || Buffer.alloc(0));
    return res.json({ ok: true, key });
  });

  app.get("/files/:key", (req, res) => {
    const key = decodeURIComponent(req.params.key);
    const record = library.get().files.find((item) => item.key === key);
    const dest = library.filePath(key);
    if (!require("fs").existsSync(dest)) {
      return res.status(404).json({ error: "File not found" });
    }
    if (record?.contentType) {
      res.setHeader("Content-Type", record.contentType);
    }
    res.setHeader("Content-Disposition", `inline; filename="${record?.filename || key}"`);
    return res.sendFile(dest);
  });

  app.post("/boards/:id/collaborators", authMiddleware, (_req, res) => {
    return res.status(400).json({
      error: "This desktop app keeps boards on this computer. Invite links are only in the hosted web app."
    });
  });

  app.get("/boards/:id/collaborators", authMiddleware, (_req, res) => {
    return res.json({ collaborators: [] });
  });

  app.delete("/boards/:id/collaborators/:collaboratorId", authMiddleware, (_req, res) => {
    return res.json({ ok: true });
  });

  app.post("/boards/:id/shares", authMiddleware, async (req, res) => {
    const { role } = req.body ?? {};
    if (!role || !["view", "comment"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }
    const board = getBoard(req.params.id);
    if (!board) {
      return res.status(404).json({ error: "Board not found" });
    }
    const share = {
      id: createId(),
      boardId: board.id,
      role,
      token: createId(),
      createdAt: nowIso()
    };
    await library.mutate((lib) => {
      lib.shares.unshift(share);
    });
    return res.status(201).json({ share });
  });

  app.get("/boards/:id/shares", authMiddleware, (req, res) => {
    const shares = library.get().shares.filter((share) => share.boardId === req.params.id);
    return res.json({ shares });
  });

  app.delete("/boards/:id/shares/:shareId", authMiddleware, async (req, res) => {
    await library.mutate((lib) => {
      lib.shares = lib.shares.filter((share) => share.id !== req.params.shareId);
    });
    return res.json({ ok: true });
  });

  app.get("/share/:token", (req, res) => {
    const share = library.get().shares.find((item) => item.token === req.params.token);
    if (!share) {
      return res.status(404).json({ error: "Share link not found" });
    }
    const board = getBoard(share.boardId);
    if (!board) {
      return res.status(404).json({ error: "Share link not found" });
    }
    return res.json({
      role: share.role,
      board: {
        id: board.id,
        title: board.title,
        data: board.data,
        updatedAt: board.updatedAt
      }
    });
  });

  app.post("/share/:token/comments", async (req, res) => {
    const { text, x, y, author } = req.body ?? {};
    if (!text || typeof x !== "number" || typeof y !== "number") {
      return res.status(400).json({ error: "Text and coordinates are required" });
    }
    const share = library.get().shares.find((item) => item.token === req.params.token);
    if (!share) {
      return res.status(404).json({ error: "Share link not found" });
    }
    if (share.role !== "comment") {
      return res.status(403).json({ error: "Read-only share link" });
    }
    const comment = {
      id: createId(),
      text: String(text).slice(0, 280),
      x,
      y,
      author: author ? String(author).slice(0, 64) : "Guest",
      createdAt: nowIso()
    };
    let nextData = null;
    await library.mutate((lib) => {
      const board = lib.boards.find((item) => item.id === share.boardId);
      if (!board) return;
      const existing = board.data ?? {};
      const comments = Array.isArray(existing.comments) ? existing.comments : [];
      nextData = { ...existing, comments: [...comments, comment] };
      board.data = nextData;
      board.updatedAt = nowIso();
    });
    if (!nextData) {
      return res.status(404).json({ error: "Share link not found" });
    }
    const payload = JSON.stringify({
      type: "board_update",
      boardId: share.boardId,
      data: nextData,
      sender: `share:${share.token}`
    });
    broadcastToRoom(share.boardId, payload, null);
    return res.status(201).json({ comment, data: nextData });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });
  const rooms = new Map();
  const roomPresence = new Map();

  function addToRoom(boardId, socket) {
    if (!rooms.has(boardId)) rooms.set(boardId, new Set());
    rooms.get(boardId).add(socket);
  }

  function removeFromRoom(boardId, socket) {
    const room = rooms.get(boardId);
    if (!room) return;
    room.delete(socket);
    if (room.size === 0) rooms.delete(boardId);
  }

  function addPresence(boardId, connectionId, label) {
    if (!roomPresence.has(boardId)) roomPresence.set(boardId, new Map());
    roomPresence.get(boardId).set(connectionId, { label });
  }

  function removePresence(boardId, connectionId) {
    const room = roomPresence.get(boardId);
    if (!room) return;
    room.delete(connectionId);
    if (room.size === 0) roomPresence.delete(boardId);
  }

  function broadcastPresenceState(boardId) {
    const room = rooms.get(boardId) || new Set();
    const presence = roomPresence.get(boardId) || new Map();
    const users = Array.from(presence.entries()).map(([id, data]) => ({
      id,
      label: data.label
    }));
    const payload = JSON.stringify({ type: "presence_state", boardId, users });
    room.forEach((client) => {
      if (client.readyState === client.OPEN) client.send(payload);
    });
  }

  function broadcastToRoom(boardId, payload, skipSocket) {
    const room = rooms.get(boardId) || new Set();
    room.forEach((client) => {
      if (client === skipSocket) return;
      if (client.readyState === client.OPEN) client.send(payload);
    });
  }

  wss.on("connection", (socket, req) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const token = url.searchParams.get("token");
      const boardId = url.searchParams.get("boardId");
      if (!token || !boardId) {
        socket.close(1008, "Missing token or boardId");
        return;
      }
      const payload = jwt.verify(token, library.get().secret);
      const board = getBoard(boardId);
      if (!board) {
        socket.close(1008, "Unauthorized");
        return;
      }
      const connectionId = createId();
      addToRoom(boardId, socket);
      addPresence(boardId, connectionId, payload.email || "You");
      broadcastPresenceState(boardId);
      socket.on("message", (data) => {
        let message;
        try {
          message = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (!message) return;
        if (message.type === "board_update") {
          library
            .mutate((lib) => {
              const current = lib.boards.find((item) => item.id === boardId);
              if (!current) return;
              current.data = message.data ?? current.data;
              current.updatedAt = nowIso();
            })
            .catch(() => {});
          const next = JSON.stringify({
            type: "board_update",
            boardId,
            data: message.data,
            sender: message.sender
          });
          broadcastToRoom(boardId, next, socket);
          return;
        }
        if (message.type === "presence") {
          const next = JSON.stringify({
            type: "presence",
            boardId,
            sender: message.sender,
            cursor: message.cursor,
            label: message.label
          });
          broadcastToRoom(boardId, next, socket);
        }
      });
      socket.on("close", () => {
        removeFromRoom(boardId, socket);
        removePresence(boardId, connectionId);
        broadcastPresenceState(boardId);
      });
    } catch {
      socket.close(1011, "Server error");
    }
  });

  function listen(port) {
    return new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        const address = server.address();
        resolve({
          server,
          library,
          reload: () => library.reload(),
          close: () =>
            new Promise((done) => {
              wss.close();
              server.close(() => done());
            }),
          port: address.port,
          origin: `http://127.0.0.1:${address.port}`,
          dataDir
        });
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    });
  }

  async function listenWithFallback() {
    try {
      return await listen(preferredPort);
    } catch (error) {
      if (error && error.code === "EADDRINUSE") {
        return listen(0);
      }
      throw error;
    }
  }

  return listenWithFallback();
}

module.exports = { startServer };
