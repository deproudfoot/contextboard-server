import { useEffect, useMemo, useState } from "react";
import {
  login,
  register,
  me,
  setToken,
  getToken,
  listBoards,
  createBoard,
  getBoard,
  updateBoard
} from "./api";

function Field({ label, ...props }) {
  return (
    <label className="field">
      <div className="field-label">{label}</div>
      <input {...props} />
    </label>
  );
}

function Button({ children, ...props }) {
  return (
    <button {...props} className="button">
      {children}
    </button>
  );
}

export default function App() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [token, setTokenState] = useState(() => getToken());
  const [user, setUser] = useState(null);
  const [boards, setBoards] = useState([]);
  const [activeBoardId, setActiveBoardId] = useState(null);
  const [activeBoard, setActiveBoard] = useState(null);
  const [boardTitle, setBoardTitle] = useState("");
  const [boardJson, setBoardJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const title = useMemo(() => (mode === "login" ? "Sign in" : "Request access"), [mode]);

  useEffect(() => {
    if (!token) {
      setUser(null);
      return;
    }
    let canceled = false;
    (async () => {
      try {
        const u = await me();
        if (!canceled) setUser(u);
      } catch {
        setToken(null);
        setTokenState(null);
        if (!canceled) setUser(null);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!user) return;
    listBoards()
      .then((response) => setBoards(response.boards || []))
      .catch((e) => setErr(e.message));
  }, [user]);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const fn = mode === "login" ? login : register;
      const { token: t } = await fn(email.trim(), password);
      setToken(t);
      setTokenState(t);
      const u = await me();
      setUser(u);
    } catch (e2) {
      setErr(e2?.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    setToken(null);
    setTokenState(null);
    setUser(null);
    setBoards([]);
    setActiveBoardId(null);
    setActiveBoard(null);
    setEmail("");
    setPassword("");
    setErr("");
  }

  async function handleCreateBoard() {
    setErr("");
    try {
      const payload = { title: "Untitled Board", data: { hexagons: [], connections: [], viewport: {} } };
      const response = await createBoard(payload);
      const nextBoard = response.board;
      setBoards((prev) => [nextBoard, ...prev]);
      openBoard(nextBoard.id);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function openBoard(id) {
    setErr("");
    setActiveBoardId(id);
    try {
      const response = await getBoard(id);
      const board = response.board;
      setActiveBoard(board);
      setBoardTitle(board.title || "");
      setBoardJson(JSON.stringify(board.data ?? {}, null, 2));
    } catch (e) {
      setErr(e.message);
    }
  }

  async function handleSaveBoard() {
    if (!activeBoardId) return;
    setErr("");
    try {
      const parsed = boardJson ? JSON.parse(boardJson) : {};
      const response = await updateBoard(activeBoardId, {
        title: boardTitle.trim() || "Untitled Board",
        data: parsed
      });
      setActiveBoard(response.board);
      setBoards((prev) =>
        prev.map((item) => (item.id === response.board.id ? response.board : item))
      );
    } catch (e) {
      setErr(e.message || "Failed to save board");
    }
  }

  if (user && activeBoardId) {
    return (
      <div className="page">
        <div className="toolbar">
          <Button onClick={() => setActiveBoardId(null)}>Back to boards</Button>
          <div className="spacer" />
          <Button onClick={logout}>Log out</Button>
        </div>
        <h2>Board</h2>
        <Field
          label="Title"
          value={boardTitle}
          onChange={(e) => setBoardTitle(e.target.value)}
        />
        <label className="field">
          <div className="field-label">Board JSON</div>
          <textarea
            rows={16}
            value={boardJson}
            onChange={(e) => setBoardJson(e.target.value)}
          />
        </label>
        {err ? <div className="error">{err}</div> : null}
        <Button onClick={handleSaveBoard}>Save</Button>
      </div>
    );
  }

  if (user) {
    return (
      <div className="page">
        <div className="toolbar">
          <h2>My Boards</h2>
          <div className="spacer" />
          <Button onClick={logout}>Log out</Button>
        </div>
        <div className="card">
          <div className="muted">Signed in as</div>
          <div className="email">{user.email}</div>
        </div>
        <div className="toolbar">
          <Button onClick={handleCreateBoard}>Create new board</Button>
        </div>
        {err ? <div className="error">{err}</div> : null}
        <div className="list">
          {boards.map((board) => (
            <button key={board.id} className="list-item" onClick={() => openBoard(board.id)}>
              <div className="list-title">{board.title}</div>
              <div className="muted">
                Updated {board.updatedAt ? new Date(board.updatedAt).toLocaleString() : "—"}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="card">
        <h2>{title}</h2>
        <div className="muted">
          {mode === "register"
            ? "Invite-only: your email must be on the allowlist."
            : "Sign in to access your private boards."}
        </div>

        <form onSubmit={handleSubmit}>
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            required
          />
          <Field
            label="Password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            required
          />

          {err ? <div className="error">{err}</div> : null}

          <div className="toolbar">
            <Button type="submit" disabled={busy}>
              {busy ? "Working…" : mode === "login" ? "Sign in" : "Register"}
            </Button>
            <button
              type="button"
              onClick={() => {
                setErr("");
                setMode(mode === "login" ? "register" : "login");
              }}
              className="link-button"
              disabled={busy}
            >
              {mode === "login" ? "Need an invite?" : "Already invited? Sign in"}
            </button>
          </div>
        </form>

        <div className="muted small">
          Tip: if you see “Not invited”, add your email to the API env var{" "}
          <code>INVITE_ALLOWLIST</code> and redeploy.
        </div>
      </div>
    </div>
  );
}
