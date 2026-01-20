import { useEffect, useMemo, useRef, useState } from "react";
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
  const zoomStep = 0.1;
  const autoConnectThreshold = hexRadius * 0.95;
  const breakSpeedThreshold = 1.5;
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
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [dragState, setDragState] = useState(null);
  const [marqueeStart, setMarqueeStart] = useState(null);
  const [marqueeRect, setMarqueeRect] = useState(null);
  const [showNumbers, setShowNumbers] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panMode, setPanMode] = useState(false);
  const [panState, setPanState] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const historyRef = useRef([]);
  const redoRef = useRef([]);

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

  useEffect(() => {
    function handleKey(event) {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    }
    function handleClick() {
      setContextMenu(null);
    }
    window.addEventListener("keydown", handleKey);
    window.addEventListener("click", handleClick);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("click", handleClick);
    };
  }, []);

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
      setSelectedIds(new Set());
      setZoom(1);
      setPan({ x: 0, y: 0 });
      historyRef.current = [];
      redoRef.current = [];
    } catch (e) {
      setErr(e.message);
    }
  }

  function pushHistory(nextData) {
    historyRef.current = [...historyRef.current, JSON.stringify(boardData)].slice(-20);
    redoRef.current = [];
    setBoardData(nextData);
  }

  function undo() {
    const prev = historyRef.current.pop();
    if (!prev) return;
    redoRef.current = [...redoRef.current, JSON.stringify(boardData)].slice(-20);
    setBoardData(JSON.parse(prev));
  }

  function redo() {
    const next = redoRef.current.pop();
    if (!next) return;
    historyRef.current = [...historyRef.current, JSON.stringify(boardData)].slice(-20);
    setBoardData(JSON.parse(next));
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
    const rawX = (event.clientX - rect.left - pan.x) / zoom;
    const rawY = (event.clientY - rect.top - pan.y) / zoom;
    const x = Math.round(rawX / snapSize) * snapSize;
    const y = Math.round(rawY / snapSize) * snapSize;
    const dx = x - dragState.startX;
    const dy = y - dragState.startY;
    const now = event.timeStamp || Date.now();
    const deltaTime = Math.max(1, now - dragState.lastTime);
    const speed = Math.hypot(x - dragState.lastX, y - dragState.lastY) / deltaTime;
    setBoardData((prev) => ({
      ...prev,
      hexagons: (prev.hexagons || []).map((hex) =>
        dragState.startPositions[hex.id]
          ? {
              ...hex,
              x: dragState.startPositions[hex.id].x + dx,
              y: dragState.startPositions[hex.id].y + dy
            }
          : hex
      )
    }));
    setDragState((prev) =>
      prev
        ? {
            ...prev,
            lastX: x,
            lastY: y,
            lastTime: now,
            breakConnections: prev.breakConnections || speed > breakSpeedThreshold
          }
        : prev
    );
  }

  function handleCanvasPointerUp() {
    if (dragState) {
      const movedIds = Object.keys(dragState.startPositions);
      const shouldBreak = (hex, allHexes) => {
        if (!dragState.breakConnections) return false;
        return (hex.connections || []).some((id) => {
          const target = allHexes.find((item) => item.id === id);
          if (!target) return false;
          const distance = Math.hypot((hex.x || 0) - (target.x || 0), (hex.y || 0) - (target.y || 0));
          return distance > hexRadius;
        });
      };
      const brokenIds = new Set(
        (boardData.hexagons || [])
          .filter((hex) => movedIds.includes(hex.id) && shouldBreak(hex, boardData.hexagons || []))
          .map((hex) => hex.id)
      );
      let updatedHexes = (boardData.hexagons || []).map((hex) => {
        if (!movedIds.includes(hex.id)) return hex;
        let connections = hex.connections || [];
        if (brokenIds.has(hex.id)) {
          connections = [];
        }
        return { ...hex, connections };
      });
      if (dragState.breakConnections && brokenIds.size > 0) {
        updatedHexes = updatedHexes.map((hex) => ({
          ...hex,
          connections: (hex.connections || []).filter((id) => !brokenIds.has(id))
        }));
      }
      const autoConnected = updatedHexes.map((hex) => {
        if (!movedIds.includes(hex.id)) return hex;
        let connections = new Set(hex.connections || []);
        updatedHexes.forEach((other) => {
          if (hex.id === other.id) return;
          const distance = Math.hypot((hex.x || 0) - (other.x || 0), (hex.y || 0) - (other.y || 0));
          if (distance <= autoConnectThreshold) {
            connections.add(other.id);
          }
        });
        return { ...hex, connections: Array.from(connections) };
      });
      const map = new Map(
        autoConnected.map((hex) => [hex.id, { ...hex, connections: new Set(hex.connections || []) }])
      );
      map.forEach((hex) => {
        hex.connections.forEach((id) => {
          const target = map.get(id);
          if (target) {
            target.connections.add(hex.id);
          }
        });
      });
      const bidirectional = Array.from(map.values()).map((hex) => ({
        ...hex,
        connections: Array.from(hex.connections)
      }));
      pushHistory({ ...boardData, hexagons: bidirectional });
    }
    if (panState) {
      setPanState(null);
    }
    setDragState(null);
    setMarqueeStart(null);
    setMarqueeRect(null);
  }

  function handleAddHexagon() {
    const maxNumber = Math.max(0, ...(boardData.hexagons || []).map((hex) => hex.number || 0));
    const next = {
      id: crypto.randomUUID(),
      number: maxNumber + 1,
      x: 120 + (boardData.hexagons?.length || 0) * 40,
      y: 120 + (boardData.hexagons?.length || 0) * 30,
      text: "New",
      fillColor: "#cbd5f5",
      connections: [],
      content: null
    };
    pushHistory({
      ...boardData,
      hexagons: [...(boardData.hexagons || []), next]
    });
    setSelectedIds(new Set([next.id]));
  }

  function handleLabelChange(value) {
    pushHistory({
      ...boardData,
      hexagons: (boardData.hexagons || []).map((hex) =>
        selectedIds.has(hex.id) ? { ...hex, text: value } : hex
      )
    });
  }

  function handleColorChange(value) {
    pushHistory({
      ...boardData,
      hexagons: (boardData.hexagons || []).map((hex) =>
        selectedIds.has(hex.id) ? { ...hex, fillColor: value } : hex
      )
    });
  }

  function handleMediaChange(file) {
    if (!file || selectedIds.size === 0) return;
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
      pushHistory({
        ...boardData,
        hexagons: (boardData.hexagons || []).map((hex) =>
          selectedIds.has(hex.id) ? { ...hex, content: payload } : hex
        )
      });
    };
    reader.readAsDataURL(file);
  }

  function handleHexPointerDown(event, hexId) {
    const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    const localX = rect ? (event.clientX - rect.left - pan.x) / zoom : event.clientX;
    const localY = rect ? (event.clientY - rect.top - pan.y) / zoom : event.clientY;
    const isToggle = event.shiftKey;
    const currentSelection = (() => {
      const next = new Set(selectedIds);
      if (isToggle) {
        if (next.has(hexId)) {
          next.delete(hexId);
        } else {
          next.add(hexId);
        }
        return next;
      }
      const connected = new Set([hexId]);
      const queue = [hexId];
      while (queue.length) {
        const current = queue.pop();
        const node = (boardData.hexagons || []).find((hex) => hex.id === current);
        (node?.connections || []).forEach((id) => {
          if (!connected.has(id)) {
            connected.add(id);
            queue.push(id);
          }
        });
      }
      return connected;
    })();
    setSelectedIds(currentSelection);
    const startPositions = {};
    (boardData.hexagons || []).forEach((hex) => {
      if (currentSelection.has(hex.id)) {
        startPositions[hex.id] = { x: hex.x || 0, y: hex.y || 0 };
      }
    });
    setDragState({
      id: hexId,
      startX: localX,
      startY: localY,
      startPositions,
      lastX: localX,
      lastY: localY,
      lastTime: event.timeStamp || Date.now(),
      breakConnections: false
    });
  }

  function openContextMenu(event, hexId) {
    event.preventDefault();
    setSelectedIds(new Set([hexId]));
    setContextMenu({ x: event.clientX, y: event.clientY, targetId: hexId });
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

  function handleCanvasPointerDown(event) {
    if (panMode) {
      setPanState({ startX: event.clientX, startY: event.clientY, origin: { ...pan } });
      return;
    }
    if (event.target.tagName !== "svg" && event.target.tagName !== "rect") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const start = {
      x: (event.clientX - rect.left - pan.x) / zoom,
      y: (event.clientY - rect.top - pan.y) / zoom
    };
    setMarqueeStart(start);
    setMarqueeRect({ x: start.x, y: start.y, width: 0, height: 0 });
    setSelectedIds(new Set());
  }

  function handleCanvasPointerMoveMarquee(event) {
    if (panState) {
      setPan({
        x: panState.origin.x + (event.clientX - panState.startX),
        y: panState.origin.y + (event.clientY - panState.startY)
      });
      return;
    }
    if (!marqueeStart) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left - pan.x) / zoom;
    const y = (event.clientY - rect.top - pan.y) / zoom;
    const nextRect = {
      x: Math.min(marqueeStart.x, x),
      y: Math.min(marqueeStart.y, y),
      width: Math.abs(x - marqueeStart.x),
      height: Math.abs(y - marqueeStart.y)
    };
    setMarqueeRect(nextRect);
    const ids = (boardData.hexagons || [])
      .filter((hex) => {
        const hx = hex.x || 0;
        const hy = hex.y || 0;
        return (
          hx >= nextRect.x &&
          hx <= nextRect.x + nextRect.width &&
          hy >= nextRect.y &&
          hy <= nextRect.y + nextRect.height
        );
      })
      .map((hex) => hex.id);
    setSelectedIds(new Set(ids));
  }

  function handleDeleteSelected() {
    if (selectedIds.size === 0) return;
    pushHistory({
      ...boardData,
      hexagons: (boardData.hexagons || [])
        .filter((hex) => !selectedIds.has(hex.id))
        .map((hex) => ({
          ...hex,
          connections: (hex.connections || []).filter((id) => !selectedIds.has(id))
        }))
    });
    setSelectedIds(new Set());
  }

  function handleDuplicateSelected() {
    if (selectedIds.size === 0) return;
    const selected = (boardData.hexagons || []).filter((hex) => selectedIds.has(hex.id));
    const clones = selected.map((hex) => ({
      ...hex,
      id: crypto.randomUUID(),
      x: (hex.x || 0) + 40,
      y: (hex.y || 0) + 40,
      connections: []
    }));
    pushHistory({
      ...boardData,
      hexagons: [...(boardData.hexagons || []), ...clones]
    });
    setSelectedIds(new Set(clones.map((hex) => hex.id)));
  }

  if (user && activeBoardId) {
    const selected = (boardData.hexagons || []).find((hex) => selectedIds.has(hex.id));
    const connections = buildConnections(boardData.hexagons || []);
    return (
      <div className="board-shell">
        <div className="board-topbar">
          <Button onClick={() => setActiveBoardId(null)}>Back</Button>
          <div className="board-title">
            <input value={boardTitle} onChange={(e) => setBoardTitle(e.target.value)} />
          </div>
          <Button onClick={handleAddHexagon}>Add hexagon</Button>
          <Button onClick={handleSaveBoard}>Save</Button>
          <Button onClick={undo} disabled={historyRef.current.length === 0}>
            Undo
          </Button>
          <Button onClick={redo} disabled={redoRef.current.length === 0}>
            Redo
          </Button>
          {err ? <span className="board-error">{err}</span> : null}
          <Button onClick={logout}>Log out</Button>
        </div>
        <div className="board-controls">
          <label className="toggle">
            <input
              type="checkbox"
              checked={showNumbers}
              onChange={(e) => setShowNumbers(e.target.checked)}
            />
            Show numbers
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={panMode}
              onChange={(e) => setPanMode(e.target.checked)}
            />
            Pan
          </label>
          <label className="zoom-label">
            Zoom
            <input
              type="range"
              min="0.4"
              max="2.5"
              step="0.05"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </label>
          <Button
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            Reset view
          </Button>
          {selected ? (
            <label className="field inline-field">
              <div className="field-label">Label</div>
              <input
                value={selected.text || ""}
                onChange={(e) => handleLabelChange(e.target.value)}
              />
            </label>
          ) : null}
          <label className="field inline-field">
            <div className="field-label">Media</div>
            <input type="file" onChange={(e) => handleMediaChange(e.target.files?.[0])} />
          </label>
        </div>
        <svg
          className="canvas"
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={(event) => {
            handleCanvasPointerMove(event);
            handleCanvasPointerMoveMarquee(event);
          }}
          onPointerUp={handleCanvasPointerUp}
        >
          <rect width="100%" height="100%" fill="#f1f5f9" />
          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
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
            {marqueeRect ? (
              <rect
                x={marqueeRect.x}
                y={marqueeRect.y}
                width={marqueeRect.width}
                height={marqueeRect.height}
                fill="rgba(59,130,246,0.15)"
                stroke="#3b82f6"
                strokeWidth="1"
              />
            ) : null}
            {(boardData.hexagons || []).map((hex) => (
              <g
                key={hex.id}
                transform={`translate(${hex.x || 0} ${hex.y || 0})`}
                onPointerDown={(event) => handleHexPointerDown(event, hex.id)}
                onContextMenu={(event) => openContextMenu(event, hex.id)}
                onDoubleClick={(event) => openContextMenu(event, hex.id)}
              >
                <polygon
                  points={getHexPoints(hexRadius)}
                  fill={hex.fillColor || "#cbd5f5"}
                  stroke={selectedIds.has(hex.id) ? "#0f172a" : "#94a3b8"}
                  strokeWidth={selectedIds.has(hex.id) ? 2 : 1}
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
                {showNumbers && hex.number ? (
                  <text x={-hexRadius + 6} y={-hexRadius + 12} fontSize="10" fill="#0f172a">
                    {hex.number}
                  </text>
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
          </g>
        </svg>
        {contextMenu ? (
          <div
            className="context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(event) => event.stopPropagation()}
            onMouseLeave={() => setContextMenu(null)}
          >
            <button
              onClick={() => {
                handleDuplicateSelected();
                setContextMenu(null);
              }}
            >
              Duplicate
            </button>
            <button
              onClick={() => {
                handleDeleteSelected();
                setContextMenu(null);
              }}
            >
              Delete
            </button>
            <label>
              Color
              <input
                type="color"
                value={selected?.fillColor || "#cbd5f5"}
                onChange={(e) => handleColorChange(e.target.value)}
              />
            </label>
          </div>
        ) : null}
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
