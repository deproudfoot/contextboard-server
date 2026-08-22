const DB_NAME = "contextboard_offline";
const DB_VERSION = 1;
const STORE_META = "boards_meta";
const STORE_BOARDS = "boards";
const STORE_PENDING = "pending_saves";

let dbPromise = null;
let persistenceRequested = false;

function openDb() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available"));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: "userId" });
        }
        if (!db.objectStoreNames.contains(STORE_BOARDS)) {
          db.createObjectStore(STORE_BOARDS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_PENDING)) {
          db.createObjectStore(STORE_PENDING, { keyPath: "boardId" });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        dbPromise = null;
        reject(request.error || new Error("Failed to open offline database"));
      };
      request.onblocked = () => {
        dbPromise = null;
        reject(new Error("Offline database blocked"));
      };
    });
  }
  return dbPromise;
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

async function withStore(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    Promise.resolve()
      .then(() => fn(store))
      .then((value) => {
        result = value;
      })
      .catch(reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
  });
}

function isQuotaError(error) {
  if (!error) return false;
  if (error.name === "QuotaExceededError") return true;
  const message = String(error.message || error).toLowerCase();
  return message.includes("quota") || message.includes("exceeded");
}

async function evictOldestCachedBoards(keepIds = []) {
  const keep = new Set(keepIds.filter(Boolean));
  const boards = await withStore(STORE_BOARDS, "readonly", (store) => idbRequest(store.getAll()));
  const pending = await getPendingSaves();
  pending.forEach((item) => keep.add(item.boardId));

  const removable = (boards || [])
    .filter((board) => board?.id && !keep.has(board.id))
    .sort((a, b) => (a.cachedAt || 0) - (b.cachedAt || 0));

  const toRemove = removable.slice(0, Math.max(1, Math.ceil(removable.length / 3)));
  for (const board of toRemove) {
    await withStore(STORE_BOARDS, "readwrite", (store) => idbRequest(store.delete(board.id)));
  }
  return toRemove.length;
}

async function withQuotaRetry(operation, keepIds = []) {
  try {
    return await operation();
  } catch (error) {
    if (!isQuotaError(error)) throw error;
    const removed = await evictOldestCachedBoards(keepIds);
    if (!removed) throw error;
    return operation();
  }
}

export async function isOfflineStorageAvailable() {
  try {
    await openDb();
    return true;
  } catch {
    return false;
  }
}

/** Best-effort persistent storage request (helps on Safari/iOS). */
export async function requestPersistentStorage() {
  if (persistenceRequested) return false;
  persistenceRequested = true;
  try {
    if (!navigator?.storage?.persist) return false;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function isNetworkError(error) {
  if (!error) return false;
  if (error.code === "NETWORK") return true;
  const message = String(error.message || error).toLowerCase();
  return (
    error instanceof TypeError ||
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("network request failed") ||
    message.includes("load failed") ||
    message.includes("network unavailable")
  );
}

export function isOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export async function cacheBoardList(userId, boards) {
  if (!userId) return;
  await withQuotaRetry(
    () =>
      withStore(STORE_META, "readwrite", (store) =>
        idbRequest(
          store.put({
            userId,
            boards: Array.isArray(boards) ? boards : [],
            cachedAt: Date.now()
          })
        )
      ),
    []
  );
}

export async function getCachedBoardList(userId) {
  if (!userId) return null;
  try {
    const row = await withStore(STORE_META, "readonly", (store) => idbRequest(store.get(userId)));
    return row?.boards || null;
  } catch {
    return null;
  }
}

export async function cacheBoard(board) {
  if (!board?.id) return;
  await withQuotaRetry(
    () =>
      withStore(STORE_BOARDS, "readwrite", (store) =>
        idbRequest(
          store.put({
            ...board,
            cachedAt: Date.now()
          })
        )
      ),
    [board.id]
  );
}

export async function getCachedBoard(boardId) {
  if (!boardId) return null;
  try {
    return await withStore(STORE_BOARDS, "readonly", (store) => idbRequest(store.get(boardId)));
  } catch {
    return null;
  }
}

export async function enqueueSave(boardId, payload, baseUpdatedAt = null) {
  if (!boardId) return;
  await withQuotaRetry(
    () =>
      withStore(STORE_PENDING, "readwrite", (store) =>
        idbRequest(
          store.put({
            boardId,
            title: payload.title,
            data: payload.data,
            queuedAt: Date.now(),
            baseUpdatedAt: baseUpdatedAt || null
          })
        )
      ),
    [boardId]
  );
  if (payload) {
    const existing = await getCachedBoard(boardId);
    await cacheBoard({
      ...(existing || { id: boardId }),
      id: boardId,
      title: payload.title,
      data: payload.data,
      updatedAt: new Date().toISOString(),
      pendingSync: true
    });
  }
}

export async function getPendingSaves() {
  try {
    return await withStore(STORE_PENDING, "readonly", (store) => idbRequest(store.getAll()));
  } catch {
    return [];
  }
}

export async function getPendingSave(boardId) {
  if (!boardId) return null;
  try {
    return await withStore(STORE_PENDING, "readonly", (store) => idbRequest(store.get(boardId)));
  } catch {
    return null;
  }
}

export async function clearPendingSave(boardId) {
  if (!boardId) return;
  await withStore(STORE_PENDING, "readwrite", (store) => idbRequest(store.delete(boardId)));
}

export async function countPendingSaves() {
  const pending = await getPendingSaves();
  return pending.length;
}

/**
 * Flush queued board saves. `updateBoard` should be the API function.
 * Returns { synced, failed }.
 */
export async function flushPendingSaves(updateBoard) {
  const pending = await getPendingSaves();
  const synced = [];
  const failed = [];

  for (const item of pending) {
    try {
      const response = await updateBoard(item.boardId, {
        title: item.title,
        data: item.data
      });
      await clearPendingSave(item.boardId);
      if (response?.board) {
        await cacheBoard({ ...response.board, pendingSync: false });
      }
      synced.push(item.boardId);
    } catch (error) {
      if (isNetworkError(error) || !isOnline()) {
        failed.push({ boardId: item.boardId, error });
        break;
      }
      failed.push({ boardId: item.boardId, error });
    }
  }

  return { synced, failed };
}
