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
  updateBoard,
  deleteBoard,
  listShares,
  createShare,
  deleteShare,
  listCollaborators,
  addCollaborator,
  removeCollaborator,
  getSharedBoard
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
  const [snapRatio, setSnapRatio] = useState(0.94);
  const [disconnectVelocityThreshold, setDisconnectVelocityThreshold] = useState(60);
  const colorOptions = [
    { name: "Red", color: "#f23f3f" },
    { name: "Orange", color: "#f29926" },
    { name: "Yellow", color: "#f2d933" },
    { name: "Green", color: "#40d940" },
    { name: "Blue", color: "#4099f2" }
  ];
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [token, setTokenState] = useState(() => getToken());
  const [user, setUser] = useState(null);
  const [boards, setBoards] = useState([]);
  const [activeBoardId, setActiveBoardId] = useState(null);
  const [activeBoard, setActiveBoard] = useState(null);
  const [activeBoardRole, setActiveBoardRole] = useState("owner");
  const [activeBoardOwnerEmail, setActiveBoardOwnerEmail] = useState(null);
  const [boardTitle, setBoardTitle] = useState("");
  const [boardData, setBoardData] = useState({ hexagons: [] });
  const [sharedView, setSharedView] = useState(false);
  const [sharedRole, setSharedRole] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [dragState, setDragState] = useState(null);
  const [marqueeStart, setMarqueeStart] = useState(null);
  const [marqueeRect, setMarqueeRect] = useState(null);
  const [showNumbers, setShowNumbers] = useState(true);
  const zoomMin = 0.2;
  const zoomMax = 6.25;
  const zoomMid = (zoomMin + zoomMax) / 2;
  const [zoom, setZoom] = useState(zoomMid);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panState, setPanState] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [addCount, setAddCount] = useState(1);
  const [addColor, setAddColor] = useState(colorOptions[0].color);
  const [lastSelectedId, setLastSelectedId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showSharePanel, setShowSharePanel] = useState(false);
  const [shareRole, setShareRole] = useState("view");
  const [shares, setShares] = useState([]);
  const [collaborators, setCollaborators] = useState([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("editor");
  const pendingViewportRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const historyRef = useRef([]);
  const redoRef = useRef([]);
  const canvasRef = useRef(null);
  const imageInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const pendingMediaRef = useRef({ id: null, type: null });
  const wsRef = useRef(null);
  const wsSendTimer = useRef(null);
  const lastSendRef = useRef(0);
  const suppressBroadcastRef = useRef(false);
  const clientId = useRef(crypto.randomUUID());
  const [presence, setPresence] = useState({});
  const [presenceList, setPresenceList] = useState([]);
  const presenceTimer = useRef(null);

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
    const params = new URLSearchParams(window.location.search);
    const shareToken = params.get("share");
    if (!shareToken) return;
    let canceled = false;
    setBusy(true);
    getSharedBoard(shareToken)
      .then((response) => {
        if (canceled) return;
        setSharedView(true);
        setSharedRole(response.role || "view");
        setActiveBoardId(response.board.id);
        setBoardTitle(response.board.title || "Shared board");
        const data = response.board.data || { hexagons: [] };
        setBoardData(data);
        applyViewportFromData(data);
        setActiveBoardRole("viewer");
        setActiveBoardOwnerEmail(null);
        pendingViewportRef.current = true;
      })
      .catch((e) => {
        if (!canceled) setErr(e.message);
      })
      .finally(() => {
        if (!canceled) setBusy(false);
      });
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    listBoards()
      .then((response) => setBoards(response.boards || []))
      .catch((e) => setErr(e.message));
  }, [user]);

  useEffect(() => {
    if (!activeBoardId || !token) return;
    const apiBase = import.meta.env.VITE_API_BASE || "http://localhost:3000";
    const wsBase = import.meta.env.VITE_WS_BASE || apiBase.replace(/^http/, "ws");
    const wsUrl = `${wsBase}/ws?boardId=${activeBoardId}&token=${token}`;
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "board_update") {
          if (message.sender === clientId.current) return;
          suppressBroadcastRef.current = true;
          setBoardData(message.data);
          return;
        }
        if (message.type === "presence") {
          if (message.sender === clientId.current) return;
          setPresence((prev) => ({
            ...prev,
            [message.sender]: { cursor: message.cursor, label: message.label }
          }));
        }
        if (message.type === "presence_state") {
          setPresenceList(message.users || []);
        }
      } catch {
        // ignore
      }
    };
    return () => {
      socket.close();
      wsRef.current = null;
    };
  }, [activeBoardId, token]);

  function queueBoardBroadcast(nextData) {
    if (!canEdit) return;
    if (!activeBoardId) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    const elapsed = now - lastSendRef.current;
    const sendNow = elapsed >= 90;

    const send = () => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      wsRef.current.send(
        JSON.stringify({
          type: "board_update",
          boardId: activeBoardId,
          data: nextData,
          sender: clientId.current
        })
      );
      lastSendRef.current = Date.now();
    };

    if (sendNow) {
      send();
      return;
    }

    if (wsSendTimer.current) {
      clearTimeout(wsSendTimer.current);
    }
    wsSendTimer.current = window.setTimeout(() => {
      send();
    }, 90 - elapsed);
  }

  useEffect(() => {
    if (suppressBroadcastRef.current) {
      suppressBroadcastRef.current = false;
      return;
    }
    queueBoardBroadcast(boardData);
  }, [boardData, activeBoardId]);

  function sendPresence(point) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (presenceTimer.current) {
      clearTimeout(presenceTimer.current);
    }
    presenceTimer.current = window.setTimeout(() => {
      wsRef.current?.send(
        JSON.stringify({
          type: "presence",
          boardId: activeBoardId,
          cursor: point,
          sender: clientId.current,
          label: user?.email ? user.email.split("@")[0] : "Guest"
        })
      );
    }, 60);
  }

  useEffect(() => {
    if (!user?.id) return;
    const stored = localStorage.getItem(`contextboard_breakSpeed_${user.id}`);
    if (stored !== null) {
      const value = Number(stored);
      if (!Number.isNaN(value)) {
        setDisconnectVelocityThreshold(value);
      }
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    localStorage.setItem(
      `contextboard_breakSpeed_${user.id}`,
      String(disconnectVelocityThreshold)
    );
  }, [disconnectVelocityThreshold, user?.id]);

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

  useEffect(() => {
    if (!activeBoardId) return;
    if (pendingViewportRef.current && applyViewportFromData(boardData)) {
      pendingViewportRef.current = false;
      return;
    }
    if (boardData?.viewport?.center && typeof boardData.viewport.zoom === "number") return;
    const svg = canvasRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    setZoom(zoomMid);
    setPan({ x: rect.width / 2, y: rect.height / 2 });
  }, [activeBoardId, boardData?.viewport]);

  const canEdit = !sharedView && (activeBoardRole === "owner" || activeBoardRole === "editor");
  const isReadOnly = !canEdit;
  const isOwner = activeBoardRole === "owner";

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
    setActiveBoardRole("owner");
    setActiveBoardOwnerEmail(null);
    setEmail("");
    setPassword("");
    setErr("");
  }

  function exitSharedView() {
    const url = new URL(window.location.href);
    url.searchParams.delete("share");
    window.history.replaceState({}, "", url.toString());
    setSharedView(false);
    setSharedRole(null);
    setActiveBoardId(null);
    setBoardTitle("");
    setBoardData({ hexagons: [] });
    setShowSharePanel(false);
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
    setSharedView(false);
    setSharedRole(null);
    setShowSharePanel(false);
    try {
      const response = await getBoard(id);
      const board = response.board;
      setActiveBoard(board);
      setBoardTitle(board.title || "");
      setActiveBoardRole(board.accessRole || "owner");
      setActiveBoardOwnerEmail(board.ownerEmail || null);
      const data = board.data ?? { hexagons: [] };
      setBoardData(data);
      setSelectedIds(new Set());
      setLastSelectedId(null);
      if (!applyViewportFromData(data)) {
        const svg = canvasRef.current;
        if (svg) {
          const rect = svg.getBoundingClientRect();
          setZoom(zoomMid);
          setPan({ x: rect.width / 2, y: rect.height / 2 });
        } else {
          setZoom(zoomMid);
          setPan({ x: 0, y: 0 });
        }
      }
      pendingViewportRef.current = true;
      historyRef.current = [];
      redoRef.current = [];
    } catch (e) {
      setErr(e.message);
    }
  }

  function applyViewportFromData(data) {
    const viewport = data?.viewport;
    if (!viewport || typeof viewport.zoom !== "number") return false;
    const svg = canvasRef.current;
    if (!svg) return false;
    const rect = svg.getBoundingClientRect();
    const zoomValue = zoomMid;
    if (viewport.center && typeof viewport.center.x === "number" && typeof viewport.center.y === "number") {
      setZoom(zoomValue);
      setPan({
        x: rect.width / 2 - viewport.center.x * zoomValue,
        y: rect.height / 2 - viewport.center.y * zoomValue
      });
      return true;
    }
    if (viewport.pan && typeof viewport.pan.x === "number" && typeof viewport.pan.y === "number") {
      setZoom(zoomValue);
      setPan({ x: viewport.pan.x, y: viewport.pan.y });
      return true;
    }
    return false;
  }

  function buildViewportForSave() {
    const svg = canvasRef.current;
    if (!svg) {
      return { pan: { ...pan }, zoom };
    }
    const rect = svg.getBoundingClientRect();
    const centerWorld = {
      x: (rect.width / 2 - pan.x) / zoom,
      y: (rect.height / 2 - pan.y) / zoom
    };
    return { center: centerWorld, pan: { ...pan }, zoom };
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
    if (!canEdit) return;
    if (!activeBoardId) return;
    setErr("");
    try {
      const response = await updateBoard(activeBoardId, {
        title: boardTitle.trim() || "Untitled Board",
        data: {
          ...boardData,
          viewport: buildViewportForSave()
        }
      });
      setActiveBoard(response.board);
      setBoards((prev) =>
        prev.map((item) =>
          item.id === response.board.id
            ? {
                ...item,
                ...response.board,
                accessRole: item.accessRole,
                ownerEmail: item.ownerEmail
              }
            : item
        )
      );
    } catch (e) {
      setErr(e.message || "Failed to save board");
    }
  }

  async function refreshSharing() {
    if (!activeBoardId || !isOwner) return;
    try {
      const [sharesResponse, collaboratorsResponse] = await Promise.all([
        listShares(activeBoardId),
        listCollaborators(activeBoardId)
      ]);
      setShares(sharesResponse.shares || []);
      setCollaborators(collaboratorsResponse.collaborators || []);
    } catch (e) {
      setErr(e.message);
    }
  }

  useEffect(() => {
    if (!showSharePanel) return;
    refreshSharing();
  }, [showSharePanel, activeBoardId, isOwner]);

  async function handleCreateShare() {
    if (!activeBoardId || !isOwner) return;
    setErr("");
    try {
      await createShare(activeBoardId, shareRole);
      await refreshSharing();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function handleDeleteShare(shareId) {
    if (!activeBoardId || !isOwner) return;
    setErr("");
    try {
      await deleteShare(activeBoardId, shareId);
      await refreshSharing();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function handleAddCollaborator() {
    if (!activeBoardId || !isOwner) return;
    const emailValue = inviteEmail.trim();
    if (!emailValue) return;
    setErr("");
    try {
      await addCollaborator(activeBoardId, { email: emailValue, role: inviteRole });
      setInviteEmail("");
      await refreshSharing();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function handleRemoveCollaborator(collaboratorId) {
    if (!activeBoardId || !isOwner) return;
    setErr("");
    try {
      await removeCollaborator(activeBoardId, collaboratorId);
      await refreshSharing();
    } catch (e) {
      setErr(e.message);
    }
  }

  function buildShareUrl(token) {
    return `${window.location.origin}/?share=${token}`;
  }

  async function handleCopyShare(token) {
    try {
      await navigator.clipboard.writeText(buildShareUrl(token));
    } catch {
      setErr("Unable to copy share link.");
    }
  }

  function handleCanvasPointerMove(event) {
    if (!dragState) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const rawX = (event.clientX - rect.left - pan.x) / zoom;
    const rawY = (event.clientY - rect.top - pan.y) / zoom;
    const x = rawX;
    const y = rawY;
    const dx = x - dragState.startX;
    const dy = y - dragState.startY;
    const now = event.timeStamp || Date.now();
    const deltaTime = Math.max(1, now - dragState.lastTime);
    const speed = Math.hypot(x - dragState.lastX, y - dragState.lastY) / deltaTime;

    if (!dragState.breakConnections && now - dragState.startTime < 200) {
      const velocity = speed * 1000;
      if (velocity > disconnectVelocityThreshold) {
        const nextHexagons = clearConnectionsFor(boardData.hexagons || [], dragState.id);
        setBoardData({ ...boardData, hexagons: nextHexagons });
        setDragState({
          ...dragState,
          startPositions: { [dragState.id]: { x, y } },
          startX: x,
          startY: y,
          lastX: x,
          lastY: y,
          lastTime: now,
          lastSpeed: speed,
          breakConnections: true
        });
        return;
      }
    }
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
            lastSpeed: speed
          }
        : prev
    );
  }

  function handleCanvasPointerUp() {
    if (dragState && canEdit) {
      const hexSize = hexRadius * 2;
      const snapDistance = hexSize * snapRatio;
      const snapDistanceSquared = snapDistance * snapDistance;
      let nextHexagons = boardData.hexagons || [];

      if (!dragState.breakConnections) {
        nextHexagons = snapHexagonToNeighbors(
          nextHexagons,
          dragState.id,
          snapDistance,
          snapDistanceSquared
        );
      }
      pushHistory({ ...boardData, hexagons: nextHexagons });
    }
    if (panState) {
      setPanState(null);
    }
    setDragState(null);
    setMarqueeStart(null);
    setMarqueeRect(null);
  }

  function handleAddHexagon(count = addCount, color = addColor) {
    if (!canEdit) return;
    const maxNumber = Math.max(0, ...(boardData.hexagons || []).map((hex) => hex.number || 0));
    const svg = canvasRef.current;
    const rect = svg ? svg.getBoundingClientRect() : { width: 0, height: 0 };
    const center = { x: rect.width / 2, y: rect.height / 2 };
    const worldX = (center.x - pan.x) / zoom;
    const worldY = (center.y - pan.y) / zoom;
    const hexagons = [...(boardData.hexagons || [])];
    const cols = Math.ceil(Math.sqrt(count));
    const spacing = hexRadius * 2.2;
    for (let i = 0; i < count; i += 1) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      hexagons.push({
        id: crypto.randomUUID(),
        number: maxNumber + 1 + i,
        x: Math.round((worldX + col * spacing) / snapSize) * snapSize,
        y: Math.round((worldY + row * spacing) / snapSize) * snapSize,
        text: "New",
        fillColor: color,
        connections: [],
        content: null
      });
    }
    pushHistory({ ...boardData, hexagons });
    setSelectedIds(new Set(hexagons.slice(-count).map((hex) => hex.id)));
    setShowAddMenu(false);
  }

  function handleLabelChange(value) {
    if (!canEdit) return;
    pushHistory({
      ...boardData,
      hexagons: (boardData.hexagons || []).map((hex) =>
        selectedIds.has(hex.id) ? { ...hex, text: value } : hex
      )
    });
  }

  function handleColorChange(value) {
    if (!canEdit) return;
    pushHistory({
      ...boardData,
      hexagons: (boardData.hexagons || []).map((hex) =>
        selectedIds.has(hex.id) ? { ...hex, fillColor: value } : hex
      )
    });
  }

  function handleMediaChange(file, forcedType) {
    if (!canEdit) return;
    if (!file) return;
    const targetId = pendingMediaRef.current.id || Array.from(selectedIds)[0];
    if (!targetId) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (!dataUrl || typeof dataUrl !== "string") return;
      const type = forcedType
        ? forcedType
        : file.type.startsWith("image/")
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
          hex.id === targetId ? { ...hex, content: payload } : hex
        )
      });
      pendingMediaRef.current = { id: null, type: null };
    };
    reader.readAsDataURL(file);
  }

  function handleHexPointerDown(event, hexId) {
    if (isReadOnly) {
      setSelectedIds(new Set([hexId]));
      setLastSelectedId(hexId);
      return;
    }
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
      return new Set([hexId]);
    })();
    setSelectedIds(currentSelection);
    setLastSelectedId(hexId);
    const dragIds = (() => {
      if (currentSelection.size > 1) return currentSelection;
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
    const startPositions = {};
    (boardData.hexagons || []).forEach((hex) => {
      if (dragIds.has(hex.id)) {
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
      lastSpeed: 0,
      startTime: event.timeStamp || Date.now(),
      breakConnections: false
    });
  }

  function openContextMenu(event, hexId) {
    if (!canEdit) return;
    event.preventDefault();
    setSelectedIds(new Set([hexId]));
    setContextMenu({ x: event.clientX, y: event.clientY, targetId: hexId });
  }

  function setHexContent(id, content) {
    if (!canEdit) return;
    pushHistory({
      ...boardData,
      hexagons: (boardData.hexagons || []).map((hex) =>
        hex.id === id ? { ...hex, content } : hex
      )
    });
  }

  function handleEditText(id, asHypertext) {
    if (!canEdit) return;
    const hex = (boardData.hexagons || []).find((item) => item.id === id);
    const current =
      hex?.content?.type === "text" || hex?.content?.type === "hypertext"
        ? hex.content.value || ""
        : hex?.text || "";
    const label = asHypertext ? "Edit hypertext" : "Edit text";
    const next = window.prompt(label, current);
    if (next === null) return;
    if (asHypertext) {
      setHexContent(id, { type: "hypertext", value: next });
    } else {
      setHexContent(id, { type: "text", value: next });
    }
  }

  function handleHexDoubleClick(event, hex) {
    if (hex.content?.type === "hypertext" && typeof hex.content.value === "string") {
      const match = hex.content.value.match(/https?:\/\/\S+/);
      if (match) {
        window.open(match[0], "_blank", "noopener,noreferrer");
        return;
      }
    }
    if (!event.target?.classList?.contains("hex-text-label")) {
      return;
    }
    if (hex.content?.type === "video" || hex.content?.type === "audio") {
      const media = document.getElementById(`media-${hex.id}`);
      if (media && media.paused) {
        media.play();
      } else if (media) {
        media.pause();
      }
      return;
    }
    if (!canEdit) return;
    handleEditText(hex.id, hex.content?.type === "hypertext");
  }

  function handleSetText(id) {
    setHexContent(id, { type: "text", value: "New Text" });
  }

  function handleSetHypertext(id) {
    setHexContent(id, { type: "hypertext", value: "Visit https://openai.com" });
  }

  function triggerMediaPicker(id, type) {
    pendingMediaRef.current = { id, type };
    if (type === "image") imageInputRef.current?.click();
    if (type === "video") videoInputRef.current?.click();
    if (type === "audio") audioInputRef.current?.click();
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

  function clearConnectionsFor(hexagons, id) {
    return hexagons.map((hex) => {
      if (hex.id === id) {
        return { ...hex, connections: [] };
      }
      if (hex.connections?.includes(id)) {
        return { ...hex, connections: (hex.connections || []).filter((conn) => conn !== id) };
      }
      return hex;
    });
  }

  function snapHexagonToNeighbors(hexagons, draggedId, snapDistance, snapDistanceSquared) {
    const draggedIndex = hexagons.findIndex((hex) => hex.id === draggedId);
    if (draggedIndex < 0) return hexagons;
    const dragged = hexagons[draggedIndex];
    let closestIndex = -1;
    let closestDistSquared = Infinity;
    hexagons.forEach((hex, index) => {
      if (hex.id === draggedId) return;
      const dx = (dragged.x || 0) - (hex.x || 0);
      const dy = (dragged.y || 0) - (hex.y || 0);
      const distSquared = dx * dx + dy * dy;
      if (distSquared <= snapDistanceSquared && distSquared < closestDistSquared) {
        closestDistSquared = distSquared;
        closestIndex = index;
      }
    });
    if (closestIndex < 0) return hexagons;
    const closest = hexagons[closestIndex];
    const dx = (dragged.x || 0) - (closest.x || 0);
    const dy = (dragged.y || 0) - (closest.y || 0);
    const angle = Math.atan2(dy, dx);
    const newX = (closest.x || 0) + Math.cos(angle) * snapDistance;
    const newY = (closest.y || 0) + Math.sin(angle) * snapDistance;
    const updated = [...hexagons];
    const draggedConnections = new Set(updated[draggedIndex].connections || []);
    const closestConnections = new Set(updated[closestIndex].connections || []);
    draggedConnections.add(closest.id);
    closestConnections.add(dragged.id);
    updated[draggedIndex] = {
      ...updated[draggedIndex],
      x: newX,
      y: newY,
      connections: Array.from(draggedConnections)
    };
    updated[closestIndex] = {
      ...updated[closestIndex],
      connections: Array.from(closestConnections)
    };
    return updated;
  }

  function handleCanvasPointerDown(event) {
    if (event.target.tagName !== "svg" && event.target.tagName !== "rect") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const start = {
      x: (event.clientX - rect.left - pan.x) / zoom,
      y: (event.clientY - rect.top - pan.y) / zoom
    };
    if (event.shiftKey) {
      setMarqueeStart(start);
      setMarqueeRect({ x: start.x, y: start.y, width: 0, height: 0 });
      setSelectedIds(new Set());
    } else {
      setPanState({ startX: event.clientX, startY: event.clientY, origin: { ...pan } });
    }
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
    if (!canEdit) return;
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

  function handleDisconnectSelected() {
    if (!canEdit) return;
    if (selectedIds.size === 0) return;
    let next = boardData.hexagons || [];
    selectedIds.forEach((id) => {
      next = clearConnectionsFor(next, id);
    });
    pushHistory({ ...boardData, hexagons: next });
  }

  function setZoomWithCenter(nextZoom) {
    const svg = canvasRef.current;
    if (!svg) {
      setZoom(nextZoom);
      return;
    }
    const rect = svg.getBoundingClientRect();
    const center = { x: rect.width / 2, y: rect.height / 2 };
    const target = lastSelectedId
      ? (boardData.hexagons || []).find((hex) => hex.id === lastSelectedId)
      : null;
    const worldX = target ? target.x || 0 : (center.x - pan.x) / zoom;
    const worldY = target ? target.y || 0 : (center.y - pan.y) / zoom;
    setZoom(nextZoom);
    setPan({
      x: center.x - worldX * nextZoom,
      y: center.y - worldY * nextZoom
    });
  }

  function handleDuplicateSelected() {
    if (!canEdit) return;
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

  async function handleDeleteBoard(id) {
    setErr("");
    try {
      await deleteBoard(id);
      setBoards((prev) => prev.filter((board) => board.id !== id));
    } catch (e) {
      setErr(e.message);
    }
  }

  if (activeBoardId && (user || sharedView)) {
    const selected = (boardData.hexagons || []).find((hex) => selectedIds.has(hex.id));
    const connections = buildConnections(boardData.hexagons || []);
    return (
      <div className="board-shell">
        <div className="board-topbar">
          <Button onClick={() => (sharedView ? exitSharedView() : setActiveBoardId(null))}>
            Back
          </Button>
          <div className="board-title">
            <input
              className="title-input"
              value={boardTitle}
              onChange={(e) => setBoardTitle(e.target.value)}
              readOnly={isReadOnly}
            />
          </div>
          {activeBoardRole !== "owner" ? (
            <span className="role-badge">
              {sharedView ? `Shared (${sharedRole || "view"})` : `${activeBoardRole} access`}
            </span>
          ) : null}
          <div className="spacer" />
          {canEdit ? (
            <>
              <button className="icon-button" onClick={handleSaveBoard} aria-label="Save">
                💾
              </button>
              <button
                className="icon-button"
                onClick={undo}
                disabled={historyRef.current.length === 0}
                aria-label="Undo"
              >
                ↺
              </button>
              <button
                className="icon-button"
                onClick={redo}
                disabled={redoRef.current.length === 0}
                aria-label="Redo"
              >
                ↻
              </button>
            </>
          ) : (
            <span className="role-badge">Read only</span>
          )}
          {presenceList.length ? (
            <div className="presence-list">
              Online: {presenceList.map((item) => item.label).join(", ")}
            </div>
          ) : null}
          {err ? <span className="board-error">{err}</span> : null}
          {isOwner && !sharedView ? (
            <button
              className="icon-button"
              onClick={() => setShowSharePanel((prev) => !prev)}
              aria-label="Share"
            >
              🔗
            </button>
          ) : null}
          <button className="icon-button" onClick={() => setShowSettings((prev) => !prev)}>
            ⚙️
          </button>
          {user ? <Button onClick={logout}>Log out</Button> : null}
        </div>
        <div className="zoom-rail">
          <input
            className="zoom-slider"
            type="range"
            min={zoomMin}
            max={zoomMax}
            step="0.05"
            value={zoom}
            onChange={(e) => setZoomWithCenter(Number(e.target.value))}
          />
        </div>
        {showSettings ? (
          <div className="settings-panel">
            <label className="toggle">
              <input
                type="checkbox"
                checked={showNumbers}
                onChange={(e) => setShowNumbers(e.target.checked)}
              />
              Show numbers
            </label>
            <label className="field inline-field">
              <div className="field-label">Snap ratio</div>
              <input
                type="number"
                min="0.2"
                max="1.2"
                step="0.01"
                value={snapRatio}
                onChange={(e) => setSnapRatio(Number(e.target.value))}
              />
            </label>
            <label className="field inline-field">
              <div className="field-label">Break speed (px/s)</div>
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={disconnectVelocityThreshold}
                onChange={(e) => setDisconnectVelocityThreshold(Number(e.target.value))}
              />
            </label>
          </div>
        ) : null}
        {showSharePanel && isOwner ? (
          <div className="share-panel">
            <div className="panel-section">
              <div className="panel-title">Share link</div>
              <div className="panel-row">
                <select value={shareRole} onChange={(e) => setShareRole(e.target.value)}>
                  <option value="view">View</option>
                  <option value="comment">Comment</option>
                </select>
                <Button onClick={handleCreateShare}>Create</Button>
              </div>
              {shares.length === 0 ? (
                <div className="muted small">No active share links.</div>
              ) : (
                <div className="panel-list">
                  {shares.map((share) => (
                    <div key={share.id} className="panel-item">
                      <div className="panel-item-title">
                        {share.role} link
                      </div>
                      <div className="panel-item-link">{buildShareUrl(share.token)}</div>
                      <div className="panel-row">
                        <Button onClick={() => handleCopyShare(share.token)}>Copy</Button>
                        <button
                          className="link-button"
                          type="button"
                          onClick={() => handleDeleteShare(share.id)}
                        >
                          Revoke
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="panel-section">
              <div className="panel-title">Invite collaborator</div>
              <label className="field inline-field">
                <div className="field-label">Email</div>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="name@example.com"
                />
              </label>
              <div className="panel-row">
                <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <Button onClick={handleAddCollaborator}>Invite</Button>
              </div>
              {collaborators.length === 0 ? (
                <div className="muted small">No collaborators yet.</div>
              ) : (
                <div className="panel-list">
                  {collaborators.map((collab) => (
                    <div key={collab.id} className="panel-row panel-item">
                      <div>
                        <div className="panel-item-title">{collab.email}</div>
                        <div className="muted small">{collab.role}</div>
                      </div>
                      <button
                        className="link-button"
                        type="button"
                        onClick={() => handleRemoveCollaborator(collab.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
        <div className="snap-indicator">
          Snap {(snapRatio * 100).toFixed(0)}% · Break {disconnectVelocityThreshold} px/s
        </div>
        <svg
          ref={canvasRef}
          className="canvas"
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={(event) => {
            handleCanvasPointerMove(event);
            handleCanvasPointerMoveMarquee(event);
            const rect = event.currentTarget.getBoundingClientRect();
            const cursor = {
              x: (event.clientX - rect.left - pan.x) / zoom,
              y: (event.clientY - rect.top - pan.y) / zoom
            };
            sendPresence(cursor);
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
            {Object.entries(presence)
              .filter(([, data]) => data.cursor && typeof data.cursor.x === "number")
              .map(([id, data]) => (
                <g key={id} transform={`translate(${data.cursor.x} ${data.cursor.y})`}>
                  <circle r="6" fill="#38bdf8" />
                  <text x="10" y="4" fontSize="10" fill="#0f172a">
                    {data.label || "User"}
                  </text>
                </g>
              ))}
            {(boardData.hexagons || []).map((hex) => {
              const clipId = `clip-${hex.id}`;
              const gradientId = `grad-${hex.id}`;
              return (
              <g
                key={hex.id}
                transform={`translate(${hex.x || 0} ${hex.y || 0})`}
                onPointerDown={(event) => handleHexPointerDown(event, hex.id)}
                onContextMenu={(event) => openContextMenu(event, hex.id)}
                onDoubleClick={(event) => handleHexDoubleClick(event, hex)}
              >
                <defs>
                  <clipPath id={clipId}>
                    <polygon points={getHexPoints(hexRadius)} />
                  </clipPath>
                  <radialGradient id={gradientId} cx="35%" cy="30%" r="70%">
                    <stop offset="0%" stopColor="rgba(255,255,255,0.65)" />
                    <stop offset="45%" stopColor="rgba(255,255,255,0.1)" />
                    <stop offset="100%" stopColor="rgba(0,0,0,0.25)" />
                  </radialGradient>
                </defs>
                <polygon
                  points={getHexPoints(hexRadius)}
                  fill={hex.fillColor || "#cbd5f5"}
                  stroke={selectedIds.has(hex.id) ? "#0f172a" : "#94a3b8"}
                  strokeWidth={selectedIds.has(hex.id) ? 2 : 1}
                />
                <polygon
                  points={getHexPoints(hexRadius)}
                  fill={`url(#${gradientId})`}
                />
                {hex.content?.type ? (
                  <g clipPath={`url(#${clipId})`}>
                    {hex.content.type === "image" ? (
                      <image
                        href={hex.content.dataUrl}
                        x={-hexRadius}
                        y={-hexRadius}
                        width={hexRadius * 2}
                        height={hexRadius * 2}
                        preserveAspectRatio="xMidYMid slice"
                      />
                    ) : null}
                    {hex.content.type === "video" ? (
                      <foreignObject
                        x={-hexRadius}
                        y={-hexRadius}
                        width={hexRadius * 2}
                        height={hexRadius * 2}
                      >
                        <video
                          id={`media-${hex.id}`}
                          src={hex.content.dataUrl}
                          controls
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      </foreignObject>
                    ) : null}
                    {hex.content.type === "audio" ? (
                      <foreignObject
                        x={-hexRadius}
                        y={-hexRadius}
                        width={hexRadius * 2}
                        height={hexRadius * 2}
                      >
                        <audio
                          id={`media-${hex.id}`}
                          src={hex.content.dataUrl}
                          controls
                          style={{ width: "100%" }}
                        />
                      </foreignObject>
                    ) : null}
                    {hex.content.type === "pdf" ? (
                      <foreignObject
                        x={-hexRadius}
                        y={-hexRadius}
                        width={hexRadius * 2}
                        height={hexRadius * 2}
                      >
                        <iframe
                          title={hex.content.name || "PDF"}
                          src={hex.content.dataUrl}
                          style={{ width: "100%", height: "100%", border: "none" }}
                        />
                      </foreignObject>
                    ) : null}
                    {hex.content.type === "text" || hex.content.type === "hypertext" ? (
                      <foreignObject
                        x={-hexRadius}
                        y={-hexRadius}
                        width={hexRadius * 2}
                        height={hexRadius * 2}
                      >
                        <div className="hex-text-content">
                          {hex.content.value || ""}
                        </div>
                      </foreignObject>
                    ) : null}
                  </g>
                ) : null}
                {showNumbers && hex.number ? (
                  <text x={-hexRadius + 6} y={-hexRadius + 12} fontSize="10" fill="#0f172a">
                    {hex.number}
                  </text>
                ) : null}
                <text
                  className="hex-text-label"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="12"
                  fill="#0f172a"
                >
                  {hex.content?.type === "text" || hex.content?.type === "hypertext"
                    ? ""
                    : hex.content?.type && hex.content?.type !== "image"
                    ? hex.content.type.toUpperCase()
                    : hex.text || "Hex"}
                </text>
              </g>
            )})}
          </g>
        </svg>
        {canEdit ? (
          <button
            className="fab"
            onClick={() => setShowAddMenu((prev) => !prev)}
            aria-label="Add hexagon"
          >
            +
          </button>
        ) : null}
        {canEdit && showAddMenu ? (
          <div className="add-menu">
            <div className="menu-section">Pick a color</div>
            <div className="color-row">
              {colorOptions.map((option) => (
                <button
                  key={option.name}
                  className={`color-dot ${addColor === option.color ? "active" : ""}`}
                  style={{ background: option.color }}
                  onClick={() => setAddColor(option.color)}
                  aria-label={option.name}
                />
              ))}
            </div>
            <label className="field inline-field">
              <div className="field-label">How many</div>
              <input
                type="number"
                min="1"
                max="50"
                step="1"
                value={addCount}
                onChange={(e) => setAddCount(Math.max(1, Number(e.target.value)))}
              />
            </label>
            <Button onClick={() => handleAddHexagon(addCount, addColor)}>Add</Button>
          </div>
        ) : null}
        {canEdit && contextMenu ? (
          <div
            className="context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(event) => event.stopPropagation()}
            onMouseLeave={() => setContextMenu(null)}
          >
            <button onClick={() => setSelectedIds((prev) => {
              const next = new Set(prev);
              next.delete(contextMenu.targetId);
              return next;
            })}>
              Deselect
            </button>
            <button onClick={() => setSelectedIds(new Set())}>Deselect All</button>
            <button onClick={() => handleEditText(contextMenu.targetId, false)}>Edit Text</button>
            <button onClick={() => handleSetText(contextMenu.targetId)}>Set Text</button>
            <button onClick={() => handleEditText(contextMenu.targetId, true)}>Set Hypertext</button>
            <button onClick={() => triggerMediaPicker(contextMenu.targetId, "image")}>
              Set Image
            </button>
            <button onClick={() => triggerMediaPicker(contextMenu.targetId, "video")}>
              Set Video
            </button>
            <button onClick={() => triggerMediaPicker(contextMenu.targetId, "audio")}>
              Set Audio
            </button>
            <div className="menu-section">
              Change Color
              <div className="color-row">
                {colorOptions.map((option) => (
                  <button
                    key={option.name}
                    className="color-dot"
                    style={{ background: option.color }}
                    onClick={() => handleColorChange(option.color)}
                    aria-label={option.name}
                  />
                ))}
              </div>
            </div>
            <button onClick={() => handleDisconnectSelected()}>Disconnect</button>
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
          </div>
        ) : null}
        {canEdit ? (
          <>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => handleMediaChange(e.target.files?.[0], "image")}
            />
            <input
              ref={videoInputRef}
              type="file"
              accept="video/*"
              style={{ display: "none" }}
              onChange={(e) => handleMediaChange(e.target.files?.[0], "video")}
            />
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/*"
              style={{ display: "none" }}
              onChange={(e) => handleMediaChange(e.target.files?.[0], "audio")}
            />
          </>
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
            <div key={board.id} className="list-item row">
              <button className="list-action" onClick={() => openBoard(board.id)}>
                <div className="list-title">{board.title}</div>
                <div className="muted">
                  Updated {board.updatedAt ? new Date(board.updatedAt).toLocaleString() : "—"}
                </div>
                {board.accessRole && board.accessRole !== "owner" ? (
                  <div className="muted small">
                    Shared by {board.ownerEmail || "Unknown"} · {board.accessRole}
                  </div>
                ) : null}
              </button>
              <button className="button" onClick={() => handleDeleteBoard(board.id)}>
                Delete
              </button>
            </div>
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
