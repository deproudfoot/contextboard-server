const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const { startServer } = require("../server/server.cjs");
const { createBackup, restoreBackup } = require("./backup.cjs");

if (process.env.CONTEXTBOARD_NO_SANDBOX === "1") {
  app.commandLine.appendSwitch("no-sandbox");
}

let mainWindow = null;
let serverInfo = null;

function libraryDir() {
  if (process.env.CONTEXTBOARD_DATA) {
    return process.env.CONTEXTBOARD_DATA;
  }
  return path.join(app.getPath("userData"), "library");
}

function createMenu() {
  const template = [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" }
            ]
          }
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Backup library…",
          click: () => handleBackup()
        },
        {
          label: "Restore library…",
          click: () => handleRestore()
        },
        {
          label: "Reveal data folder",
          click: () => handleReveal()
        },
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" } : { role: "quit" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      label: "Help",
      submenu: [
        {
          label: "About Contextboard Desktop",
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "Contextboard",
              message: "Contextboard Desktop",
              detail:
                "A native app. Your boards and files stay on this computer.\n\n" +
                `Library folder:\n${libraryDir()}\n\n` +
                "You can back that folder up yourself. Upgrades are optional."
            });
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function handleBackup() {
  const defaultName = `contextboard-backup-${new Date().toISOString().slice(0, 10)}.zip`;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Backup Contextboard library",
    defaultPath: path.join(app.getPath("documents"), defaultName),
    filters: [{ name: "Contextboard backup", extensions: ["zip"] }]
  });
  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }
  try {
    await createBackup(libraryDir(), result.filePath);
    return { ok: true, path: result.filePath };
  } catch (error) {
    return { error: error.message || "Backup failed" };
  }
}

async function handleRestore() {
  const pick = await dialog.showOpenDialog(mainWindow, {
    title: "Restore Contextboard library",
    properties: ["openFile"],
    filters: [{ name: "Contextboard backup", extensions: ["zip"] }]
  });
  if (pick.canceled || !pick.filePaths?.[0]) {
    return { canceled: true };
  }
  const confirm = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: ["Restore", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: "Replace local library?",
    message: "Restore this backup?",
    detail:
      "This replaces the boards and files stored on this computer with the backup. A safety copy of the current library is kept next to it."
  });
  if (confirm.response !== 0) {
    return { canceled: true };
  }
  try {
    await restoreBackup(libraryDir(), pick.filePaths[0]);
    if (serverInfo?.reload) serverInfo.reload();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.reload();
    }
    return { ok: true };
  } catch (error) {
    return { error: error.message || "Restore failed" };
  }
}

async function handleReveal() {
  const dir = libraryDir();
  fs.mkdirSync(dir, { recursive: true });
  const error = await shell.openPath(dir);
  if (error) {
    return { error };
  }
  return { ok: true, path: dir };
}

async function createWindow() {
  if (!serverInfo) {
    serverInfo = await startServer({
      dataDir: libraryDir(),
      port: Number(process.env.CONTEXTBOARD_PORT || 18765)
    });
  }
  process.env.CONTEXTBOARD_API_BASE = serverInfo.origin;
  process.env.CONTEXTBOARD_DATA_DIR = serverInfo.dataDir;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 880,
    minHeight: 640,
    title: "Contextboard",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function registerIpc() {
  ipcMain.handle("desktop:apiBase", () => serverInfo?.origin || "");
  ipcMain.handle("desktop:dataPath", () => libraryDir());
  ipcMain.handle("desktop:backup", () => handleBackup());
  ipcMain.handle("desktop:restore", () => handleRestore());
  ipcMain.handle("desktop:revealData", () => handleReveal());
}

app.whenReady().then(async () => {
  registerIpc();
  createMenu();
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (serverInfo?.close) {
    serverInfo.close();
  }
});

// Keep a named export for tests that import this file's helpers indirectly.
module.exports = { libraryDir, handleBackup, handleRestore, handleReveal };
