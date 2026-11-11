/* Zui Dee – engine dùng chung cho HỌC ĐẠI ĐI & LÀM ĐẠI ĐI
   Hai chế độ: chơi chung 1 máy (local) và phòng online (host / client qua PeerJS – WebRTC). */
(() => {
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const COLORS = ["#FB5231", "#7280ED", "#3BB54A", "#EC138C", "#F9A825", "#1B475D"];
const SAVE_KEY = "zuidee_save_v1";      // ván 1 máy
const HOST_KEY = "zuidee_host_v1";      // phòng do mình làm chủ
const CLIENT_KEY = "zuidee_client_v1";  // phòng mình đã vào
const PEER_PREFIX = "zuidee-v1-";
const VETO_MS = 7000;
const PEERJS_URL = "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js";
const QR_URL = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";

let G = null;        // config game
let S = null;        // state ván (host/local: đầy đủ; client: bản đã che bài người khác)
let MODE = "local";  // local | host | client
let ME = null;       // id người chơi của máy này (online)
let selBettor = null;
let soundOn = true, actx = null;
let timerEnd = 0, timerIv = null, timerLabel = "";
let pendIv = null, pendTimeout = null, pendDeadline = 0;
let animating = false;

/* ---------------- tiện ích ---------------- */
const A = p => `assets/${G.id}/${p}.webp`;
const card = id => G.challenges.find(c => c.id === id) || G.specials.find(c => c.id === id);
const P = id => S.players.find(p => p.id === id);
const alive = () => S.players.filter(p => p.alive);
const nameOf = id => esc(P(id)?.name || "?");
const dot = p => `<span class="av" style="background:${p.color}"></span>`;
const tokImg = () => `assets/${G.id}/token.webp`;
const online = () => MODE !== "local";
const isHost = () => MODE !== "client";            // local cũng có toàn quyền
const canControl = () => MODE === "local" || MODE === "host";
const rnd6 = () => 1 + Math.floor(Math.random() * 6);
const ls = { get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
const randCode = () => Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
const randTok = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

function beep(f = 520, d = .12, type = "square", v = .06) {
  if (!soundOn) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = f; g.gain.value = v;
    o.connect(g); g.connect(actx.destination); o.start();
    g.gain.exponentialRampToValueAtTime(.0001, actx.currentTime + d); o.stop(actx.currentTime + d);
  } catch (e) {}
}
const jingle = () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, .15, "triangle", .08), i * 110));
const buzz = () => beep(140, .5, "sawtooth", .09);

function toast(msg, ms = 2600) {
  const t = document.createElement("div"); t.className = "toast"; t.innerHTML = msg;
  $("#toast").appendChild(t); setTimeout(() => t.remove(), ms);
}
function log(msg) { S.log.unshift(msg); if (S.log.length > 80) S.log.pop(); }
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}

/* ---------------- modal ---------------- */
function modal({ title, body, buttons = [], close = true, wide = false, cls = "" }) {
  const m = document.createElement("div"); m.className = "mask " + cls;
  m.innerHTML = `<div class="modal" style="${wide ? "max-width:900px" : ""}"><div class="mh"><h3 class="disp">${title}</h3>${close ? '<button class="xbtn" data-x>✕</button>' : ""}</div><div class="mb"></div><div class="mf"></div></div>`;
  const mb = $(".mb", m); if (typeof body === "string") mb.innerHTML = body; else if (body) mb.appendChild(body);
  const mf = $(".mf", m);
  const closeIt = () => m.remove();
  buttons.forEach(b => {
    const el = document.createElement("button"); el.className = "btn " + (b.cls || ""); el.innerHTML = b.label;
    if (b.disabled) el.disabled = true;
    el.onclick = () => { if (b.keep !== true) closeIt(); b.onClick && b.onClick(); };
    mf.appendChild(el);
  });
  if (!buttons.length) mf.remove();
  if (close) { $("[data-x]", m).onclick = closeIt; m.addEventListener("click", e => { if (e.target === m) closeIt(); }); }
  $("#modalRoot").appendChild(m);
  return { el: m, close: closeIt, body: mb };
}
function pickPlayer(title, ids, cb, note = "") {
  const box = document.createElement("div");
  box.innerHTML = (note ? `<p>${note}</p>` : "") + `<div class="pickers">${ids.map(id => { const p = P(id); return `<button class="pick" data-id="${id}">${dot(p)}${esc(p.name)}</button>`; }).join("")}</div>`;
  const md = modal({ title, body: box });
  box.querySelectorAll(".pick").forEach(b => b.onclick = () => { md.close(); cb(b.dataset.id); });
}

/* ---------------- màn hình ---------------- */
const SECTIONS = ["home", "setup", "lobby", "game"];
function show(id) {
  SECTIONS.forEach(s => $("#" + s).classList.toggle("hidden", s !== id));
  document.body.className = (id === "home" || !G) ? "t-home" : "t-" + G.id;
  window.scrollTo(0, 0);
}

/* ================= HOME ================= */
function renderHome() {
  leaveNet();
  G = null; S = null; MODE = "local"; ME = null;
  show("home");
  const rb = $("#resumeBox"); const items = [];
  const saved = ls.get(SAVE_KEY);
  if (saved && saved.s && saved.s.phase !== "over") items.push(`<div class="resume-row"><div><b>Ván 1 máy đang dở:</b> ${esc(GAMES[saved.g].title)} – lượt ${saved.s.turn}</div><div class="rbtns"><button class="btn sm green" data-r="local">▶ Chơi tiếp</button><button class="btn sm ghost" data-d="local">Bỏ</button></div></div>`);
  const hs = ls.get(HOST_KEY);
  if (hs && hs.code) items.push(`<div class="resume-row"><div><b>Phòng bạn làm chủ:</b> ${esc(hs.code)} – ${esc(GAMES[hs.g].title)}${hs.s ? ` (lượt ${hs.s.turn})` : " (đang chờ)"}</div><div class="rbtns"><button class="btn sm green" data-r="host">▶ Mở lại phòng</button><button class="btn sm ghost" data-d="host">Đóng phòng</button></div></div>`);
  const cs = ls.get(CLIENT_KEY);
  if (cs && cs.code) items.push(`<div class="resume-row"><div><b>Phòng đã vào:</b> ${esc(cs.code)} – tên “${esc(cs.name)}”</div><div class="rbtns"><button class="btn sm green" data-r="client">▶ Vào lại</button><button class="btn sm ghost" data-d="client">Quên</button></div></div>`);
  rb.classList.toggle("hidden", !items.length);
  rb.innerHTML = items.join("");
  rb.querySelectorAll("[data-r]").forEach(b => b.onclick = () => {
    const k = b.dataset.r;
    if (k === "local") { G = GAMES[saved.g]; S = saved.s; MODE = "local"; if (S.phase === "rolling-tmp") { S.phase = "bet"; S.dice = []; } show("game"); renderGame(); }
    if (k === "host") resumeHost(hs);
    if (k === "client") joinRoom(cs.code, cs.name);
  });
  rb.querySelectorAll("[data-d]").forEach(b => b.onclick = () => { ls.del({ local: SAVE_KEY, host: HOST_KEY, client: CLIENT_KEY }[b.dataset.d]); renderHome(); });
  const ji = $("#joinCode"), jn = $("#joinName");
  if (cs && cs.name && !jn.value) jn.value = cs.name;
  $("#joinBtn").onclick = () => {
    const code = ji.value.trim().toUpperCase(), name = jn.value.trim();
    if (code.length < 4) { toast("Nhập mã phòng 4 ký tự nhé!"); ji.focus(); return; }
    if (!name) { toast("Nhập tên của bạn nhé!"); jn.focus(); return; }
    joinRoom(code, name);
  };
}

/* ================= SETUP ================= */
let setupN = 4, setupNames = [], setupFirst = 0, setupMode = "local", hostName = "";
function renderSetup() {
  show("setup");
  const el = $("#setup");
  while (setupNames.length < 6) setupNames.push("");
  const strip = G.id === "hdd" ? `<div class="strip" style="background-image:url(${A("strip_a1")})"></div>` : `<div class="strip"></div>`;
  el.innerHTML = `<div class="panel setup-box">
    <div class="setup-hero"><img src="${A("logo")}" alt=""></div>${strip}
    <div class="setup-body">
      <div class="tabs">
        <button class="tab ${setupMode === "local" ? "on" : ""}" data-m="local">📱 Chơi chung 1 máy</button>
        <button class="tab ${setupMode === "online" ? "on" : ""}" data-m="online">🌐 Tạo phòng mời bạn</button>
      </div>
      ${setupMode === "local" ? `
      <h2 class="disp">Thiết lập ván chơi</h2>
      <div class="hint">${esc(G.audience)}. Mỗi người nhận <b>${G.startTokens} ${G.token}</b> + <b>1 ${G.special}</b> ngẫu nhiên; Token còn lại vào <b>${G.bank}</b>.</div>
      <div style="margin-top:14px;font-weight:800">Số người chơi</div>
      <div class="count-row">${[2, 3, 4, 5, 6].map(n => `<button class="btn ${n === setupN ? "on" : ""}" data-n="${n}">${n}</button>`).join("")}</div>
      <div style="font-weight:800;margin-bottom:6px">Tên người chơi <span class="hint">(chọn 🎲 = người cầm cái đầu tiên)</span></div>
      <div class="name-list">${Array.from({ length: setupN }, (_, i) => `
        <div class="name-row"><span class="dot" style="background:${COLORS[i]}"></span>
        <input maxlength="14" data-i="${i}" placeholder="${G.id === "hdd" ? "Sinh viên" : "Đồng nghiệp"} ${i + 1}" value="${esc(setupNames[i])}">
        <label><input type="radio" name="first" value="${i}" ${i === setupFirst ? "checked" : ""}>🎲</label></div>`).join("")}
      </div>
      <p class="hint">👉 ${esc(G.firstDealer)}.</p>
      <div class="setup-foot">
        <button class="btn ghost" id="backHome">← Đổi game</button>
        <button class="btn" id="seeRules">📖 Luật chơi</button><span style="flex:1"></span>
        <button class="btn big pink" id="startBtn">Bắt đầu ván! ▶</button>
      </div>` : `
      <h2 class="disp">Tạo phòng online</h2>
      <div class="hint">Mỗi người chơi trên <b>điện thoại của mình</b>: bài ${esc(G.special)} được giữ <b>bí mật</b>, chỉ <b>chủ phòng</b> mới được lắc xúc xắc, rút thẻ, xử phạt và qua lượt. Mọi người tự đặt cược và tự tung thẻ trên máy mình.</div>
      <div style="margin-top:14px;font-weight:800">Tên của bạn (chủ phòng)</div>
      <div class="name-row" style="margin-top:6px"><span class="dot" style="background:${COLORS[0]}"></span><input id="hostName" maxlength="14" placeholder="VD: Nhân" value="${esc(hostName)}"></div>
      <p class="hint">📶 Mẹo: cả nhóm dùng chung 1 mạng wifi sẽ kết nối ổn định nhất.</p>
      <div class="setup-foot">
        <button class="btn ghost" id="backHome">← Đổi game</button>
        <button class="btn" id="seeRules">📖 Luật chơi</button><span style="flex:1"></span>
        <button class="btn big pink" id="createRoom">Tạo phòng ▶</button>
      </div>`}
    </div></div>`;
  el.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { setupMode = b.dataset.m; renderSetup(); });
  el.querySelectorAll("[data-n]").forEach(b => b.onclick = () => { setupN = +b.dataset.n; if (setupFirst >= setupN) setupFirst = 0; renderSetup(); });
  el.querySelectorAll("input[data-i]").forEach(inp => inp.oninput = () => setupNames[+inp.dataset.i] = inp.value);
  el.querySelectorAll("input[name=first]").forEach(r => r.onchange = () => setupFirst = +r.value);
  $("#backHome").onclick = renderHome;
  $("#seeRules").onclick = showRules;
  if ($("#startBtn")) $("#startBtn").onclick = () => {
    MODE = "local"; ME = null;
    const tag = G.id === "hdd" ? "Sinh viên" : "Đồng nghiệp";
    newGame(Array.from({ length: setupN }, (_, i) => ({ id: "p" + i, name: (setupNames[i] || "").trim() || `${tag} ${i + 1}` })), "p" + setupFirst);
  };
  if ($("#hostName")) {
    $("#hostName").oninput = e => hostName = e.target.value;
    $("#createRoom").onclick = () => { if (!hostName.trim()) { toast("Nhập tên của bạn nhé!"); $("#hostName").focus(); return; } createRoom(hostName.trim()); };
  }
}

function newGame(list, firstDealer) {
  const sDeck = shuffle(G.specials.map(c => c.id));
  const players = list.map((x, i) => ({
    id: x.id, name: x.name, color: COLORS[i], tokens: G.startTokens, marks: 0, hand: [sDeck.pop()], alive: true, flags: {}
  }));
  S = {
    players, bank: G.totalTokens - G.startTokens * players.length,
    challengeDeck: shuffle(G.challenges.map(c => c.id)), specialDeck: sDeck, specialDiscard: [],
    turn: 1, dealer: firstDealer, phase: "bet", bets: {}, dice: [], lost: {}, returned: {},
    results: null, cur: null, pend: null, log: [], winner: null
  };
  players.forEach(p => S.bets[p.id] = {});
  log(`🎬 Ván mới bắt đầu! ${nameOf(S.dealer)} cầm cái đầu tiên.`);
  selBettor = null;
  show("game"); renderGame(); emitFx({ fx: "sfx", k: "jingle" });
}

/* ================= LUẬT ================= */
function showRules() {
  const t = G;
  const html = `<div class="rules">
  <h4>🎯 Mục tiêu</h4>
  <ul><li>Đừng để dính đủ <b>3 ${t.mark}</b> – nếu không sẽ bị <b>“${t.elim}”</b>.</li>
  <li>Thắng khi là người <b>duy nhất còn trụ lại</b>, HOẶC <b>giàu ${t.token} nhất</b> khi xấp ${t.challenge} bị rút hết → <b>“${t.win}”</b>.</li></ul>
  <h4>🧩 Thiết lập (5 giây)</h4>
  <ul><li>Mỗi người: ${t.startTokens} ${t.token} + 1 ${t.special} bí mật. Phần còn lại vào ${t.bank}.</li></ul>
  <h4>🔁 Mỗi lượt gồm 4 giai đoạn</h4>
  <ul>
   <li><b>1. ${t.betPhase}:</b> tất cả cùng đặt 1–3 Token lên các ô trên thảm (bấm vào ô để đặt, bấm chip để rút lại).</li>
   <li><b>2. Lắc xúc xắc:</b> người cầm cái hô “${t.cry}”, chủ phòng bấm lắc 3 viên xúc xắc.</li>
   <li><b>3. Phân định:</b> ô ra <b>1 mặt</b> → nhận lại Token + thưởng bằng số đã cược từ Quỹ. Ô ra <b>2–3 mặt</b> → nhận lại Token + rút 1 ${t.special}. Ô không ra → mất Token vào Quỹ.</li>
   <li><b>4. Kiếp nạn tập thể:</b> nếu xúc xắc có mặt <b>“${t.trigger}”</b> hoặc ra <b>3 mặt giống nhau</b> → rút 1 ${t.challenge}, cả bàn cùng chơi mini-game. Người thua nhận 1 ${t.mark} hoặc mất Token theo thẻ.</li>
  </ul>
  <h4>🃏 ${t.special}</h4>
  <ul><li>Bấm <b>“Bài”</b> để xem bài bí mật và tung thẻ. Thẻ phòng thủ (miễn trừ, ủy quyền…) dùng khi bạn đang bị chọn là người thua.</li>
  <li>Khi ai đó tung thẻ, người giữ <b>${t.specials[11].title}</b> có thể bấm Veto để vô hiệu hóa (online: trong ${VETO_MS / 1000} giây).</li></ul>
  <h4>🌐 Phòng online</h4>
  <ul><li>Chủ phòng giữ toàn quyền điều khiển ván; người khác chỉ tự đặt cược và tự tung thẻ của mình. Bài của ai chỉ hiện trên máy người đó.</li></ul>
  </div>`;
  modal({ title: "Luật chơi " + esc(t.title), body: html, buttons: [{ label: "Đã hiểu!", cls: "pink" }] });
}

/* ================= MẠNG (PeerJS) ================= */
const NET = { peer: null, code: null, conns: {}, roster: [], hostConn: null, retry: null, name: "", token: "", started: false, status: "" };

async function ensurePeer() {
  if (window.Peer) return true;
  try { await loadScript(PEERJS_URL); return !!window.Peer; } catch (e) { return false; }
}
function peerOpts() {
  return { debug: 1, config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }, { urls: "stun:global.stun.twilio.com:3478" }] } };
}
function leaveNet() {
  clearTimeout(NET.retry); clearTimeout(pendTimeout);
  try { NET.peer && NET.peer.destroy(); } catch (e) {}
  Object.assign(NET, { peer: null, code: null, conns: {}, roster: [], hostConn: null, retry: null, started: false, status: "" });
}
function inviteLink(code) { return `${location.origin}${location.pathname}?join=${code}`; }

/* ---------- HOST ---------- */
async function createRoom(name, code = randCode(), restore = null) {
  if (!(await ensurePeer())) { modal({ title: "Không tải được thư viện kết nối", body: "Kiểm tra mạng Internet rồi thử lại nhé.", buttons: [{ label: "OK" }] }); return; }
  leaveNet();
  MODE = "host"; ME = "p0"; NET.code = code;
  NET.roster = restore?.roster || [{ pid: "p0", name, token: "host", online: true }];
  NET.started = !!restore?.s;
  if (restore?.s) S = restore.s;
  NET.status = "Đang mở phòng…";
  const peer = new window.Peer(PEER_PREFIX + code, peerOpts());
  NET.peer = peer;
  peer.on("open", () => {
    NET.status = "";
    saveHost();
    if (NET.started) { show("game"); renderGame(); if (S.pend) armPend(); } else renderLobby();
  });
  peer.on("connection", conn => setupHostConn(conn));
  peer.on("disconnected", () => { NET.status = "Mất kết nối máy chủ trung gian, đang thử lại…"; try { peer.reconnect(); } catch (e) {} refreshNetUI(); });
  peer.on("error", err => {
    if (err.type === "unavailable-id") {
      if (restore) { NET.status = "Mã phòng cũ đang bận, thử lại sau vài giây…"; refreshNetUI(); NET.retry = setTimeout(() => createRoom(name, code, restore), 4000); }
      else createRoom(name, randCode());
    } else if (err.type === "network" || err.type === "server-error" || err.type === "socket-error") {
      NET.status = "Lỗi mạng – đang thử lại…"; refreshNetUI();
    } else console.warn("peer error", err);
  });
  if (!restore) renderLobby(); else { show(NET.started ? "game" : "lobby"); NET.started ? renderGame() : renderLobby(); }
}
function resumeHost(hs) { G = GAMES[hs.g]; createRoom(hs.roster[0].name, hs.code, hs); }
function saveHost() { if (MODE === "host") ls.set(HOST_KEY, { code: NET.code, g: G.id, roster: NET.roster.map(r => ({ pid: r.pid, name: r.name, token: r.token })), s: NET.started ? S : null }); }

function setupHostConn(conn) {
  conn.on("data", msg => onHostMsg(conn, msg));
  conn.on("close", () => {
    const r = NET.roster.find(x => x.conn === conn);
    if (r) { r.online = false; r.conn = null; delete NET.conns[r.pid]; if (NET.started) toast(`📴 ${esc(r.name)} mất kết nối`); refreshNetUI(); }
  });
  conn.on("error", () => {});
}
function onHostMsg(conn, msg) {
  if (!msg || typeof msg !== "object") return;
  if (msg.t === "hello") {
    const name = String(msg.name || "").slice(0, 14).trim() || "Bạn mới";
    let r = NET.roster.find(x => x.token === msg.token && x.pid !== "p0");
    if (!r) {
      if (NET.started) { conn.send({ t: "deny", why: "Ván đã bắt đầu. Bạn được xem với tư cách khán giả." }); conn.send({ t: "state", g: G.id, me: null, s: viewFor(null), code: NET.code }); conn._spectator = true; NET.conns["spec_" + Math.random()] = conn; return; }
      if (NET.roster.length >= G.maxP) { conn.send({ t: "deny", why: "Phòng đã đủ " + G.maxP + " người.", fatal: true }); setTimeout(() => conn.close(), 300); return; }
      const used = new Set(NET.roster.map(x => x.pid)); let i = 0; while (used.has("p" + i)) i++;
      r = { pid: "p" + i, name, token: msg.token, online: true };
      NET.roster.push(r);
      toast(`👋 ${esc(name)} đã vào phòng`); beep(880, .1, "triangle");
    }
    r.online = true; r.conn = conn; NET.conns[r.pid] = conn;
    conn.send({ t: "welcome", pid: r.pid, code: NET.code, g: G.id });
    saveHost();
    if (NET.started) sendState(r.pid); else broadcastLobby();
    refreshNetUI();
    return;
  }
  if (msg.t === "act") {
    const r = NET.roster.find(x => x.conn === conn);
    if (!r || !NET.started) return;
    handle(msg.a || {}, r.pid);
  }
}
function lobbyView() { return { code: NET.code, g: G.id, host: NET.roster[0]?.name, players: NET.roster.map((r, i) => ({ pid: r.pid, name: r.name, online: r.pid === "p0" ? true : !!r.online, color: COLORS[i] })) }; }
function broadcastLobby() { const v = lobbyView(); Object.values(NET.conns).forEach(c => { try { c.send({ t: "lobby", l: v }); } catch (e) {} }); }
function viewFor(pid) {
  const s = JSON.parse(JSON.stringify(S));
  s.players.forEach(p => { if (p.id !== pid) p.hand = p.hand.map(() => "?"); });
  s.challengeDeck = s.challengeDeck.map(() => "?");
  s.specialDeck = s.specialDeck.map(() => "?");
  if (s.pend) s.pend.left = Math.max(0, pendDeadline - Date.now());
  s.online = NET.roster.map(r => ({ pid: r.pid, on: r.pid === "p0" ? true : !!r.online }));
  return s;
}
function sendState(pid) { const c = NET.conns[pid]; if (c) try { c.send({ t: "state", g: G.id, me: pid, s: viewFor(pid), code: NET.code }); } catch (e) {} }
function broadcastState() {
  Object.entries(NET.conns).forEach(([pid, c]) => { try { c.send({ t: "state", g: G.id, me: c._spectator ? null : pid, s: viewFor(c._spectator ? null : pid), code: NET.code }); } catch (e) {} });
}
function kick(pid) {
  const i = NET.roster.findIndex(r => r.pid === pid); if (i <= 0) return;
  const r = NET.roster[i];
  try { r.conn && r.conn.send({ t: "deny", why: "Chủ phòng đã mời bạn ra khỏi phòng.", fatal: true }); setTimeout(() => r.conn && r.conn.close(), 300); } catch (e) {}
  NET.roster.splice(i, 1); delete NET.conns[pid];
  saveHost(); broadcastLobby(); renderLobby();
}

/* ---------- CLIENT ---------- */
async function joinRoom(code, name) {
  if (!(await ensurePeer())) { modal({ title: "Không tải được thư viện kết nối", body: "Kiểm tra mạng Internet rồi thử lại nhé.", buttons: [{ label: "OK" }] }); return; }
  leaveNet();
  MODE = "client"; NET.code = code; NET.name = name;
  const saved = ls.get(CLIENT_KEY);
  let sess = null; try { sess = JSON.parse(sessionStorage.getItem(CLIENT_KEY) || "null"); } catch (e) {}
  if (sess && sess.code === code && sess.token) NET.token = sess.token;
  else if (saved && saved.code === code && saved.token && saved.name === name) NET.token = saved.token;
  else NET.token = randTok();
  ls.set(CLIENT_KEY, { code, name, token: NET.token });
  try { sessionStorage.setItem(CLIENT_KEY, JSON.stringify({ code, name, token: NET.token })); } catch (e) {}
  NET.status = "Đang tìm phòng " + code + "…";
  G = G || GAMES.hdd;
  renderClientWait();
  const peer = new window.Peer(undefined, peerOpts());
  NET.peer = peer;
  peer.on("open", () => connectHost());
  peer.on("error", err => {
    if (err.type === "peer-unavailable") { NET.status = `Không thấy phòng ${code} – có thể chủ phòng chưa mở hoặc nhập sai mã. Đang thử lại…`; refreshNetUI(); scheduleRetry(); }
    else { NET.status = "Lỗi kết nối – đang thử lại…"; refreshNetUI(); scheduleRetry(); }
  });
  peer.on("disconnected", () => { try { peer.reconnect(); } catch (e) {} });
}
function scheduleRetry() { clearTimeout(NET.retry); NET.retry = setTimeout(() => { if (MODE === "client" && NET.peer && !NET.peer.destroyed) connectHost(); }, 3500); }
function connectHost() {
  const conn = NET.peer.connect(PEER_PREFIX + NET.code, { reliable: true });
  NET.hostConn = conn;
  const to = setTimeout(() => { if (!conn.open) { NET.status = "Kết nối chậm… nếu lâu quá hãy thử dùng chung wifi với chủ phòng."; refreshNetUI(); try { conn.close(); } catch (e) {} scheduleRetry(); } }, 12000);
  conn.on("open", () => { clearTimeout(to); NET.status = ""; conn.send({ t: "hello", name: NET.name, token: NET.token }); refreshNetUI(); });
  conn.on("data", msg => onClientMsg(msg));
  conn.on("close", () => { if (MODE !== "client") return; NET.status = "Mất kết nối với chủ phòng – đang kết nối lại…"; refreshNetUI(); scheduleRetry(); });
  conn.on("error", () => {});
}
function onClientMsg(msg) {
  if (!msg) return;
  if (msg.t === "welcome") { ME = msg.pid; G = GAMES[msg.g]; return; }
  if (msg.t === "deny") {
    if (msg.fatal) { ls.del(CLIENT_KEY); leaveNet(); MODE = "local"; renderHome(); modal({ title: "Không vào được phòng", body: esc(msg.why), buttons: [{ label: "OK" }] }); }
    else toast(esc(msg.why), 4000);
    return;
  }
  if (msg.t === "lobby") { G = GAMES[msg.l.g]; NET.lobby = msg.l; S = null; renderClientWait(); return; }
  if (msg.t === "state") {
    G = GAMES[msg.g]; S = msg.s; ME = msg.me;
    if (S.pend) pendDeadline = Date.now() + (S.pend.left || 0);
    if (!animating) { if ($("#game").classList.contains("hidden")) show("game"); renderGame(); }
    else NET.queued = true;
    return;
  }
  if (msg.t === "fx") { runFx(msg.ev); }
}
function sendAct(a) { try { NET.hostConn && NET.hostConn.open ? NET.hostConn.send({ t: "act", a }) : toast("Đang mất kết nối với chủ phòng…"); } catch (e) { toast("Không gửi được – thử lại nhé"); } }

/* ---------- LOBBY UI ---------- */
function renderLobby() {
  show("lobby");
  const el = $("#lobby");
  const link = inviteLink(NET.code);
  el.innerHTML = `<div class="panel setup-box">
    <div class="setup-hero"><img src="${A("logo")}" alt=""></div>
    <div class="setup-body">
      <h2 class="disp">Phòng chờ</h2>
      <div class="netstat ${NET.status ? "" : "hidden"}" id="netStat">${esc(NET.status)}</div>
      <div class="room-code"><span>MÃ PHÒNG</span><b>${esc(NET.code)}</b></div>
      <div class="invite">
        <div id="qr" class="qr"></div>
        <div class="inv-r">
          <div style="font-weight:800">Mời bạn vào phòng</div>
          <div class="hint">Gửi link hoặc cho quét mã QR. Bạn bè cũng có thể mở trang chủ và nhập mã <b>${esc(NET.code)}</b>.</div>
          <input class="linkbox" readonly value="${esc(link)}" id="invLink">
          <button class="btn sm yellow" id="copyLink">📋 Copy link mời</button>
        </div>
      </div>
      <div style="font-weight:800;margin:14px 0 6px">Người chơi (${NET.roster.length}/${G.maxP}) <span class="hint">– chọn 🎲 người cầm cái đầu</span></div>
      <div class="name-list" id="roster">${NET.roster.map((r, i) => `
        <div class="name-row lob"><span class="dot" style="background:${COLORS[i]}"></span>
          <span class="lname">${esc(r.name)}${r.pid === "p0" ? " 👑 (bạn)" : ""}</span>
          <span class="badge ${r.pid === "p0" || r.online ? "g" : "r"}">${r.pid === "p0" || r.online ? "online" : "mất kết nối"}</span>
          <label><input type="radio" name="first" value="${r.pid}" ${r.pid === (NET.first || "p0") ? "checked" : ""}>🎲</label>
          ${r.pid !== "p0" ? `<button class="btn sm ghost" data-kick="${r.pid}" title="Mời ra">✕</button>` : ""}
        </div>`).join("")}</div>
      <div class="setup-foot">
        <button class="btn ghost" id="closeRoom">Đóng phòng</button>
        <button class="btn" id="seeRules">📖 Luật</button><span style="flex:1"></span>
        <button class="btn big pink" id="startOnline" ${NET.roster.length < G.minP ? "disabled" : ""}>Bắt đầu ván (${NET.roster.length} người) ▶</button>
      </div>
      ${NET.roster.length < G.minP ? `<p class="hint">Cần ít nhất ${G.minP} người để bắt đầu.</p>` : ""}
    </div></div>`;
  $("#copyLink").onclick = () => copyText(link);
  $("#seeRules").onclick = showRules;
  $("#closeRoom").onclick = () => modal({ title: "Đóng phòng?", body: "Mọi người trong phòng sẽ bị ngắt kết nối.", buttons: [{ label: "Hủy" }, { label: "Đóng phòng", cls: "pink", onClick: () => { Object.values(NET.conns).forEach(c => { try { c.send({ t: "deny", why: "Chủ phòng đã đóng phòng.", fatal: true }); } catch (e) {} }); ls.del(HOST_KEY); setTimeout(renderHome, 300); } }] });
  el.querySelectorAll("[data-kick]").forEach(b => b.onclick = () => kick(b.dataset.kick));
  el.querySelectorAll("input[name=first]").forEach(r => r.onchange = () => NET.first = r.value);
  $("#startOnline").onclick = startOnline;
  drawQR(link);
}
async function drawQR(text) {
  const box = $("#qr"); if (!box) return;
  try { if (!window.QRCode) await loadScript(QR_URL); box.innerHTML = ""; new window.QRCode(box, { text, width: 148, height: 148, correctLevel: window.QRCode.CorrectLevel.M }); }
  catch (e) { box.innerHTML = `<div class="hint" style="padding:10px">Không tạo được QR – dùng link hoặc mã phòng nhé.</div>`; }
}
function copyText(t) {
  const done = () => toast("✅ Đã copy link mời!");
  try { navigator.clipboard.writeText(t).then(done, () => { fallbackCopy(t); done(); }); } catch (e) { fallbackCopy(t); done(); }
}
function fallbackCopy(t) { const i = $("#invLink"); if (i) { i.select(); try { document.execCommand("copy"); } catch (e) {} } }
function startOnline() {
  if (NET.roster.length < G.minP) return;
  NET.started = true;
  const first = NET.roster.find(r => r.pid === NET.first) ? NET.first : "p0";
  newGame(NET.roster.map(r => ({ id: r.pid, name: r.name })), first);
  saveHost();
}
function renderClientWait() {
  if (S && $("#game") && !$("#game").classList.contains("hidden")) { refreshNetUI(); return; }
  show("lobby");
  const l = NET.lobby;
  $("#lobby").innerHTML = `<div class="panel setup-box">
    <div class="setup-hero">${l ? `<img src="${A("logo")}" alt="">` : `<img src="assets/zuidee.webp" style="max-height:110px" alt="">`}</div>
    <div class="setup-body">
      <h2 class="disp">${l ? "Đã vào phòng!" : "Đang vào phòng…"}</h2>
      <div class="netstat ${NET.status ? "" : "hidden"}" id="netStat">${esc(NET.status)}</div>
      <div class="room-code"><span>MÃ PHÒNG</span><b>${esc(NET.code)}</b></div>
      ${l ? `<p>Chủ phòng: <b>${esc(l.host)}</b> • Game: <b>${esc(G.title)}</b></p>
      <div style="font-weight:800;margin:10px 0 6px">Người chơi (${l.players.length}/${G.maxP})</div>
      <div class="name-list">${l.players.map(p => `<div class="name-row lob"><span class="dot" style="background:${p.color}"></span><span class="lname">${esc(p.name)}${p.pid === ME ? " (bạn)" : ""}${p.pid === "p0" ? " 👑" : ""}</span><span class="badge ${p.online ? "g" : "r"}">${p.online ? "online" : "mất kết nối"}</span></div>`).join("")}</div>
      <p class="hint" style="margin-top:12px">⏳ Chờ chủ phòng bấm “Bắt đầu ván”…</p>` : `<p class="hint">Đang kết nối tới chủ phòng. Nếu lâu quá, kiểm tra lại mã phòng hoặc thử dùng chung wifi.</p>`}
      <div class="setup-foot"><button class="btn ghost" id="leaveRoom">← Rời phòng</button>${l ? `<button class="btn" id="seeRules">📖 Luật</button>` : ""}</div>
    </div></div>`;
  $("#leaveRoom").onclick = () => { ls.del(CLIENT_KEY); renderHome(); };
  if ($("#seeRules")) $("#seeRules").onclick = showRules;
}
function refreshNetUI() {
  const ns = $("#netStat"); if (ns) { ns.textContent = NET.status; ns.classList.toggle("hidden", !NET.status); }
  if (MODE === "host" && !NET.started && !$("#lobby").classList.contains("hidden")) renderLobby();
  if (MODE === "host" && NET.started && S && !$("#game").classList.contains("hidden")) renderGame();
}

/* ================= HIỆU ỨNG ĐỒNG BỘ ================= */
function emitFx(ev) {
  runFx(ev);
  if (MODE === "host") Object.values(NET.conns).forEach(c => { try { c.send({ t: "fx", ev }); } catch (e) {} });
}
function tell(pid, msg) {
  if (MODE !== "host" || pid === ME || pid == null) { toast(msg); return; }
  const c = NET.conns[pid]; if (c) try { c.send({ t: "fx", ev: { fx: "toast", msg } }); } catch (e) {}
}
function runFx(ev) {
  switch (ev.fx) {
    case "toast": toast(ev.msg, ev.ms || 2800); break;
    case "sfx": ev.k === "jingle" ? jingle() : ev.k === "buzz" ? buzz() : beep(ev.f || 520, .1); break;
    case "roll": animateDice(ev.final); break;
    case "timer": startTimer(ev.secs, ev.label); break;
    case "elim":
      modal({ title: esc(G.elim) + "!", body: `<div class="reveal"><img src="${A("mark")}" alt=""><div class="rt"><h2 class="disp" style="margin:0">${esc(ev.name)}</h2><p>đã tích đủ 3 ${esc(G.mark)} và bị loại khỏi ván chơi. Token còn lại về ${esc(G.bank)}.</p></div></div>`, buttons: [{ label: "Tiễn đồng chí 🫡", cls: "pink" }] });
      buzz(); break;
    case "vetoed":
      modal({ title: "BỊ VETO!", body: `<div class="reveal"><img src="${A("s12")}" alt=""><div class="rt"><h2 class="disp" style="margin:0">${esc(ev.by)}</h2><p>đã vô hiệu hóa thẻ “${esc(ev.card)}” của ${esc(ev.of)}. Cả 2 thẻ vào xấp bỏ.</p></div></div>`, buttons: [{ label: "Đau thế 😭", cls: "pink" }] });
      buzz(); break;
    case "confetti": confetti(); jingle(); break;
  }
}

/* ================= HÀNH ĐỘNG (dispatch) ================= */
function act(a) {
  if (MODE === "client") { sendAct(a); return; }
  handle(a, MODE === "host" ? ME : null);
}
const HOST_ONLY = new Set(["roll", "lateDone", "draw", "loser", "victim", "apply", "noLoser", "next", "riddle", "timer", "pendGo"]);
function handle(a, actor) {
  if (!S || S.phase === "over") return;
  if (MODE === "host" && HOST_ONLY.has(a.k) && actor !== "p0") { tell(actor, "Chỉ chủ phòng mới làm được việc này."); return; }
  const who = MODE === "local" ? (a.pid || actor) : actor;
  switch (a.k) {
    case "bet": return addBet(who, +a.loc);
    case "unbet": return removeBet(who, +a.loc);
    case "clear": if (canBet(who)) { refundBets(who); renderGame(); } return;
    case "roll": return tryRoll(a.force);
    case "lateDone": if (S.phase === "late") resolve(); return;
    case "draw": if (S.phase === "resolved" && S.trigger && !S.pend) drawChallenge(); return;
    case "loser": if (S.phase === "challenge" && S.cur && !S.pend) { const i = S.cur.losers.indexOf(a.pid); if (i >= 0) S.cur.losers.splice(i, 1); else if (P(a.pid)?.alive) S.cur.losers.push(a.pid); renderGame(); } return;
    case "victim": if (S.phase === "challenge" && S.cur && !S.pend) { S.cur.victim = S.cur.victim === a.pid ? null : a.pid; renderGame(); } return;
    case "apply": if (S.phase === "challenge" && !S.pend) applyChallenge(); return;
    case "noLoser": if (S.phase === "challenge" && !S.pend) { S.cur.losers = []; S.cur.victim = null; applyChallenge(); } return;
    case "next": if ((S.phase === "done" || (S.phase === "resolved" && !S.trigger)) && !S.pend) nextTurn(); return;
    case "riddle": if (S.cur) { let r; do { r = Math.floor(Math.random() * RIDDLES.length); } while (r === S.cur.riddle && RIDDLES.length > 1); S.cur.riddle = r; renderGame(); } return;
    case "timer": emitFx({ fx: "timer", secs: Math.min(30, Math.max(1, +a.secs || 5)), label: a.label || "" }); return;
    case "use": return useCard(who, a.cid, a.target);
    case "veto": return doVeto(who);
    case "pendGo": if (S.pend) execPending(); return;
  }
}

/* ================= RENDER GAME ================= */
function renderGame() {
  const el = $("#game");
  if (!S) return;
  if (S.phase === "over") { renderEnd(); return; }
  const deckLeft = S.challengeDeck.length;
  const roomChip = online() ? `<span class="chip-stat room">🌐 Phòng ${esc(NET.code)} • ${onlineCount()}/${S.players.length} online</span>` : "";
  el.innerHTML = `
  <div class="topbar">
    <img class="logo" src="${A("logo")}" alt="">
    <span class="chip-stat">🔁 Lượt ${S.turn}</span>
    <span class="chip-stat alt">🃏 ${esc(G.challenge)}: ${deckLeft}/24</span>
    <span class="chip-stat alt"><img src="${tokImg()}" style="width:20px;height:20px;border-radius:50%">${esc(G.bank)}: ${S.bank}</span>
    ${roomChip}
    <span class="sp"></span>
    ${MODE === "host" ? `<button class="btn sm" id="bInvite">🔗 Mời</button>` : ""}
    <button class="btn sm" id="bRules">📖 Luật</button>
    <button class="btn sm" id="bSound">${soundOn ? "🔊" : "🔇"}</button>
    ${MODE === "client" ? "" : `<button class="btn sm" id="bRestart">↺ Ván mới</button>`}
    <button class="btn sm" id="bHome">🏠</button>
  </div>
  ${G.id === "hdd" ? `<div class="strip" style="background-image:url(${A("strip_c1")})"></div>` : ""}
  <div class="netstat ${NET.status && online() ? "" : "hidden"}" id="netStat">${esc(NET.status)}</div>
  ${MODE === "client" && !ME ? `<div class="netstat">👀 Bạn đang xem với tư cách khán giả.</div>` : ""}
  <div class="layout">
    <div class="stage">
      <div class="phase-banner">${phaseBanner()}</div>
      ${S.phase === "challenge" && S.cur ? challengeView() : ""}
      ${bettorBar()}
      <div class="mat" id="mat">${G.locs.map((n, i) => tileHTML(i + 1)).join("")}</div>
      <div class="tray">
        ${[0, 1, 2].map(i => S.dice[i] ? `<div class="die" data-d="${i}"><img src="${A("loc" + S.dice[i])}" alt="${esc(G.locs[S.dice[i] - 1])}"></div>` : `<div class="die blank" data-d="${i}">?</div>`).join("")}
        <div class="act">${actionArea()}</div>
      </div>
      ${S.results && S.phase !== "bet" ? resultsView() : ""}
    </div>
    <div class="side">
      ${myHandPanel()}
      ${S.players.map(playerCard).join("")}
      <div class="logbox"><h4>📜 Nhật ký ván</h4>${S.log.slice(0, 40).map(l => `<div>${l}</div>`).join("")}</div>
    </div>
  </div>
  ${S.pend ? pendOverlay() : ""}
  <div class="foot">© Zui Dee Studio – ${esc(G.title)} • ${esc(G.slogan)}</div>`;
  bindGame();
  if (S.pend) startPendTicker(); else clearInterval(pendIv);
  paintTimer();
  if (MODE === "local") ls.set(SAVE_KEY, { g: G.id, s: S });
  if (MODE === "host") { saveHost(); broadcastState(); }
}
function onlineCount() { return (S.online || NET.roster.map(r => ({ on: r.pid === "p0" || r.online }))).filter(x => x.on).length; }
function isOnline(pid) {
  if (!online()) return true;
  if (MODE === "host") { const r = NET.roster.find(x => x.pid === pid); return pid === "p0" || !!(r && r.online); }
  const o = (S.online || []).find(x => x.pid === pid); return o ? o.on : true;
}

function phaseBanner() {
  const d = nameOf(S.dealer);
  const host = online() ? ` • Chủ phòng: 👑 ${nameOf("p0")}` : "";
  const map = {
    bet: [`Giai đoạn 1 – ${G.betPhase}`, (online() ? "Mỗi người tự bấm ô để đặt 1–3 Token trên máy mình." : "Chọn người chơi → bấm ô để đặt 1–3 Token.") + ` Cầm cái: 🎲 ${d}${host}`],
    "rolling-tmp": ["Đang lắc xúc xắc…", `🎲 ${d}: “${esc(G.cry)}”`],
    late: ["Cược muộn!", `Người có thẻ “${esc(card("s10").title)}” được đặt cược sau khi đã thấy xúc xắc.`],
    resolved: ["Giai đoạn 3 – Phân định cược", S.trigger ? "⚠️ Kiếp nạn đã kích hoạt! Rút thẻ ngay." : "Không có kiếp nạn – qua lượt mới."],
    challenge: [`Giai đoạn 4 – Kiếp nạn tập thể`, `Cầm cái 🎲 ${d} đọc to thẻ cho cả bàn!`],
    done: ["Hết lượt", "Kiểm tra bài, rồi qua lượt tiếp theo."]
  };
  const [t, s] = map[S.phase] || ["", ""];
  return `<div><div class="t">${t}</div><div class="s">${s}</div></div>`;
}

function canBet(pid) {
  const p = P(pid); if (!p || !p.alive) return false;
  if (!(S.phase === "bet" || S.phase === "late")) return false;
  if (p.flags.skipBet === S.turn) return false;
  if (S.phase === "late") return p.flags.lateBet === S.turn;
  if (p.flags.lateBet === S.turn) return false;
  return true;
}
function bettorsEligible() { return alive().filter(p => canBet(p.id) && p.tokens + betSum(p.id) > 0).map(p => p.id); }

function bettorBar() {
  if (!(S.phase === "bet" || S.phase === "late")) return "";
  const elig = bettorsEligible();
  const why = p => p.flags.skipBet === S.turn ? "mất lượt" : (S.phase === "late" ? "đã chốt" : (p.flags.lateBet === S.turn ? "cược sau khi đổ" : "hết token"));
  if (online()) {
    const mine = ME && elig.includes(ME) ? `<div class="mybet">👉 Bạn đã cược <b>${betSum(ME)}/3</b> Token – bấm ô trên thảm để đặt, bấm chip của bạn để rút lại.</div>` : (ME && P(ME)?.alive ? `<div class="mybet">Bạn không đặt cược lượt này (${why(P(ME))}).</div>` : "");
    return `${mine}<div class="bettors">${alive().map(p => `<span class="bettor ${elig.includes(p.id) ? "" : "off"} ${p.id === ME ? "on" : ""}">${dot(p)}${esc(p.name)} <em>${elig.includes(p.id) ? `${betSum(p.id)}/3` : why(p)}</em></span>`).join("")}</div>`;
  }
  if (!selBettor || !elig.includes(selBettor)) selBettor = elig[0] || null;
  return `<div class="bettors">${alive().map(p => {
    const on = elig.includes(p.id);
    return `<button class="bettor ${p.id === selBettor ? "on" : ""} ${on ? "" : "off"}" data-b="${p.id}" ${on ? "" : "disabled"}>${dot(p)}${esc(p.name)} <em>${on ? `${betSum(p.id)}/3 đã cược` : why(p)}</em></button>`;
  }).join("")}</div>`;
}

function tileHTML(n) {
  const cnt = S.dice.filter(d => d === n).length;
  const showRes = S.dice.length && S.phase !== "bet" && S.phase !== "rolling-tmp";
  let chips = "";
  S.players.forEach(p => { const b = S.bets[p.id]?.[n]; if (b) chips += `<span class="chipT ${online() && p.id === ME ? "mine" : ""}" data-chip="${p.id}" data-loc="${n}" style="background:${p.color}" title="${esc(p.name)}">${b}<small>${esc(p.name)}</small></span>`; });
  return `<div class="tile ${showRes ? (cnt ? "hit" : "dim") : ""}" data-loc="${n}">
    <img src="${A("loc" + n)}" alt="${esc(G.locs[n - 1])}">
    ${showRes && cnt ? `<span class="hitcount">×${cnt}</span>` : ""}
    <div class="bets">${chips}</div></div>`;
}

function waitHost(msg) { return `<div class="waithost">⏳ ${msg}</div>`; }
function actionArea() {
  const ctl = canControl();
  const hostN = nameOf("p0");
  if (S.pend) return waitHost("Đang chờ xử lý thẻ vừa tung…");
  if (S.phase === "rolling-tmp") return waitHost("Xúc xắc đang lăn…");
  if (S.phase === "bet") {
    const extra = online() && ME && canBet(ME) ? `<button class="btn sm ghost" id="bClear">Rút hết cược của tôi</button>` : (!online() ? `<button class="btn sm ghost" id="bClear">Xóa cược của người đang chọn</button>` : "");
    if (!ctl) return `${waitHost(`Chờ chủ phòng ${hostN} lắc xúc xắc…`)}<div style="display:flex;gap:8px;flex-wrap:wrap">${extra}</div>`;
    return `<button class="btn huge pink" id="bRoll">🎲 ${esc(G.cry)}</button>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" id="bTimer5">⏱ Đếm 5 giây đặt cược</button>${extra}</div>`;
  }
  if (S.phase === "late") return ctl ? `<button class="btn huge green" id="bLateDone">✅ Chốt cược muộn & phân định</button>` : waitHost(`Chờ chủ phòng chốt cược muộn…`);
  if (S.phase === "resolved") {
    if (!ctl) return waitHost(S.trigger ? `Chờ chủ phòng rút ${esc(G.challenge)}…` : "Chờ chủ phòng qua lượt mới…");
    return S.trigger
      ? `<button class="btn huge red" id="bDraw">🔥 Rút ${esc(G.challenge)}!</button><div class="hint">Lý do: ${S.triggerWhy}</div>`
      : `<button class="btn huge green" id="bNext">Lượt tiếp theo ▶</button>`;
  }
  if (S.phase === "challenge") return `<div class="hint" style="font-weight:700">⬆️ Xử lý ${esc(G.challenge)} ở phía trên.</div>`;
  if (S.phase === "done") return ctl ? `<button class="btn huge green" id="bNext">Lượt tiếp theo ▶</button>` : waitHost("Chờ chủ phòng qua lượt mới…");
  return "";
}

function myHandPanel() {
  if (!online() || !ME || !P(ME)) return "";
  const p = P(ME);
  if (!p.alive) return `<div class="myhand"><b>Bạn đã bị “${esc(G.elim)}”</b><div class="hint">Vẫn có thể ở lại xem cả bàn chơi tiếp 😄</div></div>`;
  return `<div class="myhand">
    <div class="mh-top"><b>🃏 Bài của tôi (${p.hand.length})</b><button class="btn sm pink" data-hand="${p.id}">Mở bài</button></div>
    <div class="mini-hand">${p.hand.map(c => `<img src="${A(c)}" alt="${esc(card(c).title)}" title="${esc(card(c).title)}" data-hand="${p.id}">`).join("") || `<span class="hint">Chưa có ${esc(G.special)}.</span>`}</div>
  </div>`;
}

function playerCard(p) {
  const marks = [0, 1, 2].map(i => `<i class="${i < p.marks ? "on" : ""}" style="${i < p.marks ? `background-image:url(${A("mark")})` : ""}"></i>`).join("");
  const b = [];
  if (online() && p.id === "p0") b.push(`<span class="badge">👑 Chủ phòng</span>`);
  if (p.id === S.dealer && p.alive) b.push(`<span class="badge">🎲 Cầm cái</span>`);
  if (online() && !isOnline(p.id)) b.push(`<span class="badge r">📴 Mất kết nối</span>`);
  if (!p.alive) b.push(`<span class="badge r">💀 ${esc(G.elim)}</span>`);
  if (p.flags.skipBet === S.turn) b.push(`<span class="badge r">Mất lượt cược</span>`);
  else if (p.flags.skipBet === S.turn + 1) b.push(`<span class="badge r">Mất lượt cược lượt sau</span>`);
  if (p.flags.ban === S.turn) b.push(`<span class="badge r">Cấm dùng thẻ</span>`);
  else if (p.flags.ban === S.turn + 1) b.push(`<span class="badge r">Cấm thẻ lượt sau</span>`);
  if (p.flags.immune === S.turn) b.push(`<span class="badge b">🛡️ Out-of-Office</span>`);
  if (p.flags.lateBet === S.turn) b.push(`<span class="badge g">⚡ Cược muộn</span>`);
  else if (p.flags.lateBet === S.turn + 1) b.push(`<span class="badge g">⚡ Cược muộn lượt sau</span>`);
  let handBtn = "";
  if (p.alive) {
    if (!online()) handBtn = `<button class="btn sm yellow" data-hand="${p.id}">🃏 Bài (${p.hand.length})</button>`;
    else if (p.id === ME) handBtn = `<button class="btn sm yellow" data-hand="${p.id}">🃏 Bài (${p.hand.length})</button>`;
    else handBtn = `<span class="hcount">🂠 ${p.hand.length} lá</span>`;
  }
  return `<div class="pl ${p.alive ? "" : "dead"} ${p.id === S.dealer && p.alive ? "dealer" : ""} ${online() && p.id === ME ? "me" : ""}">
    <div class="av" style="background:${p.color}">${esc(p.name[0].toUpperCase())}</div>
    <div class="nm">${esc(p.name)}${online() && p.id === ME ? " <span class='you'>(bạn)</span>" : ""}</div>
    <div>${handBtn}</div>
    <div class="row2"><span class="tok"><img src="${tokImg()}" alt="">${p.tokens}</span><span class="marks" title="${esc(G.mark)}">${marks}</span></div>
    <div></div>
    ${b.length ? `<div class="badges">${b.join("")}</div>` : ""}
  </div>`;
}

function resultsView() {
  const r = S.results; if (!r) return "";
  return `<div class="results"><h3 class="disp">Kết quả lượt ${S.turn}</h3>${r.length ? r.map(x => `<div class="res-line">${dot(P(x.p))}<div>${x.t}</div></div>`).join("") : "<div class='res-line'>Không ai đặt cược lượt này.</div>"}</div>`;
}

const countIn = (arr, id) => arr.filter(x => x === id).length;
function challengeView() {
  const c = card(S.cur.id);
  const ctl = canControl();
  const isMini = c.g !== "C";
  let pen = "";
  if (isMini) pen = c.pen.t === "mark" ? `Thua: Nhận 1 ${G.mark}` : `Thua: Mất ${c.pen.n} ${G.token}`;
  const dis = ctl ? "" : "disabled";
  const pickers = isMini
    ? `<div style="font-weight:800;margin-top:10px">Ai thua? <span class="hint">${ctl ? "(bấm chọn – có thể chọn nhiều người)" : "(chủ phòng sẽ chọn)"}</span></div>
       <div class="pickers">${alive().map(p => `<button class="pick ${S.cur.losers.includes(p.id) ? "on" : ""}" data-loser="${p.id}" ${dis}>${dot(p)}${esc(p.name)}${countIn(S.cur.losers, p.id) > 1 ? " ×" + countIn(S.cur.losers, p.id) : ""}</button>`).join("")}</div>`
    : `<div style="font-weight:800;margin-top:10px">Ai dính kiếp nạn này? <span class="hint">(mặc định: người cầm cái đã rút thẻ)</span></div>
       <div class="pickers">${alive().map(p => `<button class="pick ${S.cur.victim === p.id ? "on" : ""}" data-victim="${p.id}" ${dis}>${dot(p)}${esc(p.name)}</button>`).join("")}</div>`;
  const rq = S.cur.riddle != null ? RIDDLES[S.cur.riddle] : null;
  const riddle = c.riddle ? `<div class="riddle">${rq ? `❓ ${esc(rq[0])}<br>${ctl ? `<span id="ans" class="hidden">💡 ${esc(rq[1])}</span> <button class="btn sm" id="bAns">Xem đáp án</button>` : ""}` : (ctl ? "" : "Chờ chủ phòng bốc câu đố…")} ${ctl ? `<button class="btn sm" id="bRiddle">🎲 ${rq ? "Câu khác" : "Bốc câu đố mẹo"}</button>` : ""}</div>` : "";
  const secs = c.secs || 10;
  const timer = `<div class="timer"><span class="num ${c.secs ? "" : "hidden"}" id="tNum">${secs}</span>${ctl ? `<button class="btn ${c.secs ? "yellow" : "sm"}" id="bTimer" data-s="${secs}">⏱ Bấm giờ ${secs}s${c.secs ? "" : " (tùy chọn)"}</button>` : ""}</div>`;
  const targeted = ME && (isMini ? S.cur.losers.includes(ME) : S.cur.victim === ME);
  const meHint = online() && targeted ? `<div class="alertme">⚠️ Bạn đang bị chọn! Mở “🃏 Bài của tôi” nếu muốn tung thẻ cứu nguy trước khi chủ phòng xử phạt.</div>` : "";
  return `<div class="chal">
    <div class="cardimg flip"><img src="${A(c.id)}" alt="${esc(c.title)}"></div>
    <div>
      <span class="grp">Nhóm ${c.g} – ${esc(G.groups[c.g])}</span>
      <h3 class="disp">${esc(c.title)}</h3>
      <div class="txt">${esc(c.text)}</div>
      ${pen ? `<div class="pen">⚠️ ${pen}</div>` : ""}
      ${riddle}${timer}
      ${pickers}${meHint}
      <div class="hint">💡 Người bị chọn có thể tung thẻ cứu nguy (${isMini ? "miễn trừ / ủy quyền / " : ""}${esc(card("s7").title)}) <b>trước khi</b> bấm Xử phạt.</div>
      ${ctl ? `<div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap">
        <button class="btn big red" id="bApply">⚖️ Xử phạt</button>
        ${isMini ? `<button class="btn ghost" id="bNoLoser">Không ai thua</button>` : ""}
      </div>` : waitHost(`Chờ chủ phòng ${nameOf("p0")} xử phạt…`)}
    </div></div>`;
}

function pendOverlay() {
  const pd = S.pend, p = P(pd.pid), c = card(pd.cid);
  const vetoName = card("s12").title;
  let veto = "";
  if (MODE === "local") {
    const others = alive().filter(o => o.id !== pd.pid && o.flags.ban !== S.turn);
    veto = `${others.length ? `<p style="font-weight:800">Ai có thẻ “${esc(vetoName)}” muốn chặn không?</p><div class="pickers">${others.map(o => `<button class="pick" data-veto="${o.id}">🚫 ${dot(o)}${esc(o.name)}</button>`).join("")}</div>` : ""}
      <div style="margin-top:12px"><button class="btn green" id="bPendGo">Không ai chặn → Thực thi ✅</button></div>`;
  } else {
    const mine = ME && ME !== pd.pid && P(ME)?.alive && P(ME).hand.includes("s12") && P(ME).flags.ban !== S.turn;
    veto = `<div class="pend-count">⏳ Thực thi sau <b id="pendLeft">${Math.ceil(Math.max(0, pendDeadline - Date.now()) / 1000)}</b> giây – ai giữ “${esc(vetoName)}” có thể chặn.</div>
      ${mine ? `<button class="btn big red" id="bVeto">🚫 VETO! Dùng “${esc(vetoName)}”</button>` : ""}`;
  }
  const tgt = pd.target ? ` → <b>${nameOf(pd.target)}</b>` : "";
  return `<div class="mask pendmask"><div class="modal"><div class="mh"><h3 class="disp">Tung thẻ!</h3></div><div class="mb">
    <div class="reveal"><img class="flip" src="${A(pd.cid)}" alt=""><div class="rt">
      <p style="margin:0"><b>${esc(p.name)}</b> vừa tung${tgt}:</p><h2 class="disp" style="margin:4px 0 8px">${esc(c.title)}</h2><p>${esc(c.text)}</p>
      ${veto}
    </div></div></div></div></div>`;
}
function startPendTicker() {
  clearInterval(pendIv);
  if (MODE === "local") return;
  pendIv = setInterval(() => { const e = $("#pendLeft"); if (e) e.textContent = Math.ceil(Math.max(0, pendDeadline - Date.now()) / 1000); }, 250);
}

/* ---------------- bind ---------------- */
function bindGame() {
  const on = (id, fn) => { const e = $("#" + id); if (e) e.onclick = fn; };
  on("bRules", showRules);
  on("bSound", () => { soundOn = !soundOn; const b = $("#bSound"); if (b) b.textContent = soundOn ? "🔊" : "🔇"; });
  on("bInvite", showInvite);
  on("bHome", () => modal({ title: "Về trang chủ?", body: MODE === "host" ? "Phòng sẽ tạm đóng – bạn có thể “Mở lại phòng” ở trang chủ để mọi người vào lại." : (MODE === "client" ? "Bạn có thể bấm “Vào lại” ở trang chủ." : "Ván đang chơi được lưu lại, bạn có thể chơi tiếp sau."), buttons: [{ label: "Ở lại" }, { label: "Về trang chủ", cls: "pink", onClick: renderHome }] }));
  on("bRestart", () => modal({ title: "Chơi ván mới?", body: MODE === "host" ? "Ván hiện tại sẽ bị xóa, mọi người quay lại phòng chờ." : "Ván hiện tại sẽ bị xóa.", buttons: [{ label: "Hủy" }, { label: "Ván mới", cls: "pink", onClick: () => {
    if (MODE === "host") { NET.started = false; S = null; saveHost(); renderLobby(); broadcastLobby(); }
    else { ls.del(SAVE_KEY); renderSetup(); }
  } }] }));
  document.querySelectorAll("[data-b]").forEach(b => b.onclick = () => { selBettor = b.dataset.b; renderGame(); });
  document.querySelectorAll(".tile").forEach(t => t.onclick = () => {
    if (!(S.phase === "bet" || S.phase === "late")) return;
    if (online()) { if (!ME) return; act({ k: "bet", loc: +t.dataset.loc }); }
    else { if (!selBettor) { toast("Chọn người đặt cược trước nhé!"); return; } act({ k: "bet", loc: +t.dataset.loc, pid: selBettor }); }
  });
  document.querySelectorAll("[data-chip]").forEach(c => c.onclick = e => {
    e.stopPropagation();
    const pid = c.dataset.chip;
    if (online() && pid !== ME) return;
    if (!online()) selBettor = pid;
    act({ k: "unbet", loc: +c.dataset.loc, pid });
  });
  document.querySelectorAll("[data-hand]").forEach(b => b.onclick = () => openHand(b.dataset.hand));
  on("bRoll", () => act({ k: "roll" }));
  on("bLateDone", () => act({ k: "lateDone" }));
  on("bDraw", () => act({ k: "draw" }));
  on("bNext", () => act({ k: "next" }));
  on("bClear", () => { const pid = online() ? ME : selBettor; if (pid) act({ k: "clear", pid }); });
  on("bTimer5", () => act({ k: "timer", secs: 5, label: "bet" }));
  on("bApply", () => act({ k: "apply" }));
  on("bNoLoser", () => act({ k: "noLoser" }));
  on("bTimer", e => act({ k: "timer", secs: +e.currentTarget.dataset.s, label: "card" }));
  on("bRiddle", () => act({ k: "riddle" }));
  on("bAns", () => { const a = $("#ans"); if (a) a.classList.remove("hidden"); });
  on("bVeto", () => act({ k: "veto" }));
  on("bPendGo", () => act({ k: "pendGo" }));
  document.querySelectorAll("[data-veto]").forEach(b => b.onclick = () => act({ k: "veto", pid: b.dataset.veto }));
  document.querySelectorAll("[data-loser]").forEach(b => b.onclick = () => act({ k: "loser", pid: b.dataset.loser }));
  document.querySelectorAll("[data-victim]").forEach(b => b.onclick = () => act({ k: "victim", pid: b.dataset.victim }));
}
function showInvite() {
  const link = inviteLink(NET.code);
  const md = modal({ title: "Mời bạn vào phòng", body: `<div class="room-code"><span>MÃ PHÒNG</span><b>${esc(NET.code)}</b></div><div class="invite"><div id="qr" class="qr"></div><div class="inv-r"><input class="linkbox" readonly value="${esc(link)}" id="invLink"><button class="btn sm yellow" id="copyLink2">📋 Copy link mời</button><p class="hint">Ván đã bắt đầu: người mới vào sẽ xem với tư cách khán giả. Người cũ bị rớt mạng mở lại link là vào lại đúng chỗ.</p></div></div>`, buttons: [{ label: "Đóng" }] });
  $("#copyLink2").onclick = () => copyText(link);
  drawQR(link);
}

/* ---------------- đồng hồ (đồng bộ qua fx) ---------------- */
function startTimer(secs, label) {
  timerEnd = Date.now() + secs * 1000; timerLabel = label || "";
  beep(700, .08);
  clearInterval(timerIv);
  let last = secs;
  timerIv = setInterval(() => {
    const left = Math.ceil((timerEnd - Date.now()) / 1000);
    if (left !== last) { last = left; if (left > 0) beep(left <= 3 ? 880 : 600, .06); }
    paintTimer();
    if (left <= 0) { clearInterval(timerIv); buzz(); setTimeout(() => { timerEnd = 0; paintTimer(); }, 2200); }
  }, 200);
  paintTimer();
}
function paintTimer() {
  const left = Math.ceil((timerEnd - Date.now()) / 1000);
  const active = timerEnd > 0;
  const num = $("#tNum"), bt = $("#bTimer"), b5 = $("#bTimer5");
  if (num && active && timerLabel === "card") { num.classList.remove("hidden"); num.textContent = Math.max(0, left); num.classList.toggle("alarm", left <= 0); }
  if (bt && active && timerLabel === "card") bt.innerHTML = left > 0 ? `⏳ ${left}` : "⏰ HẾT GIỜ!";
  if (b5 && active && timerLabel === "bet") b5.innerHTML = left > 0 ? `⏳ ${left}` : "⏰ HẾT GIỜ!";
  let fl = $("#floatTimer");
  if (active && timerLabel === "bet" && MODE === "client") {
    if (!fl) { fl = document.createElement("div"); fl.id = "floatTimer"; fl.className = "float-timer"; document.body.appendChild(fl); }
    fl.textContent = left > 0 ? `⏳ ${left}s` : "⏰ HẾT GIỜ!";
  } else if (fl && (!active || timerLabel !== "bet")) fl.remove();
}

/* ================= ĐẶT CƯỢC ================= */
const betSum = id => Object.values(S.bets[id] || {}).reduce((a, b) => a + b, 0);
function addBet(pid, loc) {
  if (!(loc >= 1 && loc <= 6)) return;
  const p = P(pid); if (!p) return;
  if (!canBet(pid)) { tell(pid, "Bạn không đặt cược được lúc này."); return; }
  if (betSum(pid) >= 3) { tell(pid, `${esc(p.name)} đã cược đủ 3 Token rồi!`); return; }
  if (p.tokens <= 0) { tell(pid, `${esc(p.name)} hết Token rồi 😢`); return; }
  p.tokens--; S.bets[pid][loc] = (S.bets[pid][loc] || 0) + 1;
  if (pid === ME || MODE === "local") beep(440 + loc * 40, .05, "triangle");
  renderGame();
}
function removeBet(pid, loc) {
  if (!canBet(pid)) return;
  const b = S.bets[pid]; if (!b || !b[loc]) return;
  b[loc]--; if (!b[loc]) delete b[loc]; P(pid).tokens++;
  renderGame();
}
function refundBets(pid) { const p = P(pid); p.tokens += betSum(pid); S.bets[pid] = {}; }

function tryRoll(force) {
  if (animating || S.phase !== "bet" || S.pend) return;
  const missing = bettorsEligible().filter(id => betSum(id) === 0 && P(id).tokens > 0);
  if (missing.length && !force) {
    modal({ title: "Có người chưa cược!", body: `<p>${missing.map(nameOf).join(", ")} chưa đặt Token nào (luật: mỗi người đặt 1–3 Token).</p>`, buttons: [{ label: "Chờ thêm" }, { label: "Vẫn lắc!", cls: "pink", onClick: () => handle({ k: "roll", force: true }, MODE === "host" ? "p0" : null) }] });
    return;
  }
  const final = [rnd6(), rnd6(), rnd6()];
  S.phase = "rolling-tmp"; S.dice = [];
  renderGame();
  emitFx({ fx: "roll", final });
  setTimeout(() => {
    S.dice = final;
    log(`🎲 ${nameOf(S.dealer)} lắc ra: ${final.map(f => G.locs[f - 1]).join(" • ")}`);
    const late = alive().filter(p => p.flags.lateBet === S.turn && p.flags.skipBet !== S.turn);
    if (late.length) { S.phase = "late"; selBettor = late[0].id; emitFx({ fx: "toast", msg: `⚡ ${late.map(p => esc(p.name)).join(", ")} được cược muộn!` }); renderGame(); }
    else resolve();
  }, 1650);
}
function animateDice(final) {
  animating = true;
  const dice = document.querySelectorAll(".die");
  dice.forEach(d => d.classList.add("rolling"));
  let k = 0;
  const iv = setInterval(() => {
    k++;
    document.querySelectorAll(".die").forEach((d, i) => {
      const f = k > 8 + i * 3 ? final[i] : rnd6();
      d.classList.remove("blank"); d.innerHTML = `<img src="${A("loc" + f)}">`;
      if (k < 9 + i * 3) d.classList.add("rolling");
      if (k === 9 + i * 3) { d.classList.remove("rolling"); beep(220 + i * 80, .12, "square"); }
    });
    if (k % 2) beep(180 + Math.random() * 120, .03, "square", .03);
    if (k >= 16) { clearInterval(iv); animating = false; if (NET.queued) { NET.queued = false; renderGame(); } }
  }, 90);
}

/* ================= PHÂN ĐỊNH ================= */
function resolve() {
  const res = [];
  S.lost = {}; S.returned = {};
  S.players.forEach(p => {
    const b = S.bets[p.id]; if (!b) return;
    Object.entries(b).forEach(([loc, n]) => {
      loc = +loc; const cnt = S.dice.filter(d => d === loc).length; const ln = G.locs[loc - 1];
      if (cnt === 0) {
        S.bank += n; S.lost[p.id] = (S.lost[p.id] || 0) + n;
        res.push({ p: p.id, t: `❌ ${esc(ln)}: mất ${n} Token vào Quỹ.` });
      } else if (cnt === 1) {
        p.tokens += n; S.returned[p.id] = (S.returned[p.id] || 0) + n;
        const rw = Math.min(n, S.bank); S.bank -= rw; p.tokens += rw;
        res.push({ p: p.id, t: `✅ ${esc(ln)} ×1: lấy lại ${n} + thưởng <b>${rw}</b> Token${rw < n ? " (Quỹ cạn!)" : ""}.` });
      } else {
        p.tokens += n; S.returned[p.id] = (S.returned[p.id] || 0) + n;
        const got = drawSpecial(p.id, 1);
        res.push({ p: p.id, t: `🌟 ${esc(ln)} ×${cnt}: lấy lại ${n} Token + rút <b>${got} ${esc(G.special)}</b>.` });
      }
    });
  });
  S.results = res;
  const all3 = S.dice[0] === S.dice[1] && S.dice[1] === S.dice[2];
  const has6 = S.dice.includes(6);
  S.trigger = all3 || has6;
  S.triggerWhy = [has6 ? `xuất hiện mặt “${esc(G.trigger)}”` : "", all3 ? "3 mặt giống hệt nhau" : ""].filter(Boolean).join(" + ");
  S.phase = "resolved";
  if (S.trigger) { log(`🔥 Kiếp nạn kích hoạt (${S.triggerWhy})!`); emitFx({ fx: "sfx", k: "buzz" }); } else emitFx({ fx: "sfx", k: "jingle" });
  renderGame();
}
function drawSpecial(pid, n) {
  let got = 0;
  for (let i = 0; i < n; i++) {
    if (!S.specialDeck.length && S.specialDiscard.length) { S.specialDeck = shuffle(S.specialDiscard); S.specialDiscard = []; log("♻️ Xáo lại xấp " + G.special + "."); }
    const c = S.specialDeck.pop(); if (!c) break;
    P(pid).hand.push(c); got++;
  }
  return got;
}

/* ================= KIẾP NẠN ================= */
function drawChallenge() {
  const id = S.challengeDeck.pop();
  if (!id) { endGame("deck"); return; }
  S.cur = { id, losers: [], victim: card(id).g === "C" ? (P(S.dealer).alive ? S.dealer : alive()[0].id) : null, riddle: null };
  S.phase = "challenge";
  timerEnd = 0;
  log(`📇 Rút ${G.challenge}: <b>${esc(card(id).title)}</b> (nhóm ${card(id).g}).`);
  emitFx({ fx: "sfx", k: "beep", f: 330 });
  renderGame();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function applyChallenge() {
  const c = card(S.cur.id);
  let chain = false;
  if (c.g !== "C") {
    if (!S.cur.losers.length) log("😎 Không ai thua mini-game này.");
    S.cur.losers.forEach(id => {
      const p = P(id); if (!p || !p.alive) return;
      if (p.flags.immune === S.turn) { log(`🛡️ ${nameOf(id)} đang Out-of-Office – miễn nhiễm!`); return; }
      if (c.pen.t === "mark") { p.marks++; log(`🙈 ${nameOf(id)} nhận 1 ${G.mark} (${p.marks}/3).`); emitFx({ fx: "toast", msg: `${esc(p.name)} +1 ${esc(G.markShort)}!` }); }
      else { const x = Math.min(c.pen.n, p.tokens); p.tokens -= x; S.bank += x; log(`💸 ${nameOf(id)} mất ${x} Token vào Quỹ.`); }
    });
  } else {
    const v = S.cur.victim ? P(S.cur.victim) : null;
    if (!v) log("😮‍💨 Kiếp nạn trượt – không ai dính.");
    else if (v.flags.immune === S.turn) log(`🛡️ ${esc(v.name)} đang Out-of-Office – miễn nhiễm!`);
    else {
      const n = esc(v.name);
      switch (c.eff) {
        case "skipBet": v.flags.skipBet = S.turn + 1; log(`🚫 ${n} mất lượt đặt cược ở lượt sau.`); break;
        case "pay2": { const x = Math.min(2, v.tokens); v.tokens -= x; S.bank += x; log(`💸 ${n} trả ${x} Token vào Quỹ.`); break; }
        case "giveLowest": {
          const others = alive().filter(p => p.id !== v.id);
          if (!others.length || v.tokens <= 0) { log(`${n} không có Token để chuyển.`); break; }
          const min = Math.min(...others.map(p => p.tokens)); const t = others.find(p => p.tokens === min);
          v.tokens--; t.tokens++; log(`🤝 ${n} chuyển 1 Token cho ${esc(t.name)} (ít Token nhất).`); break;
        }
        case "drawAgain": chain = true; log(`📇 ${n} phải rút thêm 1 ${G.challenge}!`); break;
        case "discardSpecial": {
          if (!v.hand.length) { log(`${n} không có ${G.special} nào để hủy.`); break; }
          const i = Math.floor(Math.random() * v.hand.length); const cid = v.hand.splice(i, 1)[0]; S.specialDiscard.push(cid);
          log(`🗑️ ${n} bị hủy thẻ “${esc(card(cid).title)}”.`); break;
        }
        case "banCards": v.flags.ban = S.turn + 1; log(`⛔ ${n} bị cấm dùng ${G.special} ở lượt sau.`); break;
        case "directMark": v.marks++; log(`🙈 ${n} nhận thẳng 1 ${G.mark} (${v.marks}/3).`); emitFx({ fx: "toast", msg: `${n} +1 ${esc(G.markShort)}!` }); break;
        case "forfeitBets": { const r = Math.min(S.returned[v.id] || 0, v.tokens); v.tokens -= r; S.bank += r; S.returned[v.id] = 0; log(`💸 ${n} bị thu hồi ${r} Token đã cược lượt này.`); break; }
      }
    }
  }
  S.cur = null;
  timerEnd = 0;
  if (checkElims()) return;
  if (chain && S.challengeDeck.length) { emitFx({ fx: "toast", msg: `📇 Rút thêm 1 ${esc(G.challenge)}!` }); drawChallenge(); return; }
  if (!S.challengeDeck.length) { endGame("deck"); return; }
  S.phase = "done";
  renderGame();
}
function checkElims() {
  let any = false;
  S.players.forEach(p => {
    if (p.alive && p.marks >= 3) {
      p.alive = false; any = true;
      S.bank += p.tokens + ((S.phase === "bet" || S.phase === "late") ? betSum(p.id) : 0); p.tokens = 0; S.specialDiscard.push(...p.hand); p.hand = []; S.bets[p.id] = {};
      log(`💀 <b>${esc(p.name)}</b> dính đủ 3 ${G.mark} → “${G.elim}”!`);
      emitFx({ fx: "elim", name: p.name });
    }
  });
  if (alive().length <= 1) { endGame("last"); return true; }
  if (any && !P(S.dealer).alive) S.dealer = nextAlive(S.dealer);
  return false;
}
function nextAlive(fromId) {
  const n = S.players.length; let i = S.players.findIndex(p => p.id === fromId);
  for (let k = 0; k < n; k++) { i = (i + 1) % n; if (S.players[i].alive) return S.players[i].id; }
  return fromId;
}
function nextTurn() {
  S.turn++;
  S.dealer = nextAlive(S.dealer);
  S.players.forEach(p => S.bets[p.id] = {});
  S.dice = []; S.results = null; S.lost = {}; S.returned = {}; S.trigger = false; S.cur = null;
  S.phase = "bet"; selBettor = null; timerEnd = 0;
  log(`— Lượt ${S.turn}: ${nameOf(S.dealer)} cầm cái —`);
  alive().forEach(p => { if (p.flags.skipBet === S.turn) log(`🚫 ${esc(p.name)} mất lượt cược lượt này.`); });
  renderGame();
}

/* ================= KẾT THÚC ================= */
function endGame(reason) {
  const al = alive();
  let winners;
  if (reason === "last" && al.length === 1) winners = [al[0]];
  else {
    const pool = al.length ? al : S.players;
    const max = Math.max(...pool.map(p => p.tokens));
    let top = pool.filter(p => p.tokens === max);
    const minM = Math.min(...top.map(p => p.marks)); top = top.filter(p => p.marks === minM);
    winners = top;
  }
  S.winner = winners.map(p => p.id); S.endReason = reason; S.phase = "over"; S.pend = null;
  log(`🏆 ${winners.map(p => esc(p.name)).join(" & ")} là “${G.win}”!`);
  if (MODE === "local") ls.del(SAVE_KEY);
  renderEnd();
  emitFx({ fx: "confetti" });
}
function renderEnd() {
  if (MODE === "host") { saveHost(); broadcastState(); }
  show("game");
  const el = $("#game");
  const ranked = S.players.slice().sort((a, b) => (b.alive - a.alive) || (b.tokens - a.tokens) || (a.marks - b.marks));
  const why = S.endReason === "last" ? "Người duy nhất còn trụ lại trên bàn!" : `Xấp ${esc(G.challenge)} đã hết – người giàu Token nhất chiến thắng!`;
  el.innerHTML = `<div class="topbar"><img class="logo" src="${A("logo")}"><span class="sp"></span><button class="btn sm" id="eHome">🏠 Trang chủ</button></div>
  <div class="end"><div class="panel" style="padding:24px">
    <div class="trophy">🏆</div>
    <div class="hint">${why}</div>
    <h1 class="disp" style="font-size:40px;margin:8px 0">${S.winner.map(nameOf).join(" & ")}</h1>
    <div style="font-weight:800;font-size:20px;color:var(--p1)">“${esc(G.win)}”</div>
    <table class="rank"><tr><th>#</th><th>Người chơi</th><th>Token</th><th>${esc(G.markShort)}</th><th></th></tr>
    ${ranked.map((p, i) => `<tr><td>${i + 1}</td><td><span class="rdot" style="background:${p.color}"></span> ${esc(p.name)}</td><td>${p.tokens}</td><td>${p.marks}/3</td><td>${p.alive ? "" : "💀"}</td></tr>`).join("")}</table>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      ${MODE === "client" ? `<div class="hint">Chờ chủ phòng mở ván mới… hoặc</div>` : `<button class="btn big pink" id="eAgain">↺ Chơi lại (cùng nhóm)</button>`}
      <button class="btn big" id="eSwitch">${MODE === "client" ? "Rời phòng" : "Về trang chủ"}</button>
    </div></div></div>`;
  $("#eHome").onclick = renderHome;
  $("#eSwitch").onclick = () => { if (MODE === "client") ls.del(CLIENT_KEY); if (MODE === "host") ls.del(HOST_KEY); renderHome(); };
  const ag = $("#eAgain");
  if (ag) ag.onclick = () => {
    if (MODE === "host") { NET.started = true; newGame(NET.roster.map(r => ({ id: r.pid, name: r.name })), NET.roster[0].pid); saveHost(); }
    else { const list = S.players.map(p => ({ id: p.id, name: p.name })); newGame(list, list[0].id); }
  };
}
function confetti() {
  const cols = ["#EC138C", "#FFD200", "#3BB54A", "#7280ED", "#F47B20"];
  for (let i = 0; i < 90; i++) {
    const c = document.createElement("div"); c.className = "confetti";
    c.style.left = Math.random() * 100 + "vw"; c.style.background = cols[i % cols.length];
    c.style.animationDuration = 2 + Math.random() * 2.5 + "s"; c.style.animationDelay = Math.random() * .8 + "s";
    document.body.appendChild(c); setTimeout(() => c.remove(), 5500);
  }
}

/* ================= BÀI TRÊN TAY ================= */
function openHand(pid) {
  if (online()) { if (pid === ME) showHand(pid); return; }
  const p = P(pid);
  const cover = document.createElement("div");
  cover.innerHTML = `<div class="cover"><div class="big">🤫</div><h2 class="disp">Đưa máy cho ${esc(p.name)}</h2><p>Bài là bí mật – người khác quay mặt đi nhé!</p></div>`;
  const md = modal({ title: `Bài của ${esc(p.name)}`, body: cover, buttons: [{ label: "Đóng" }, { label: "👀 Mở bài", cls: "pink", keep: true, onClick: () => { md.close(); showHand(pid); } }] });
}
function showHand(pid) {
  const p = P(pid);
  const box = document.createElement("div");
  if (!p.hand.length) box.innerHTML = `<p>Bạn chưa có ${esc(G.special)} nào. Đoán trúng ô ra 2–3 mặt để rút thêm!</p>`;
  else {
    box.innerHTML = `<div class="hand">${p.hand.map((cid, i) => {
      const c = card(cid); const v = canUse(p, c);
      return `<div class="hcard"><img src="${A(cid)}" alt="${esc(c.title)}"><b style="font-size:14px">${esc(c.title)}</b><div style="font-size:13px">${esc(c.text)}</div>
      <button class="btn sm ${v.ok ? "pink" : ""}" data-use="${i}" ${v.ok ? "" : "disabled"}>Tung thẻ</button><div class="why">${v.ok ? "" : esc(v.why)}</div></div>`;
    }).join("")}</div>`;
  }
  const md = modal({ title: `Bài của ${esc(p.name)}`, body: box, wide: true, buttons: [{ label: "Úp bài lại" }] });
  box.querySelectorAll("[data-use]").forEach(b => b.onclick = () => { md.close(); chooseAndUse(pid, p.hand[+b.dataset.use]); });
}
function canUse(p, c) {
  const no = why => ({ ok: false, why });
  if (!p || !p.alive) return no("Bạn đã bị loại");
  if (S.phase === "over") return no("Ván đã kết thúc");
  if (S.pend) return no("Đang chờ xử lý thẻ khác");
  if (p.flags.ban === S.turn) return no("Bạn đang bị cấm dùng thẻ lượt này");
  if (S.phase === "rolling-tmp") return no("Đang lắc xúc xắc…");
  const others = alive().filter(o => o.id !== p.id);
  const inCh = S.phase === "challenge" && S.cur;
  const ch = inCh ? card(S.cur.id) : null;
  const targeted = inCh && (ch.g === "C" ? S.cur.victim === p.id : S.cur.losers.includes(p.id));
  switch (c.eff) {
    case "removeMark": return p.marks > 0 ? { ok: true } : no(`Bạn chưa có ${G.mark} nào`);
    case "bonus2": return S.bank > 0 ? { ok: true } : no("Quỹ đã cạn");
    case "passMark": if (p.marks <= 0) return no(`Bạn chưa có ${G.mark} nào`); return passTargets(p).length ? { ok: true } : no("Không có ai để chuyển");
    case "steal": return others.some(o => o.tokens > 0) ? { ok: true } : no("Không ai có Token");
    case "exempt": return inCh && ch.g !== "C" && targeted ? { ok: true } : no("Dùng khi bạn đang bị chọn thua mini-game");
    case "shield": return targeted ? { ok: true } : no(`Dùng khi bạn đang dính ${G.challenge}`);
    case "ooo": return p.flags.immune === S.turn ? no("Bạn đang Out-of-Office rồi") : { ok: true };
    case "refund": return (S.lost[p.id] || 0) > 0 && ["resolved", "challenge", "done"].includes(S.phase) ? { ok: true } : no("Dùng sau khi bạn vừa cược thua ở lượt này");
    case "draw2": return S.specialDeck.length + S.specialDiscard.length ? { ok: true } : no("Hết bài để rút");
    case "delegate": return inCh && ch.g !== "C" && targeted && others.length ? { ok: true } : no("Dùng khi bạn đang bị chọn thua mini-game");
    case "lateBet": return p.flags.lateBet === S.turn + 1 ? no("Đã kích hoạt cho lượt sau") : { ok: true };
    case "swap": return S.phase === "bet" && betSum(p.id) > 0 && others.some(o => betSum(o.id) > 0) ? { ok: true } : no("Dùng trong lúc đặt cược, khi cả 2 đã có cược");
    case "veto": return no("Chỉ dùng khi người khác vừa tung thẻ");
  }
  return no("");
}
function passTargets(p) {
  const others = alive().filter(o => o.id !== p.id);
  if (G.passMode === "any") return others.map(o => o.id);
  const ring = alive(); const i = ring.findIndex(o => o.id === p.id);
  const set = new Set([ring[(i + 1) % ring.length].id, ring[(i - 1 + ring.length) % ring.length].id]); set.delete(p.id);
  return [...set];
}
function stealTargets(pid) {
  const others = alive().filter(o => o.id !== pid); const max = Math.max(...others.map(o => o.tokens));
  return others.filter(o => o.tokens === max).map(o => o.id);
}
// chọn mục tiêu ở máy người dùng, rồi gửi hành động
function chooseAndUse(pid, cid) {
  const p = P(pid), c = card(cid);
  const v = canUse(p, c); if (!v.ok) { toast(v.why); return; }
  const go = target => act({ k: "use", pid, cid, target });
  if (c.eff === "passMark") return pickPlayer(`Chuyển 1 ${esc(G.markShort)} cho ai?`, passTargets(p), go, G.passMode === "neighbor" ? "Chỉ được chuyển cho đồng nghiệp ngồi bên cạnh." : "");
  if (c.eff === "delegate") return pickPlayer("Ai chịu phạt thay bạn?", alive().filter(o => o.id !== pid).map(o => o.id), go);
  if (c.eff === "swap") return pickPlayer("Hoán đổi vị trí cược với ai?", alive().filter(o => o.id !== pid && betSum(o.id) > 0).map(o => o.id), go);
  if (c.eff === "steal") { const top = stealTargets(pid); if (top.length > 1) return pickPlayer("Nhiều người cùng giàu nhất – chọn 1 người:", top, go); return go(top[0]); }
  go(null);
}
// chạy trên máy chủ phòng / máy local
function useCard(pid, cid, target) {
  const p = P(pid); if (!p) return;
  const c = card(cid);
  if (!c || !p.hand.includes(cid)) { tell(pid, "Bạn không có thẻ này."); return; }
  const v = canUse(p, c); if (!v.ok) { tell(pid, esc(v.why)); return; }
  const others = alive().filter(o => o.id !== pid).map(o => o.id);
  if (["passMark", "delegate", "swap", "steal"].includes(c.eff)) {
    const valid = c.eff === "passMark" ? passTargets(p) : c.eff === "steal" ? stealTargets(pid) : c.eff === "swap" ? others.filter(o => betSum(o) > 0) : others;
    if (!valid.includes(target)) { tell(pid, "Mục tiêu không hợp lệ."); return; }
  }
  p.hand.splice(p.hand.indexOf(cid), 1); S.specialDiscard.push(cid);
  S.pend = { pid, cid, target: target || null };
  log(`🃏 ${esc(p.name)} tung “${esc(c.title)}”…`);
  armPend();
  emitFx({ fx: "sfx", k: "beep", f: 660 });
  renderGame();
}
function armPend() {
  clearTimeout(pendTimeout);
  if (MODE !== "host") return;
  pendDeadline = Date.now() + VETO_MS;
  pendTimeout = setTimeout(() => { if (S && S.pend) execPending(); }, VETO_MS);
}
function doVeto(voter) {
  const pd = S.pend; if (!pd) return;
  const o = P(voter); if (!o || !o.alive || voter === pd.pid) return;
  if (o.flags.ban === S.turn) { tell(voter, "Bạn đang bị cấm dùng thẻ."); return; }
  const vetoName = card("s12").title;
  const idx = o.hand.indexOf("s12");
  if (idx < 0) { tell(voter, `${esc(o.name)} không có thẻ ${esc(vetoName)} đâu nha 😜`); return; }
  clearTimeout(pendTimeout);
  o.hand.splice(idx, 1); S.specialDiscard.push("s12");
  const c = card(pd.cid), p = P(pd.pid);
  S.pend = null;
  log(`🚫 ${esc(o.name)} dùng “${esc(vetoName)}” chặn thẻ “${esc(c.title)}” của ${esc(p.name)}!`);
  emitFx({ fx: "vetoed", by: o.name, card: c.title, of: p.name });
  renderGame();
}
function execPending() {
  clearTimeout(pendTimeout);
  const pd = S.pend; if (!pd) return;
  S.pend = null;
  const pid = pd.pid, target = pd.target;
  const p = P(pid), c = card(pd.cid), n = esc(p.name);
  let msg = "";
  switch (c.eff) {
    case "removeMark": p.marks = Math.max(0, p.marks - 1); msg = `${n} xóa 1 ${G.mark} (còn ${p.marks}/3).`; break;
    case "bonus2": { const x = Math.min(2, S.bank); S.bank -= x; p.tokens += x; msg = `${n} nhận ${x} Token từ Quỹ.`; break; }
    case "passMark": { const t = P(target); if (p.marks > 0 && t.alive) { p.marks--; t.marks++; msg = `${n} chuyển 1 ${G.mark} sang ${esc(t.name)} (${t.marks}/3).`; } else msg = "Thẻ không còn tác dụng."; break; }
    case "steal": { const t = P(target); const x = Math.min(G.stealN, t.tokens); t.tokens -= x; p.tokens += x; msg = `${esc(t.name)} phải “chia sẻ” ${x} Token cho ${n}.`; break; }
    case "exempt": removeTarget(pid); msg = `${n} được miễn trừ mini-game này!`; break;
    case "shield": removeTarget(pid); msg = `${n} miễn nhiễm với ${G.challenge} này!`; break;
    case "ooo": p.flags.immune = S.turn; removeTarget(pid); msg = `${n} bật Out-of-Office – miễn nhiễm mọi ${G.challenge} trong lượt này.`; break;
    case "refund": { const x = Math.min(S.lost[pid] || 0, S.bank); S.bank -= x; p.tokens += x; S.lost[pid] = 0; msg = `${n} lấy lại ${x} Token vừa cược thua.`; break; }
    case "draw2": { const g = drawSpecial(pid, 2); msg = `${n} rút thêm ${g} ${G.special}.`; break; }
    case "delegate": { const i = S.cur ? S.cur.losers.indexOf(pid) : -1; if (i >= 0) { S.cur.losers[i] = target; msg = `${esc(P(target).name)} phải chịu phạt thay ${n}!`; } else msg = "Thẻ không còn tác dụng."; break; }
    case "lateBet": p.flags.lateBet = S.turn + 1; msg = `${n} sẽ được đặt cược SAU khi xúc xắc đổ ở lượt sau.`; break;
    case "swap": {
      const t = P(target); const sa = betSum(pid), sb = betSum(target);
      if (S.phase !== "bet" || p.tokens + sa - sb < 0 || t.tokens + sb - sa < 0) { msg = `Không hoán đổi được – thẻ mất tác dụng.`; break; }
      const a = S.bets[pid]; S.bets[pid] = S.bets[target]; S.bets[target] = a; p.tokens += sa - sb; t.tokens += sb - sa;
      msg = `${n} hoán đổi toàn bộ vị trí cược với ${esc(t.name)}!`; break;
    }
  }
  log(`🃏 “${esc(c.title)}”: ${msg}`);
  emitFx({ fx: "toast", msg: "🃏 " + msg, ms: 3400 });
  if (!checkElims()) renderGame();
}
function removeTarget(pid) {
  if (!S.cur) return;
  if (card(S.cur.id).g === "C") { if (S.cur.victim === pid) S.cur.victim = null; }
  else { const i = S.cur.losers.indexOf(pid); if (i >= 0) S.cur.losers.splice(i, 1); }
}

/* ================= KHỞI ĐỘNG ================= */
document.querySelectorAll(".gcard").forEach(b => b.onclick = () => { G = GAMES[b.dataset.game]; setupNames = []; setupMode = "local"; renderSetup(); });
renderHome();
const qs = new URLSearchParams(location.search);
const jc = (qs.get("join") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
if (jc) {
  $("#joinCode").value = jc;
  let cs = null; try { cs = JSON.parse(sessionStorage.getItem(CLIENT_KEY) || "null"); } catch (e) {}
  cs = cs || ls.get(CLIENT_KEY);
  if (cs && cs.code === jc && cs.name) joinRoom(jc, cs.name);
  else { $("#joinBox").classList.add("pulse"); $("#joinName").focus(); toast(`Nhập tên rồi bấm “Vào phòng ${jc}” nhé!`, 4000); $("#joinBtn").textContent = `Vào phòng ${jc} ▶`; }
}
window.addEventListener("beforeunload", e => { if (MODE === "host" && NET.started) { e.preventDefault(); e.returnValue = ""; } });

// hook kiểm thử
window.__zd = { get S() { return S; }, get G() { return G; }, get MODE() { return MODE; }, get ME() { return ME; }, get NET() { return NET; } };
})();
