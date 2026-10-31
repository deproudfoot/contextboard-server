const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const LIBRARY_VERSION = 1;

function nowIso() {
  return new Date().toISOString();
}

function emptyLibrary() {
  const createdAt = nowIso();
  return {
    version: LIBRARY_VERSION,
    secret: crypto.randomBytes(32).toString("hex"),
    user: {
      id: "local-owner",
      email: "you@this-computer",
      createdAt
    },
    boards: [],
    shares: [],
    collaborators: [],
    files: [],
    createdAt,
    updatedAt: createdAt
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

class FileLibrary {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.libraryPath = path.join(dataDir, "library.json");
    this.filesDir = path.join(dataDir, "files");
    this.library = null;
    this.writeQueue = Promise.resolve();
  }

  load() {
    ensureDir(this.dataDir);
    ensureDir(this.filesDir);
    if (!fs.existsSync(this.libraryPath)) {
      this.library = emptyLibrary();
      this.writeSync();
      return this.library;
    }
    const raw = fs.readFileSync(this.libraryPath, "utf8");
    const parsed = JSON.parse(raw);
    this.library = this.migrate(parsed);
    if (!this.library.secret) {
      this.library.secret = crypto.randomBytes(32).toString("hex");
      this.writeSync();
    }
    return this.library;
  }

  reload() {
    this.library = null;
    return this.load();
  }

  migrate(library) {
    const next = {
      ...emptyLibrary(),
      ...library,
      version: LIBRARY_VERSION,
      boards: Array.isArray(library.boards) ? library.boards : [],
      shares: Array.isArray(library.shares) ? library.shares : [],
      collaborators: Array.isArray(library.collaborators) ? library.collaborators : [],
      files: Array.isArray(library.files) ? library.files : []
    };
    if (!next.user || !next.user.id) {
      next.user = emptyLibrary().user;
    }
    return next;
  }

  get() {
    if (!this.library) this.load();
    return this.library;
  }

  writeSync() {
    const tmp = `${this.libraryPath}.tmp`;
    this.library.updatedAt = nowIso();
    fs.writeFileSync(tmp, JSON.stringify(this.library, null, 2));
    fs.renameSync(tmp, this.libraryPath);
  }

  mutate(fn) {
    this.writeQueue = this.writeQueue.then(() => {
      const library = this.get();
      const result = fn(library);
      this.writeSync();
      return result;
    });
    return this.writeQueue;
  }

  filePath(relativeName) {
    const safe = String(relativeName).replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.join(this.filesDir, safe);
  }
}

module.exports = {
  FileLibrary,
  LIBRARY_VERSION,
  nowIso
};
