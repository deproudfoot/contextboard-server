(function () {
  const API = "https://contextboard-api2.onrender.com";
  const COLORS = { post: "#4099f2", comment: "#40d940", reply: "#f2d933" };
  const NOISE =
    /^(like|likes|love|loved|reply|replies|share|comment|comments|send|follow|following|most relevant|newest|all comments|top comments|see more|hide|edited|just now|yesterday|today)$/i;
  const TIME = /^(\d+\s*[smhdwy]|\d+\s+(second|minute|hour|day|week|month|year)s?(\s+ago)?)$/i;
  const MORE = /^view( \d+)? more (comments|replies)$/i;
  const CAPTURE_SCRIPT =
    "(function(){var chrome=/^(like|likes|reply|replies|share|comment|comments|send|follow|following|most relevant|newest|all comments|top comments|see more|hide|edited)$/i;var more=/^view( \\d+)? more (comments|replies)$/i;var timeRe=/^(\\d+\\s*[smhdwy]|just now|yesterday|today|\\d+\\s+(second|minute|hour|day|week|month|year)s?(\\s+ago)?)$/i;function clean(value){return String(value||\"\").replace(/\\s+/g,\" \").trim();}function noise(value){return !value||chrome.test(value)||more.test(value)||timeRe.test(value);}var nodes=Array.prototype.slice.call(document.querySelectorAll('[role=\"article\"]'));var found=[];nodes.forEach(function(el){var label=el.getAttribute(\"aria-label\")||\"\";var author=\"\";var commentBy=label.match(/^Comment by (.+?)(?:\\s+\\d|\\s+yesterday|\\s+just now|$)/i);if(commentBy) author=clean(commentBy[1]);var link=el.querySelector('a[role=\"link\"]');if(!author&&link) author=clean(link.innerText).split(\"\\n\")[0];var nested=Array.prototype.slice.call(el.querySelectorAll('[role=\"article\"]'));var dirs=Array.prototype.slice.call(el.querySelectorAll('[dir=\"auto\"]')).filter(function(node){return !nested.some(function(child){return child.contains(node);});});var texts=dirs.map(function(node){return clean(node.innerText);}).filter(function(value){return value&&value!==author&&!noise(value);});texts.sort(function(a,b){return b.length-a.length;});var text=texts[0]||\"\";if(!text) return;var rect=el.getBoundingClientRect();if(rect.width<8||rect.height<8) return;found.push({author:author||\"Facebook\",text:text,left:rect.left,top:rect.top+window.scrollY,comment:!!commentBy});});found.sort(function(a,b){return a.top-b.top||a.left-b.left;});var unique=[];found.forEach(function(item){var dup=unique.some(function(prev){return prev.author===item.author&&prev.text===item.text;});if(!dup) unique.push(item);});if(!unique.length){alert(\"No post or comments were visible. Open the Facebook post, expand the comments, then capture again.\");return;}var base=Math.min.apply(null, unique.map(function(item){return item.left;}));var items=[];unique.forEach(function(item){var depth=item.left>base+36?1:0;var parentIndex=null;if(depth>0){for(var i=items.length-1;i>=0;i-=1){if((items[i].depth||0)<depth){parentIndex=i;break;}}}var role=depth>0?\"reply\":(item.comment?\"comment\":(items.length===0?\"post\":\"comment\"));items.push({author:item.author,text:item.text,role:role,parentIndex:parentIndex,depth:depth});});var payload={source:\"facebook\",url:location.href,items:items.map(function(item){return {author:item.author,text:item.text,role:item.role,parentIndex:item.parentIndex};})};var json=JSON.stringify(payload,null,2);var done=function(){alert(\"Captured \"+items.length+\" comments. Return to Contextboard, paste, and click Place tokens.\");};if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(json).then(done).catch(function(){window.prompt(\"Copy this thread\",json);});}else{window.prompt(\"Copy this thread\",json);}})();";
  const bookmarklet = "javascript:" + encodeURIComponent(CAPTURE_SCRIPT);

  function isNoise(line) {
    const text = String(line || "").trim();
    return !text || NOISE.test(text) || TIME.test(text) || MORE.test(text) || text === "·" || text === "•";
  }

  function looksLikeName(line) {
    const text = String(line || "").trim();
    if (text.length < 2 || text.length > 60) return false;
    if (/[.!?]$/.test(text) || text.split(/\s+/).length > 6 || /https?:\/\//i.test(text)) return false;
    return /^[\p{L}][\p{L}\p{M}'.\- ]+$/u.test(text);
  }

  function parsePlainThread(text) {
    const items = [];
    let current = null;
    const flush = () => {
      if (current && current.text.trim()) items.push(current);
      current = null;
    };
    String(text).split(/\r?\n/).forEach((line) => {
      const indent = line.match(/^[ \t]*/)[0].length;
      const trimmed = line.trim().replace(/^>\s?/, "");
      if (isNoise(trimmed)) return;
      const depth = indent >= 2 || line.trim().startsWith(">") ? 1 : 0;
      const named = trimmed.match(/^([^:]{2,60}):\s+(\S.*)$/);
      if (named && looksLikeName(named[1])) {
        flush();
        current = { author: named[1].trim(), text: named[2].trim(), role: depth ? "reply" : null, depth };
        return;
      }
      if (looksLikeName(trimmed) && (!current || current.text.trim())) {
        flush();
        current = { author: trimmed, text: "", role: depth ? "reply" : null, depth };
        return;
      }
      if (!current) {
        current = { author: "Facebook", text: trimmed, role: depth ? "reply" : null, depth };
        return;
      }
      current.text = current.text ? `${current.text}\n${trimmed}` : trimmed;
    });
    flush();
    return items.map((item, index) => ({
      author: item.author,
      text: item.text,
      role: item.role || (index === 0 ? "post" : item.depth ? "reply" : "comment"),
      parentIndex: index === 0 ? null : item.depth ? Math.max(0, index - 1) : 0
    }));
  }

  function parseFacebookThread(raw) {
    const text = String(raw || "").replace(/^\uFEFF/, "").trim();
    if (!text) return { error: "Paste a captured thread first." };
    if (/facebook\.com\/\S+/i.test(text) || /fb\.watch\//i.test(text)) {
      if (!text.includes("\n") && !text.startsWith("{")) {
        return { error: "A Facebook link does not include the comments. Capture the post, or paste the comment text." };
      }
    }
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        const data = JSON.parse(text);
        const source = Array.isArray(data) ? { items: data } : data;
        const items = (source.items || [])
          .map((item, index) => ({
            author: String(item.author || "Facebook").trim() || "Facebook",
            text: String(item.text || item.message || "").trim(),
            role: item.role || (index === 0 ? "post" : "comment"),
            parentIndex: Number.isInteger(item.parentIndex) ? item.parentIndex : index === 0 ? null : 0
          }))
          .filter((item) => item.text);
        if (!items.length) return { error: "That capture did not include any comment text." };
        return { items, url: source.url || null };
      } catch {
        return { error: "That capture is not valid JSON." };
      }
    }
    const items = parsePlainThread(text);
    if (!items.length) return { error: "No separate comments were found in that paste." };
    return { items, url: null };
  }

  function threadToHexagons(items, startNumber, originX, originY, url) {
    const ids = items.map(() => crypto.randomUUID());
    return items.map((item, index) => {
      const hex = {
        id: ids[index],
        number: startNumber + index,
        x: Math.round((originX + (item.role === "reply" ? 90 : 0)) / 20) * 20,
        y: Math.round((originY + index * 90) / 20) * 20,
        text: item.text,
        fillColor: COLORS[item.role] || COLORS.comment,
        connections: [],
        content: {
          type: "text",
          value: item.text,
          source: "facebook",
          role: item.role,
          author: item.author,
          url: item.url || url
        }
      };
      return hex;
    }).map((hex, index, hexagons) => {
      const parentIndex = items[index].parentIndex;
      if (parentIndex != null && hexagons[parentIndex]) {
        hexagons[parentIndex].connections = [...(hexagons[parentIndex].connections || []), hex.id];
      }
      return hex;
    });
  }

  function style() {
    const css = document.createElement("style");
    css.textContent = `
      #capture-thread-button{position:fixed;top:16px;left:16px;z-index:2147483647;background:#1877f2;color:#fff;font-size:20px;font-weight:800;font-family:Inter,system-ui,sans-serif;padding:14px 18px;border:3px solid #fff;border-radius:12px;cursor:pointer;box-shadow:0 10px 28px rgba(15,23,42,.35)}
      #capture-thread-modal{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:24px}
      #capture-thread-modal .sheet{width:min(720px,96vw);max-height:88vh;overflow:auto;background:#fff;border-radius:16px;padding:20px;font-family:Inter,system-ui,sans-serif;color:#0f172a}
      #capture-thread-modal textarea{width:100%;min-height:120px;margin:8px 0;padding:10px;border:1px solid #cbd5f5;border-radius:10px}
      #capture-thread-modal button{margin-right:8px;margin-top:8px;padding:10px 14px;border-radius:10px;border:1px solid #cbd5f5;background:#fff;cursor:pointer;font-weight:600}
      #thread-preview{display:grid;gap:8px;margin:12px 0}
      #thread-preview .token{display:grid;grid-template-columns:72px 1fr;gap:8px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc}
      #thread-preview .role{font-size:11px;font-weight:800;text-transform:uppercase;color:#475569}
    `;
    document.head.appendChild(css);
  }

  function renderPreview(modal) {
    const parsed = parseFacebookThread(modal.querySelector("#thread-paste").value);
    const box = modal.querySelector("#thread-preview");
    const status = modal.querySelector("#thread-status");
    if (parsed.error) {
      box.innerHTML = "";
      status.textContent = parsed.error;
      modal.querySelector("#place-tokens").disabled = true;
      return;
    }
    status.textContent = `${parsed.items.length} separate tokens ready: one for each post, comment, or reply.`;
    box.innerHTML = parsed.items
      .map(
        (item) =>
          `<div class="token"><div class="role">${item.role}</div><div><strong>${item.author}</strong><div>${item.text}</div></div></div>`
      )
      .join("");
    modal.querySelector("#place-tokens").disabled = false;
  }

  function openModal() {
    if (document.getElementById("capture-thread-modal")) return;
    const modal = document.createElement("div");
    modal.id = "capture-thread-modal";
    modal.innerHTML = `
      <div class="sheet">
        <h2>Capture a Facebook thread</h2>
        <ol>
          <li>Click Copy bookmark address.</li>
          <li>On your Mac, press Command-Shift-B to show the bookmarks bar under the address field.</li>
          <li>Control-click that bar, or two-finger click it, and choose Add Page.</li>
          <li>Name it Capture thread. Paste into the address field. Click Save.</li>
          <li>Open the Facebook post, expand the comments, then click Capture thread on the bookmarks bar.</li>
          <li>Paste here. Each comment becomes its own token on the board.</li>
        </ol>
        <button type="button" id="copy-bookmark">Copy bookmark address</button>
        <button type="button" id="read-clipboard">Read clipboard</button>
        <textarea id="thread-paste" placeholder="Paste the captured thread. Each comment will become its own token."></textarea>
        <div id="thread-status"></div>
        <div id="thread-preview"></div>
        <button type="button" id="place-tokens" disabled>Place tokens on the board</button>
        <button type="button" id="close-thread">Close</button>
      </div>
    `;
    modal.addEventListener("click", (event) => {
      if (event.target === modal) modal.remove();
    });
    document.body.appendChild(modal);
    modal.querySelector("#close-thread").onclick = () => modal.remove();
    modal.querySelector("#thread-paste").oninput = () => renderPreview(modal);
    modal.querySelector("#copy-bookmark").onclick = async () => {
      try {
        await navigator.clipboard.writeText(bookmarklet);
        modal.querySelector("#thread-status").textContent = "Bookmark address copied. Add it from the bookmarks bar.";
      } catch {
        modal.querySelector("#thread-status").textContent = bookmarklet;
      }
    };
    modal.querySelector("#read-clipboard").onclick = async () => {
      try {
        modal.querySelector("#thread-paste").value = (await navigator.clipboard.readText()) || "";
        renderPreview(modal);
      } catch {
        modal.querySelector("#thread-status").textContent = "Clipboard was blocked. Paste the thread into the box.";
      }
    };
    modal.querySelector("#place-tokens").onclick = () => placeTokens(modal);
  }

  function pickBoard(boards) {
    const title = document.querySelector(".title-input, input.title-input")?.value?.trim();
    if (title) {
      const match = boards.find((board) => (board.title || "") === title);
      if (match) return match;
    }
    return boards[0];
  }

  async function placeTokens(modal) {
    const parsed = parseFacebookThread(modal.querySelector("#thread-paste").value);
    const status = modal.querySelector("#thread-status");
    if (parsed.error) {
      status.textContent = parsed.error;
      return;
    }
    const token = localStorage.getItem("contextboard_token");
    if (!token) {
      status.textContent = "Sign in, open a board, then place the tokens.";
      return;
    }
    try {
      const list = await fetch(`${API}/boards`, { headers: { Authorization: `Bearer ${token}` } });
      if (!list.ok) throw new Error("Could not read boards.");
      const boards = (await list.json()).boards || [];
      if (!boards.length) throw new Error("Create or open a board first.");
      const board = pickBoard(boards);
      const current = await fetch(`${API}/boards/${board.id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!current.ok) throw new Error("Could not open the board.");
      const detail = await current.json();
      const data = detail.board?.data || { hexagons: [] };
      const existing = data.hexagons || [];
      const startNumber = Math.max(0, ...existing.map((hex) => hex.number || 0)) + 1;
      const maxX = existing.length ? Math.max(...existing.map((hex) => hex.x || 0)) : 0;
      const minY = existing.length ? Math.min(...existing.map((hex) => hex.y || 0)) : 0;
      const created = threadToHexagons(
        parsed.items,
        startNumber,
        existing.length ? maxX + 120 : 80,
        existing.length ? minY : 80,
        parsed.url
      );
      const next = { ...data, hexagons: [...existing, ...created] };
      const saved = await fetch(`${API}/boards/${board.id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title: detail.board?.title, data: next })
      });
      if (!saved.ok) throw new Error("Could not save the tokens.");
      status.textContent = `Placed ${created.length} tokens on ${detail.board?.title || "the board"}. Opening them now.`;
      window.dispatchEvent(new CustomEvent("contextboard:thread-tokens", { detail: created }));
      window.location.reload();
    } catch (error) {
      status.textContent = error.message || "Could not place the tokens.";
    }
  }

  function start() {
    style();
    const button = document.createElement("button");
    button.id = "capture-thread-button";
    button.type = "button";
    button.textContent = "Capture thread";
    button.onclick = openModal;
    document.body.appendChild(button);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
