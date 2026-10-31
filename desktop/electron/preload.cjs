const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("contextboardDesktop", {
  isDesktop: true,
  apiBase: process.env.CONTEXTBOARD_API_BASE || "",
  dataPath: process.env.CONTEXTBOARD_DATA_DIR || "",
  getApiBase: () => ipcRenderer.invoke("desktop:apiBase"),
  getDataPath: () => ipcRenderer.invoke("desktop:dataPath"),
  backup: () => ipcRenderer.invoke("desktop:backup"),
  restore: () => ipcRenderer.invoke("desktop:restore"),
  revealData: () => ipcRenderer.invoke("desktop:revealData")
});
