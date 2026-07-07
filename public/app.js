const stage = document.querySelector("#stage");
const parts = document.querySelector("#parts");
const rulesEl = document.querySelector("#rules");
const ruleTemplate = document.querySelector("#ruleTemplate");
const statusEl = document.querySelector("#status");
const runButton = document.querySelector("#toggleRun");
const logPanel = document.querySelector("#logPanel");
const logList = document.querySelector("#logList");
const toggleLogButton = document.querySelector("#toggleLog");
const closeLogButton = document.querySelector("#closeLog");

const state = {
  assets: [],
  stageItems: [],
  rules: [],
  running: true,
  selectedId: null,
  log: []
};

let drag = null;
let nextId = 1;
let lastTick = 0;

const pieceSize = 58;
const tickMs = 360;
const tolerance = 34;

function uid(prefix) {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

function assetById(assetId) {
  return state.assets.find((asset) => asset.id === assetId);
}

function ruleLabel(ruleId) {
  return ruleId ? `#${ruleId.replace("rule-", "")}` : "?";
}

function sideLabel(side) {
  return side === "left" ? "まえ" : "あと";
}

const SHEET_URL = "https://script.google.com/macros/s/AKfycbwjRm6XyGYgSCwI-T53wEf88dXMsilZC-q59skQvW2m9hj65KLfLfiFRiVrSOJQDWo/exec";

function getUserId() {
  let userId = localStorage.getItem("newbiscuit_user_id");
  if (!userId) {
    userId = "ユーザー" + Math.floor(Math.random() * 900000 + 100000);
    localStorage.setItem("newbiscuit_user_id", userId);
  }
  return userId;
}

const USER_ID = getUserId();

function addLog(text) {
  const time = new Date().toLocaleTimeString("ja-JP", { hour12: false });
  state.log.push({ time, text });
  if (state.log.length > 500) state.log.shift();
  renderLog();
  fetch("/api/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ time, userId: USER_ID, text })
  }).catch(() => {});
}

function renderLog() {
  if (!logList) return;
  logList.innerHTML = state.log
    .slice()
    .reverse()
    .map((entry) => `<li><time>${entry.time}</time><span>${entry.text}</span></li>`)
    .join("");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rectPoint(container, clientX, clientY) {
  const rect = container.getBoundingClientRect();
  return {
    x: clamp(clientX - rect.left - pieceSize / 2, 0, rect.width - pieceSize),
    y: clamp(clientY - rect.top - pieceSize / 2, 0, rect.height - pieceSize)
  };
}

function makePiece(item, place) {
  const piece = document.createElement("div");
  const asset = assetById(item.assetId);
  piece.className = "piece";
  piece.dataset.id = item.id;
  piece.dataset.place = place;
  piece.style.left = `${item.x}px`;
  piece.style.top = `${item.y}px`;
  piece.innerHTML = `<img src="${asset.src}" alt="">`;
  if (item.id === state.selectedId) piece.classList.add("selected");
  piece.addEventListener("pointerdown", startPieceDrag);
  piece.addEventListener("dblclick", () => {
    if (place === "left" || place === "right") {
      const asset = assetById(item.assetId);
      addLog(`メガネ${ruleLabel(zoneRuleId(item.id, place))}の${sideLabel(place)}から「${asset?.name ?? item.assetId}」を消しました`);
    }
    removePiece(item.id, place);
  });
  return piece;
}

function drawParts() {
  parts.innerHTML = "";
  for (const asset of state.assets) {
    const part = document.createElement("button");
    part.className = "part";
    part.type = "button";
    part.dataset.assetId = asset.id;
    part.innerHTML = `<img src="${asset.src}" alt="${asset.name}">`;
    part.addEventListener("pointerdown", startAssetDrag);
    parts.append(part);
  }
}

function drawStage() {
  stage.innerHTML = "";
  for (const item of state.stageItems) stage.append(makePiece(item, "stage"));
}

function drawRules() {
  rulesEl.innerHTML = "";
  for (const rule of state.rules) {
    const node = ruleTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.ruleId = rule.id;
    node.querySelector(".delete-rule").addEventListener("click", () => {
      const names = [...rule.left, ...rule.right]
        .map((item) => assetById(item.assetId)?.name ?? item.assetId);
      addLog(`メガネ${ruleLabel(rule.id)}を消しました(中身: ${names.length ? names.join("、") : "なし"})`);
      state.rules = state.rules.filter((entry) => entry.id !== rule.id);
      drawRules();
    });

    const left = node.querySelector('[data-zone="left"]');
    const right = node.querySelector('[data-zone="right"]');
    left.dataset.ruleId = rule.id;
    right.dataset.ruleId = rule.id;

    for (const item of rule.left) left.append(makePiece(item, "left"));
    for (const item of rule.right) right.append(makePiece(item, "right"));
    rulesEl.append(node);
  }
}

function render() {
  drawStage();
  drawRules();
}

function zoneAt(clientX, clientY) {
  const zones = [...document.querySelectorAll(".drop-zone")];
  return zones.find((zone) => {
    const rect = zone.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  });
}

function clearHotZones() {
  document.querySelectorAll(".drop-zone.hot").forEach((zone) => zone.classList.remove("hot"));
}

function makeGhost(assetId, x, y) {
  const asset = assetById(assetId);
  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  ghost.innerHTML = `<img src="${asset.src}" alt="" style="width:76%;height:76%;object-fit:contain">`;
  document.body.append(ghost);
  moveGhost(ghost, x, y);
  return ghost;
}

function moveGhost(ghost, x, y) {
  ghost.style.transform = `translate(${x - 32}px, ${y - 32}px)`;
}

function startAssetDrag(event) {
  event.preventDefault();
  const assetId = event.currentTarget.dataset.assetId;
  drag = { kind: "asset", assetId, ghost: makeGhost(assetId, event.clientX, event.clientY) };
  window.addEventListener("pointermove", moveDrag);
  window.addEventListener("pointerup", endDrag, { once: true });
}

function startPieceDrag(event) {
  event.preventDefault();
  const id = event.currentTarget.dataset.id;
  const place = event.currentTarget.dataset.place;
  const item = findItem(id, place);
  if (!item) return;
  state.selectedId = id;
  const ruleId = event.currentTarget.closest(".lens")?.dataset.ruleId || null;
  drag = {
    kind: "piece",
    id,
    place,
    ruleId,
    originX: item.x,
    originY: item.y,
    assetId: item.assetId,
    ghost: makeGhost(item.assetId, event.clientX, event.clientY)
  };
  removePiece(id, place, false);
  render();
  window.addEventListener("pointermove", moveDrag);
  window.addEventListener("pointerup", endDrag, { once: true });
}

function moveDrag(event) {
  if (!drag) return;
  moveGhost(drag.ghost, event.clientX, event.clientY);
  clearHotZones();
  const zone = zoneAt(event.clientX, event.clientY);
  if (zone) zone.classList.add("hot");
}

function endDrag(event) {
  if (!drag) return;
  const zone = zoneAt(event.clientX, event.clientY);
  if (zone) {
    dropInto(zone, event.clientX, event.clientY);
  } else if (drag.kind === "piece" && (drag.place === "left" || drag.place === "right")) {
    const asset = assetById(drag.assetId);
    addLog(`メガネ${ruleLabel(drag.ruleId)}の${sideLabel(drag.place)}から「${asset?.name ?? drag.assetId}」を消しました`);
  }
  drag.ghost.remove();
  drag = null;
  clearHotZones();
  render();
  window.removeEventListener("pointermove", moveDrag);
}

function dropInto(zone, clientX, clientY) {
  const point = rectPoint(zone, clientX, clientY);
  const base = {
    id: drag.kind === "piece" ? drag.id : uid("piece"),
    assetId: drag.assetId,
    x: Math.round(point.x),
    y: Math.round(point.y)
  };

  if (zone.dataset.zone === "stage") {
    state.stageItems.push(base);
    return;
  }

  const rule = state.rules.find((entry) => entry.id === zone.dataset.ruleId);
  if (!rule) return;
  const side = zone.dataset.zone;
  rule[side].push(base);

  const asset = assetById(base.assetId);
  const name = asset?.name ?? base.assetId;
  if (drag.kind === "piece" && drag.place === side && drag.ruleId === rule.id) {
    addLog(`メガネ${ruleLabel(rule.id)}の${sideLabel(side)}で「${name}」を(${drag.originX}, ${drag.originY})から(${base.x}, ${base.y})へ動かしました`);
  } else {
    addLog(`メガネ${ruleLabel(rule.id)}の${sideLabel(side)}に「${name}」を入れました`);
  }
}

function findItem(id, place) {
  if (place === "stage") return state.stageItems.find((item) => item.id === id);
  for (const rule of state.rules) {
    const item = rule[place].find((entry) => entry.id === id);
    if (item) return item;
  }
  return null;
}

function zoneRuleId(id, place) {
  if (place !== "left" && place !== "right") return null;
  const rule = state.rules.find((entry) => entry[place].some((item) => item.id === id));
  return rule ? rule.id : null;
}

function removePiece(id, place, shouldRender = true) {
  if (place === "stage") state.stageItems = state.stageItems.filter((item) => item.id !== id);
  for (const rule of state.rules) {
    rule.left = rule.left.filter((item) => item.id !== id);
    rule.right = rule.right.filter((item) => item.id !== id);
  }
  if (shouldRender) render();
}

function addRule(rule = null) {
  state.rules.push(rule || { id: uid("rule"), left: [], right: [] });
  drawRules();
}

function normalized(items) {
  if (items.length === 0) return [];
  const origin = items[0];
  return items.map((item) => ({
    ...item,
    dx: item.x - origin.x,
    dy: item.y - origin.y
  }));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function findMatches(rule) {
  if (rule.left.length === 0 || state.stageItems.length === 0) return [];
  const pattern = normalized(rule.left);
  const matches = [];

  for (const anchor of state.stageItems.filter((item) => item.assetId === pattern[0].assetId)) {
    const chosen = [anchor];
    const used = new Set([anchor.id]);
    let ok = true;

    for (let i = 1; i < pattern.length; i += 1) {
      const want = {
        assetId: pattern[i].assetId,
        x: anchor.x + pattern[i].dx,
        y: anchor.y + pattern[i].dy
      };
      const candidate = state.stageItems
        .filter((item) => item.assetId === want.assetId && !used.has(item.id))
        .sort((a, b) => distance(a, want) - distance(b, want))[0];

      if (!candidate || distance(candidate, want) > tolerance) {
        ok = false;
        break;
      }
      chosen.push(candidate);
      used.add(candidate.id);
    }

    if (ok) matches.push({ rule, stageItems: chosen });
  }

  return matches;
}

function occurrenceKey(items, index) {
  const item = items[index];
  const count = items.slice(0, index + 1).filter((entry) => entry.assetId === item.assetId).length;
  return `${item.assetId}:${count}`;
}

function applyMatch(match) {
  const { rule, stageItems } = match;
  const left = normalized(rule.left);
  const right = normalized(rule.right);
  const anchor = stageItems[0];
  const byOccurrence = new Map();

  left.forEach((item, index) => {
    byOccurrence.set(occurrenceKey(left, index), stageItems[index]);
  });

  const next = state.stageItems.filter((item) => !stageItems.some((matched) => matched.id === item.id));

  right.forEach((item, index) => {
    const key = occurrenceKey(right, index);
    const existing = byOccurrence.get(key);
    next.push({
      id: existing?.id || uid("piece"),
      assetId: item.assetId,
      x: clamp(Math.round(anchor.x + item.dx), 0, stage.clientWidth - pieceSize),
      y: clamp(Math.round(anchor.y + item.dy), 0, stage.clientHeight - pieceSize)
    });
  });

  state.stageItems = next;
}

function selectSimultaneousMatches(matches) {
  const shuffled = matches.slice();
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const used = new Set();
  const selected = [];
  for (const match of shuffled) {
    if (match.stageItems.some((item) => used.has(item.id))) continue;
    match.stageItems.forEach((item) => used.add(item.id));
    selected.push(match);
  }
  return selected;
}

function step(time) {
  if (state.running && time - lastTick > tickMs) {
    const matches = state.rules.flatMap(findMatches);
    if (matches.length > 0) {
      const chosen = selectSimultaneousMatches(matches);
      for (const match of chosen) applyMatch(match);
      drawStage();
    }
    lastTick = time;
  }
  requestAnimationFrame(step);
}

function projectPayload() {
  return {
    stage: state.stageItems,
    rules: state.rules,
    parts: state.assets,
    createdAt: new Date().toISOString()
  };
}

async function saveProject() {
  const response = await fetch("/api/project", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(projectPayload())
  });
  if (!response.ok) throw new Error("save failed");
  statusEl.textContent = "保存しました";
}

async function loadProject() {
  const response = await fetch("/api/project");
  const data = await response.json();
  if (!data.project) {
    statusEl.textContent = "保存はまだありません";
    return;
  }
  state.stageItems = data.project.stage || [];
  state.rules = data.project.rules || [];
  state.selectedId = null;
  render();
  statusEl.textContent = "読み込みました";
}

async function init() {
  state.assets = await fetch("/api/images").then((res) => res.json());
  drawParts();
  addRule({
    id: uid("rule"),
    left: [{ id: uid("piece"), assetId: "star", x: 38, y: 38 }],
    right: [{ id: uid("piece"), assetId: "star", x: 62, y: 38 }]
  });
  requestAnimationFrame(step);
}

document.querySelector("#addRule").addEventListener("click", () => addRule());
document.querySelector("#clearStage").addEventListener("click", () => {
  state.stageItems = [];
  drawStage();
});
document.querySelector("#saveProject").addEventListener("click", () => saveProject().catch(() => {
  statusEl.textContent = "保存できませんでした";
}));
document.querySelector("#loadProject").addEventListener("click", () => loadProject().catch(() => {
  statusEl.textContent = "読み込めませんでした";
}));
runButton.addEventListener("click", () => {
  state.running = !state.running;
  runButton.textContent = state.running ? "とめる" : "うごかす";
  statusEl.textContent = state.running ? "うごいています" : "とまっています";
});
toggleLogButton.addEventListener("click", () => {
  logPanel.classList.toggle("hidden");
});
closeLogButton.addEventListener("click", () => {
  logPanel.classList.add("hidden");
});

init();
