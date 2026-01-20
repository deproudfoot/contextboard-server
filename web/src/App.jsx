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
  const hexRadius = 36;
  const snapSize = 20;
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [token, setTokenState] = useState(() => getToken());
  const [user, setUser] = useState(null);
  const [boards, setBoards] = useState([]);
  const [activeBoardId, setActiveBoardId] = useState(null);
  const [activeBoard, setActiveBoard] = useState(null);
  const [boardTitle, setBoardTitle] = useState("");
  const [boardData, setBoardData] = useState({ hexagons: [] });
  const [selectedId, setSelectedId] = useState(null);
  const [dragState, setDragState] = useState(null);
  const [connectMode, setConnectMode] = useState(false);
  const [connectFromId, setConnectFromId] = useState(null);
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
      const data = board.data ?? { hexagons: [] };
      setBoardData(data);
      setSelectedId(null);
      setConnectMode(false);
      setConnectFromId(null);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function handleSaveBoard() {
    if (!activeBoardId) return;
    setErr("");
    try {
      const response = await updateBoard(activeBoardId, {
        title: boardTitle.trim() || "Untitled Board",
        data: boardData
      });
      setActiveBoard(response.board);
      setBoards((prev) =>
        prev.map((item) => (item.id === response.board.id ? response.board : item))
      );
    } catch (e) {
      setErr(e.message || "Failed to save board");
    }
  }

  function handleCanvasPointerMove(event) {
    if (!dragState) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const rawX = event.clientX - rect.left;
    const rawY = event.clientY - rect.top;
    const x = Math.round(rawX / snapSize) * snapSize;
    const y = Math.round(rawY / snapSize) * snapSize;
    setBoardData((prev) => ({
      ...prev,
      hexagons: (prev.hexagons || []).map((hex) =>
        hex.id === dragState.id ? { ...hex, x, y } : hex
      )
    }));
  }

  function handleCanvasPointerUp() {
    setDragState(null);
  }

  function handleAddHexagon() {
    const next = {
      id: crypto.randomUUID(),
      x: 120 + (boardData.hexagons?.length || 0) * 40,
      y: 120 + (boardData.hexagons?.length || 0) * 30,
      text: "New",
      fillColor: "#cbd5f5",
      connections: [],
      content: null
    };
    setBoardData((prev) => ({
      ...prev,
      hexagons: [...(prev.hexagons || []), next]
    }));
    setSelectedId(next.id);
  }

  function handleLabelChange(value) {
    setBoardData((prev) => ({
      ...prev,
      hexagons: (prev.hexagons || []).map((hex) =>
        hex.id === selectedId ? { ...hex, text: value } : hex
      )
    }));
  }

  function handleColorChange(value) {
    setBoardData((prev) => ({
      ...prev,
      hexagons: (prev.hexagons || []).map((hex) =>
        hex.id === selectedId ? { ...hex, fillColor: value } : hex
      )
    }));
  }

  function handleMediaChange(file) {
    if (!file || !selectedId) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (!dataUrl || typeof dataUrl !== "string") return;
      const type = file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("video/")
        ? "video"
        : file.type.startsWith("audio/")
        ? "audio"
        : file.type === "application/pdf"
        ? "pdf"
        : "file";
      const payload = { type, dataUrl, name: file.name };
      setBoardData((prev) => ({
        ...prev,
        hexagons: (prev.hexagons || []).map((hex) =>
          hex.id === selectedId ? { ...hex, content: payload } : hex
        )
      }));
    };
    reader.readAsDataURL(file);
  }

  function handleHexPointerDown(hexId) {
    if (connectMode) {
      if (!connectFromId) {
        setConnectFromId(hexId);
        setSelectedId(hexId);
        return;
      }
      if (connectFromId === hexId) {
        setConnectFromId(null);
        return;
      }
      setBoardData((prev) => ({
        ...prev,
        hexagons: (prev.hexagons || []).map((hex) => {
          if (hex.id === connectFromId && !hex.connections.includes(hexId)) {
            return { ...hex, connections: [...hex.connections, hexId] };
          }
          if (hex.id === hexId && !hex.connections.includes(connectFromId)) {
            return { ...hex, connections: [...hex.connections, connectFromId] };
          }
          return hex;
        })
      }));
      setConnectFromId(null);
      setSelectedId(hexId);
      return;
    }
    setSelectedId(hexId);
    setDragState({ id: hexId });
  }

  function getHexPoints(radius) {
    const points = [];
    for (let i = 0; i < 6; i += 1) {
      const angle = ((60 * i - 30) * Math.PI) / 180;
      points.push([radius * Math.cos(angle), radius * Math.sin(angle)].join(","));
    }
    return points.join(" ");
  }

  function buildConnections(hexagons) {
    const seen = new Set();
    const lines = [];
    hexagons.forEach((hex) => {
      (hex.connections || []).forEach((targetId) => {
        const key = [hex.id, targetId].sort().join("-");
        if (seen.has(key)) return;
        const target = hexagons.find((other) => other.id === targetId);
        if (!target) return;
        seen.add(key);
        lines.push({ from: hex, to: target, key });
      });
    });
    return lines;
  }

  if (user && activeBoardId) {
    const selected = (boardData.hexagons || []).find((hex) => hex.id === selectedId);
    const connections = buildConnections(boardData.hexagons || []);
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
        <div className="toolbar">
          <Button onClick={handleAddHexagon}>Add hexagon</Button>
          <Button
            onClick={() => {
              setConnectMode((prev) => !prev);
              setConnectFromId(null);
            }}
          >
            {connectMode ? "Exit connect" : "Connect"}
          </Button>
          {selected ? (
            <>
              <label className="field inline-field">
                <div className="field-label">Label</div>
                <input
                  value={selected.text || ""}
                  onChange={(e) => handleLabelChange(e.target.value)}
                />
              </label>
              <label className="field inline-field">
                <div className="field-label">Color</div>
                <input
                  type="color"
                  value={selected.fillColor || "#cbd5f5"}
                  onChange={(e) => handleColorChange(e.target.value)}
                />
              </label>
              <label className="field inline-field">
                <div className="field-label">Media</div>
                <input
                  type="file"
                  onChange={(e) => handleMediaChange(e.target.files?.[0])}
                />
              </label>
            </>
          ) : (
            <div className="muted">Select a hexagon to edit its label, color, or media.</div>
          )}
        </div>
        <svg
          className="canvas"
          width="900"
          height="500"
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
        >
          <rect width="100%" height="100%" rx="16" fill="#f1f5f9" />
          {connections.map((line) => (
            <line
              key={line.key}
              x1={line.from.x || 0}
              y1={line.from.y || 0}
              x2={line.to.x || 0}
              y2={line.to.y || 0}
              stroke="#475569"
              strokeWidth="2"
            />
          ))}
          {(boardData.hexagons || []).map((hex) => (
            <g
              key={hex.id}
              transform={`translate(${hex.x || 0} ${hex.y || 0})`}
              onPointerDown={() => handleHexPointerDown(hex.id)}
            >
              <polygon
                points={getHexPoints(hexRadius)}
                fill={hex.fillColor || "#cbd5f5"}
                stroke={hex.id === selectedId ? "#0f172a" : "#94a3b8"}
                strokeWidth={hex.id === selectedId ? 2 : 1}
              />
              {hex.content?.type === "image" ? (
                <image
                  href={hex.content.dataUrl}
                  x={-24}
                  y={-24}
                  width="48"
                  height="48"
                  preserveAspectRatio="xMidYMid slice"
                />
              ) : null}
              <text
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="12"
                fill="#0f172a"
              >
                {hex.content?.type && hex.content?.type !== "image"
                  ? hex.content.type.toUpperCase()
                  : hex.text || "Hex"}
              </text>
            </g>
          ))}
        </svg>
        <details className="raw-json">
          <summary>Raw JSON</summary>
          <pre>{JSON.stringify(boardData, null, 2)}</pre>
        </details>
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
