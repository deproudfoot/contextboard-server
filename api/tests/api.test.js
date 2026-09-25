import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://ubuntu:devpass@localhost:5432/contextboard";
process.env.INVITE_ALLOWLIST = "test@example.com,apitest@example.com";

const { app, server, prisma } = await import("../src/app.js");

const agent = request(app);

describe("API", () => {
  let token;
  let boardId;
  const testEmail = "apitest@example.com";
  const testPassword = "TestPass123!";

  after(async () => {
    await prisma.boardShare.deleteMany({});
    await prisma.boardCollaborator.deleteMany({});
    await prisma.board.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.$disconnect();
    server.close();
  });

  describe("Health", () => {
    it("GET /health returns ok", async () => {
      const res = await agent.get("/health");
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { ok: true });
    });
  });

  describe("Auth", () => {
    it("POST /auth/register creates a user and returns token", async () => {
      const res = await agent
        .post("/auth/register")
        .send({ email: testEmail, password: testPassword });
      assert.equal(res.status, 200);
      assert.ok(res.body.token);
      token = res.body.token;
    });

    it("POST /auth/register rejects duplicate email", async () => {
      const res = await agent
        .post("/auth/register")
        .send({ email: testEmail, password: testPassword });
      assert.equal(res.status, 409);
    });

    it("POST /auth/register rejects non-invited email", async () => {
      const res = await agent
        .post("/auth/register")
        .send({ email: "nobody@random.com", password: "abc123" });
      assert.equal(res.status, 403);
    });

    it("POST /auth/login returns token for valid credentials", async () => {
      const res = await agent
        .post("/auth/login")
        .send({ email: testEmail, password: testPassword });
      assert.equal(res.status, 200);
      assert.ok(res.body.token);
    });

    it("POST /auth/login rejects wrong password", async () => {
      const res = await agent
        .post("/auth/login")
        .send({ email: testEmail, password: "wrong" });
      assert.equal(res.status, 401);
    });

    it("GET /me returns current user", async () => {
      const res = await agent
        .get("/me")
        .set("Authorization", `Bearer ${token}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.email, testEmail);
      assert.ok(res.body.id);
    });

    it("GET /me rejects missing token", async () => {
      const res = await agent.get("/me");
      assert.equal(res.status, 401);
    });
  });

  describe("Boards", () => {
    it("POST /boards creates a board", async () => {
      const res = await agent
        .post("/boards")
        .set("Authorization", `Bearer ${token}`)
        .send({ title: "Test Board", data: { hexagons: [] } });
      assert.equal(res.status, 201);
      assert.equal(res.body.board.title, "Test Board");
      boardId = res.body.board.id;
    });

    it("GET /boards lists boards", async () => {
      const res = await agent
        .get("/boards")
        .set("Authorization", `Bearer ${token}`);
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.boards));
      assert.ok(res.body.boards.length >= 1);
    });

    it("GET /boards/:id returns a board", async () => {
      const res = await agent
        .get(`/boards/${boardId}`)
        .set("Authorization", `Bearer ${token}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.board.title, "Test Board");
      assert.equal(res.body.board.accessRole, "owner");
    });

    it("PUT /boards/:id updates a board", async () => {
      const res = await agent
        .put(`/boards/${boardId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ title: "Updated Title", data: { hexagons: [{ id: "h1" }] } });
      assert.equal(res.status, 200);
      assert.equal(res.body.board.title, "Updated Title");
    });

    it("GET /boards/:id returns 404 for non-existent board", async () => {
      const res = await agent
        .get("/boards/nonexistent-id")
        .set("Authorization", `Bearer ${token}`);
      assert.equal(res.status, 404);
    });

    it("DELETE /boards/:id deletes a board", async () => {
      const createRes = await agent
        .post("/boards")
        .set("Authorization", `Bearer ${token}`)
        .send({ title: "To Delete" });
      const id = createRes.body.board.id;

      const res = await agent
        .delete(`/boards/${id}`)
        .set("Authorization", `Bearer ${token}`);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { ok: true });
    });
  });

  describe("Shares", () => {
    it("POST /boards/:id/shares creates a share link", async () => {
      const res = await agent
        .post(`/boards/${boardId}/shares`)
        .set("Authorization", `Bearer ${token}`)
        .send({ role: "view" });
      assert.equal(res.status, 201);
      assert.ok(res.body.share.token);
      assert.equal(res.body.share.role, "view");
    });

    it("GET /boards/:id/shares lists share links", async () => {
      const res = await agent
        .get(`/boards/${boardId}/shares`)
        .set("Authorization", `Bearer ${token}`);
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.shares));
      assert.ok(res.body.shares.length >= 1);
    });

    it("GET /share/:token returns board data", async () => {
      const sharesRes = await agent
        .get(`/boards/${boardId}/shares`)
        .set("Authorization", `Bearer ${token}`);
      const shareToken = sharesRes.body.shares[0].token;

      const res = await agent.get(`/share/${shareToken}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.board.title, "Updated Title");
    });
  });
});
