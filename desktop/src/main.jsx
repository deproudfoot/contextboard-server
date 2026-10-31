import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

async function boot() {
  if (window.contextboardDesktop?.getApiBase) {
    try {
      const apiBase = await window.contextboardDesktop.getApiBase();
      if (apiBase) window.contextboardDesktop.apiBase = apiBase;
      const dataPath = await window.contextboardDesktop.getDataPath();
      if (dataPath) window.contextboardDesktop.dataPath = dataPath;
    } catch {
      // Fall back to the default local port.
    }
  }

  createRoot(document.getElementById("root")).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

boot();
