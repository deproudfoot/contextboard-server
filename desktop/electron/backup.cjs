const fs = require("fs");
const path = require("path");
const os = require("os");
const { createWriteStream } = require("fs");

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

async function createBackup(dataDir, destZip) {
  if (!fs.existsSync(path.join(dataDir, "library.json"))) {
    throw new Error("No library found on this computer yet.");
  }
  const archiver = require("archiver");
  fs.mkdirSync(path.dirname(destZip), { recursive: true });
  const output = createWriteStream(destZip);
  const archive = archiver("zip", { zlib: { level: 9 } });
  const done = new Promise((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
  });
  archive.pipe(output);
  archive.file(path.join(dataDir, "library.json"), { name: "library.json" });
  const filesDir = path.join(dataDir, "files");
  if (fs.existsSync(filesDir)) {
    archive.directory(filesDir, "files");
  }
  await archive.finalize();
  await done;
}

async function restoreBackup(dataDir, zipPath) {
  if (!fs.existsSync(zipPath)) {
    throw new Error("Backup file was not found.");
  }
  const extract = require("extract-zip");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "contextboard-restore-"));
  await extract(zipPath, { dir: tmp });
  const libraryPath = path.join(tmp, "library.json");
  if (!fs.existsSync(libraryPath)) {
    throw new Error("That zip is not a Contextboard library backup.");
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safety = path.join(path.dirname(dataDir), `library-before-restore-${stamp}`);
  if (fs.existsSync(path.join(dataDir, "library.json"))) {
    copyDir(dataDir, safety);
  }
  for (const name of fs.readdirSync(dataDir)) {
    fs.rmSync(path.join(dataDir, name), { recursive: true, force: true });
  }
  copyDir(tmp, dataDir);
  fs.rmSync(tmp, { recursive: true, force: true });
}

module.exports = { createBackup, restoreBackup, copyDir };
