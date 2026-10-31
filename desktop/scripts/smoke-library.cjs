const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { startServer } = require("../server/server.cjs");
const { createBackup, restoreBackup } = require("../electron/backup.cjs");

async function request(origin, pathname, options = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!response.ok) {
    throw new Error(`${pathname} ${response.status}: ${data.error || text}`);
  }
  return { status: response.status, data };
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "contextboard-smoke-"));
  const info = await startServer({ dataDir, port: 0 });
  try {
    const health = await request(info.origin, "/health");
    assert.equal(health.data.ok, true);
    assert.equal(health.data.mode, "desktop");

    const session = await request(info.origin, "/auth/desktop", { method: "POST" });
    const token = session.data.token;
    assert.ok(token);
    const auth = { Authorization: `Bearer ${token}` };

    const me = await request(info.origin, "/me", { headers: auth });
    assert.equal(me.data.id, "local-owner");

    const created = await request(info.origin, "/boards", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        title: "Smoke Board",
        data: { hexagons: [{ id: "h1", text: "Hello" }], connections: [] }
      })
    });
    assert.equal(created.status, 201);
    const boardId = created.data.board.id;

    const listed = await request(info.origin, "/boards", { headers: auth });
    assert.equal(listed.data.boards.length, 1);
    assert.equal(listed.data.boards[0].title, "Smoke Board");

    await request(info.origin, `/boards/${boardId}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        title: "Smoke Board",
        data: { hexagons: [{ id: "h1", text: "Saved locally" }], connections: [] }
      })
    });

    const upload = await request(info.origin, "/uploads", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ filename: "note.txt", contentType: "text/plain" })
    });
    const put = await fetch(upload.data.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: "owned by this computer"
    });
    assert.equal(put.ok, true);
    const file = await fetch(upload.data.publicUrl);
    assert.equal(await file.text(), "owned by this computer");

    const backupZip = path.join(os.tmpdir(), `contextboard-smoke-${Date.now()}.zip`);
    await createBackup(dataDir, backupZip);
    assert.equal(fs.existsSync(backupZip), true);

    await request(info.origin, `/boards/${boardId}`, { method: "DELETE", headers: auth });
    const empty = await request(info.origin, "/boards", { headers: auth });
    assert.equal(empty.data.boards.length, 0);

    await restoreBackup(dataDir, backupZip);
    info.reload();
    const restored = await request(info.origin, "/boards", { headers: auth });
    assert.equal(restored.data.boards[0].title, "Smoke Board");
    const restoredBoard = await request(info.origin, `/boards/${boardId}`, { headers: auth });
    assert.equal(restoredBoard.data.board.data.hexagons[0].text, "Saved locally");

    console.log("desktop smoke: ok");
    console.log(`library: ${dataDir}`);
    console.log(`backup: ${backupZip}`);
  } finally {
    await info.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
