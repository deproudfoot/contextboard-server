export function isDesktop() {
  return (
    import.meta.env.VITE_DESKTOP === "1" ||
    Boolean(typeof window !== "undefined" && window.contextboardDesktop?.isDesktop)
  );
}

export function getDesktopApi() {
  if (typeof window === "undefined") return null;
  return window.contextboardDesktop || null;
}

export async function desktopBackup() {
  const api = getDesktopApi();
  if (!api?.backup) {
    throw new Error("Backup is only available in the installed app.");
  }
  return api.backup();
}

export async function desktopRestore() {
  const api = getDesktopApi();
  if (!api?.restore) {
    throw new Error("Restore is only available in the installed app.");
  }
  return api.restore();
}

export async function desktopReveal() {
  const api = getDesktopApi();
  if (!api?.revealData) {
    throw new Error("Reveal folder is only available in the installed app.");
  }
  return api.revealData();
}

export async function desktopDataPath() {
  const api = getDesktopApi();
  if (api?.getDataPath) {
    return api.getDataPath();
  }
  return api?.dataPath || "";
}
