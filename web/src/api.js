// web/src/api.js

const API_BASE =
  import.meta.env.VITE_API_URL || "http://localhost:3000";

/**
 * Generic request helper
 */
async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }

  return response.json();
}

/* ============================
   API endpoints
   ============================ */

export function getStatus() {
  return request("/status");
}

export function getBoards() {
  return request("/boards");
}

export function saveBoard(board) {
  return request("/boards", {
    method: "POST",
    body: JSON.stringify(board)
  });
}

export function deleteBoard(id) {
  return request(`/boards/${id}`, {
    method: "DELETE"
  });
}
