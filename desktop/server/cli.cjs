const os = require("os");
const path = require("path");
const { startServer } = require("./server.cjs");

const dataDir =
  process.env.CONTEXTBOARD_DATA || path.join(os.homedir(), ".contextboard", "library");

startServer({
  dataDir,
  port: Number(process.env.CONTEXTBOARD_PORT || 18765)
}).then((info) => {
  console.log(`Contextboard local library: ${info.dataDir}`);
  console.log(`API listening on ${info.origin}`);
});
