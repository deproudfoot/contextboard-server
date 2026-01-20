const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_URL ||
  "http://localhost:3000";

/**
 * Generic request helper
 */
async function request(path, options = {}) {
  const token = getToken();
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    },
    ...options
  });

  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
  }
  if (!response.ok) {
    const message = data.error || text || response.statusText;
    throw new Error(message);
  }
  return data;
}

const TOKEN_KEY = "contextboard_token";

export function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function register(email, password) {
  return request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export function login(email, password) {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export function me() {
  return request("/me");
}

export function listBoards() {
  return request("/boards");
}

export function createBoard(payload) {
  return request("/boards", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getBoard(id) {
  return request(`/boards/${id}`);
}

export function updateBoard(id, payload) {
  return request(`/boards/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deleteBoard(id) {
  return request(`/boards/${id}`, {
    method: "DELETE"
  });
}
