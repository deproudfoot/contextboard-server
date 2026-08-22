import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);

function collectShellUrls() {
  const urls = new Set(["/", "/index.html", "/manifest.webmanifest", "/vite.svg", "/sw.js"]);
  document.querySelectorAll("script[src], link[rel='stylesheet']").forEach((el) => {
    const href = el.src || el.href;
    if (href && href.startsWith(window.location.origin)) {
      urls.add(href);
    }
  });
  return Array.from(urls);
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!window.isSecureContext) return;
  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const worker = registration.active || navigator.serviceWorker.controller;
    worker?.postMessage({ type: "PRECACHE", urls: collectShellUrls() });
  } catch (error) {
    console.warn("Contextboard service worker registration failed:", error);
  }
}

window.addEventListener("load", () => {
  registerServiceWorker();
});
