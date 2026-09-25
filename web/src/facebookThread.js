const NOISE_PATTERNS = [
  /^(like|likes|reply|replies|share|comment|comments|send|follow|following|most relevant|newest|all comments|top comments)$/i,
  /^see more$/i,
  /^hide$/i,
  /^view( \d+)? more (comments|replies)$/i,
  /^write a comment/i,
  /^\d+\s*(like|likes|reply|replies|comment|comments)$/i,
  /^\d+\s*[smhdwy]$/i,
  /^(just now|yesterday|today)$/i,
  /^\d+\s+(second|minute|hour|day|week|month|year)s?(\s+ago)?$/i,
  /^(edited)$/i,
  /^[·•]$/
];

const FACEBOOK_URL =
  /^https?:\/\/((www|m|web|mbasic)\.)?facebook\.com\/\S+$/i;
const FB_WATCH_URL = /^https?:\/\/fb\.watch\/\S+$/i;

const COLORS = {
  post: "#4099f2",
  comment: "#40d940",
  reply: "#f2d933"
};

export function isNoiseLine(line) {
  const text = String(line || "").trim();
  if (!text) return true;
  return NOISE_PATTERNS.some((pattern) => pattern.test(text));
}

export function looksLikeName(line) {
  const text = String(line || "").trim();
  if (text.length < 2 || text.length > 60) return false;
  if (/[.!?]$/.test(text)) return false;
  if (text.split(/\s+/).length > 6) return false;
  if (/https?:\/\//i.test(text)) return false;
  return /^[\p{L}][\p{L}\p{M}'.\- ]+$/u.test(text);
}

function isFacebookUrl(text) {
  return FACEBOOK_URL.test(text) || FB_WATCH_URL.test(text);
}

function normalizeRole(role, index, depth) {
  if (role === "post" || role === "comment" || role === "reply") return role;
  if (depth > 0) return "reply";
  if (index === 0) return "post";
  return "comment";
}

function cleanItems(items) {
  const kept = [];
  const indexMap = new Map();
  items.forEach((item, index) => {
    const text = String(item?.text || "").trim();
    if (!text) return;
    indexMap.set(index, kept.length);
    kept.push({ ...item, text });
  });
  return kept.map((item, index) => {
    const depth = Number.isFinite(item.depth) ? item.depth : 0;
    const mappedParent = indexMap.has(item.parentIndex) ? indexMap.get(item.parentIndex) : null;
    const role = normalizeRole(item.role, index, depth);
    const parentIndex = role === "post" ? null : mappedParent;
    return {
      author: String(item.author || "Facebook").trim() || "Facebook",
      text: item.text,
      role,
      parentIndex: role === "reply" || depth > 0 ? parentIndex : role === "comment" ? parentIndex : null,
      url: item.url || null
    };
  });
}

export function parseFacebookThread(raw) {
  const text = String(raw || "").replace(/^\uFEFF/, "").trim();
  if (!text) {
    return { error: "Paste a captured thread first." };
  }
  if (isFacebookUrl(text)) {
    return {
      error:
        "A Facebook link does not include the comments. Open the post, expand the thread, then use Capture thread and paste the result here. You can also paste comment text you copied from the post."
    };
  }
  if (text.startsWith("{") || text.startsWith("[")) {
    return parseCapturedJson(text);
  }
  const items = parsePlainThread(text);
  if (!items.length) {
    return { error: "No comments were found in that paste." };
  }
  return { items, url: null };
}

function parseCapturedJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "That capture is not valid JSON. Copy it again from the Facebook post." };
  }
  const source = Array.isArray(data) ? { items: data } : data;
  if (!source || !Array.isArray(source.items)) {
    return { error: "That capture has no thread items." };
  }
  const items = cleanItems(
    source.items.map((item) => ({
      author: item?.author,
      text: item?.text || item?.message || "",
      role: item?.role,
      parentIndex: item?.parentIndex,
      depth: item?.depth,
      url: item?.url || null
    }))
  );
  if (!items.length) {
    return { error: "That capture did not include any comment text." };
  }
  return { items, url: typeof source.url === "string" ? source.url : null };
}

function parsePlainThread(text) {
  const lines = text.split(/\r?\n/);
  const rough = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    const body = current.text.trim();
    if (body) {
      rough.push({
        author: current.author,
        text: body,
        depth: current.depth,
        role: current.role
      });
    }
    current = null;
  };

  lines.forEach((line) => {
    const indent = line.match(/^[ \t]*/)[0].length;
    const trimmed = line.trim().replace(/^>\s?/, "");
    if (!trimmed || isNoiseLine(trimmed)) return;
    const depth = indent >= 2 || line.trim().startsWith(">") ? 1 : 0;
    const named = trimmed.match(/^([^:]{2,60}):\s+(\S.*)$/);
    if (named && looksLikeName(named[1])) {
      flush();
      current = {
        author: named[1].trim(),
        text: named[2].trim(),
        depth,
        role: depth > 0 ? "reply" : null
      };
      return;
    }
    if (looksLikeName(trimmed) && (!current || current.text.trim())) {
      flush();
      current = { author: trimmed, text: "", depth, role: depth > 0 ? "reply" : null };
      return;
    }
    if (!current) {
      current = { author: "Facebook", text: trimmed, depth, role: depth > 0 ? "reply" : null };
      return;
    }
    current.text = current.text ? `${current.text}\n${trimmed}` : trimmed;
    if (depth > current.depth) current.depth = depth;
  });
  flush();

  let lastTop = null;
  return cleanItems(
    rough.map((item, index) => {
      let parentIndex = null;
      if (item.depth > 0 && lastTop !== null) parentIndex = lastTop;
      const role = item.role || (index === 0 && item.depth === 0 ? "post" : item.depth > 0 ? "reply" : "comment");
      const next = { ...item, role, parentIndex };
      if (role !== "reply") lastTop = index;
      return next;
    })
  );
}

export function threadToHexagons(items, options = {}) {
  const hexRadius = options.hexRadius ?? 36;
  const snapSize = options.snapSize ?? 20;
  const originX = options.originX ?? 0;
  const originY = options.originY ?? 0;
  const startNumber = options.startNumber ?? 1;
  const createId = options.createId || (() => crypto.randomUUID());
  const threadUrl = options.url || null;
  const spacingX = Math.round((hexRadius * Math.sqrt(3) + 16) / snapSize) * snapSize;
  const spacingY = Math.round((hexRadius * 2 + 18) / snapSize) * snapSize;
  const ids = items.map(() => createId());
  let row = 0;
  const depths = items.map((item) => (item.role === "reply" ? 1 : 0));

  const hexagons = items.map((item, index) => {
    const depth = depths[index];
    const x = Math.round((originX + depth * spacingX) / snapSize) * snapSize;
    const y = Math.round((originY + row * spacingY) / snapSize) * snapSize;
    row += 1;
    const body = `${item.author}\n\n${item.text}`;
    return {
      id: ids[index],
      number: startNumber + index,
      x,
      y,
      text: item.author,
      fillColor: COLORS[item.role] || COLORS.comment,
      connections: [],
      content: {
        type: "text",
        value: body,
        source: "facebook",
        role: item.role,
        author: item.author,
        url: item.url || threadUrl
      }
    };
  });

  items.forEach((item, index) => {
    if (item.parentIndex === null || item.parentIndex === undefined) return;
    const parent = hexagons[item.parentIndex];
    if (!parent) return;
    parent.connections = [...(parent.connections || []), ids[index]];
  });

  return hexagons;
}

export function summarizeThread(items) {
  const counts = { post: 0, comment: 0, reply: 0 };
  items.forEach((item) => {
    counts[item.role] = (counts[item.role] || 0) + 1;
  });
  return counts;
}

const CAPTURE_SCRIPT = `(function(){
  var chrome=/^(like|likes|reply|replies|share|comment|comments|send|follow|following|most relevant|newest|all comments|top comments|see more|hide|edited)$/i;
  var more=/^view( \\d+)? more (comments|replies)$/i;
  var timeRe=/^(\\d+\\s*[smhdwy]|just now|yesterday|today|\\d+\\s+(second|minute|hour|day|week|month|year)s?(\\s+ago)?)$/i;
  function clean(value){return String(value||"").replace(/\\s+/g," ").trim();}
  function noise(value){return !value||chrome.test(value)||more.test(value)||timeRe.test(value);}
  var nodes=Array.prototype.slice.call(document.querySelectorAll('[role="article"]'));
  var found=[];
  nodes.forEach(function(el){
    var label=el.getAttribute("aria-label")||"";
    var author="";
    var commentBy=label.match(/^Comment by (.+?)(?:\\s+\\d|\\s+yesterday|\\s+just now|$)/i);
    if(commentBy) author=clean(commentBy[1]);
    var link=el.querySelector('a[role="link"]');
    if(!author&&link) author=clean(link.innerText).split("\\n")[0];
    var nested=Array.prototype.slice.call(el.querySelectorAll('[role="article"]'));
    var dirs=Array.prototype.slice.call(el.querySelectorAll('[dir="auto"]')).filter(function(node){
      return !nested.some(function(child){return child.contains(node);});
    });
    var texts=dirs.map(function(node){return clean(node.innerText);}).filter(function(value){
      return value&&value!==author&&!noise(value);
    });
    texts.sort(function(a,b){return b.length-a.length;});
    var text=texts[0]||"";
    if(!text) return;
    var rect=el.getBoundingClientRect();
    if(rect.width<8||rect.height<8) return;
    found.push({author:author||"Facebook",text:text,left:rect.left,top:rect.top+window.scrollY,comment:!!commentBy});
  });
  found.sort(function(a,b){return a.top-b.top||a.left-b.left;});
  var unique=[];
  found.forEach(function(item){
    var dup=unique.some(function(prev){return prev.author===item.author&&prev.text===item.text;});
    if(!dup) unique.push(item);
  });
  if(!unique.length){
    alert("No post or comments were visible. Open the Facebook post, expand the comments, then capture again.");
    return;
  }
  var base=Math.min.apply(null, unique.map(function(item){return item.left;}));
  var items=[];
  unique.forEach(function(item){
    var depth=item.left>base+36?1:0;
    var parentIndex=null;
    if(depth>0){
      for(var i=items.length-1;i>=0;i-=1){
        if((items[i].depth||0)<depth){parentIndex=i;break;}
      }
    }
    var role=depth>0?"reply":(item.comment?"comment":(items.length===0?"post":"comment"));
    items.push({author:item.author,text:item.text,role:role,parentIndex:parentIndex,depth:depth});
  });
  var payload={source:"facebook",url:location.href,items:items.map(function(item){
    return {author:item.author,text:item.text,role:item.role,parentIndex:item.parentIndex};
  })};
  var json=JSON.stringify(payload,null,2);
  var done=function(){alert("Captured "+items.length+" tokens. Return to Contextboard and paste them.");};
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(json).then(done).catch(function(){window.prompt("Copy this thread",json);});
  }else{
    window.prompt("Copy this thread",json);
  }
})();`;

export function facebookCaptureBookmarklet() {
  return `javascript:${encodeURIComponent(CAPTURE_SCRIPT)}`;
}
