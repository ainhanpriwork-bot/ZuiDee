/* Zui Dee – engine dùng chung cho HỌC ĐẠI ĐI & LÀM ĐẠI ĐI */
(() => {
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const COLORS = ["#FB5231", "#7280ED", "#3BB54A", "#EC138C", "#F9A825", "#1B475D"];
const SAVE_KEY = "zuidee_save_v1";

let G = null;   // config game hiện tại
let S = null;   // state ván chơi
let selBettor = null;
let rolling = false;
let timerInt = null;
let soundOn = true;
let actx = null;

/* ---------------- tiện ích ---------------- */
const A = p => `assets/${G.id}/${p}.webp`;
const card = id => G.challenges.find(c => c.id === id) || G.specials.find(c => c.id === id);
const P = id => S.players.find(p => p.id === id);
const alive = () => S.players.filter(p => p.alive);
const nameOf = id => esc(P(id)?.name || "?");
const dot = p => `<span class="av" style="background:${p.color}"></span>`;
const tokImg = () => `assets/${G.id}/token.webp`;

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
const buzz = () => { beep(140, .5, "sawtooth", .09); };

function toast(msg, ms = 2600) {
  const t = document.createElement("div"); t.className = "toast"; t.innerHTML = msg;
  $("#toast").appendChild(t); setTimeout(() => t.remove(), ms);
}
function log(msg) { S.log.unshift(msg); if (S.log.length > 80) S.log.pop(); }
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ g: G.id, s: S })); } catch (e) {} }
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

/* ---------------- modal ---------------- */
function modal({ title, body, buttons = [], close = true, wide = false }) {
  const root = $("#modalRoot");
  const m = document.createElement("div"); m.className = "mask";
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
  root.appendChild(m);
  return { el: m, close: closeIt, body: mb };
}
function pickPlayer(title, ids, cb, note = "") {
  const box = document.createElement("div");
  box.innerHTML = (note ? `<p>${note}</p>` : "") + `<div class="pickers">${ids.map(id => { const p = P(id); return `<button class="pick" data-id="${id}">${dot(p)}${esc(p.name)}</button>`; }).join("")}</div>`;
  const md = modal({ title, body: box });
  box.querySelectorAll(".pick").forEach(b => b.onclick = () => { md.close(); cb(b.dataset.id); });
}

/* ---------------- màn hình ---------------- */
function show(id) {
  ["home", "setup", "game"].forEach(s => $("#" + s).classList.toggle("hidden", s !== id));
  document.body.className = id === "home" ? "t-home" : "t-" + G.id;
  window.scrollTo(0, 0);
}

function renderHome() {
  G = null; document.body.className = "t-home";
  ["home", "setup", "game"].forEach(s => $("#" + s).classList.toggle("hidden", s !== "home"));
  let saved = null; try { saved = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); } catch (e) {}
  const rb = $("#resumeBox");
  if (saved && saved.s && saved.s.phase !== "over") {
    rb.classList.remove("hidden");
    rb.innerHTML = `<div><b>Có ván đang dở:</b> ${esc(GAMES[saved.g].title)} – lượt ${saved.s.turn}, ${saved.s.players.length} người chơi.</div><div style="display:flex;gap:8px"><button class="btn sm green" id="resumeBtn">▶ Chơi tiếp</button><button class="btn sm ghost" id="dropBtn">Bỏ ván</button></div>`;
    $("#resumeBtn").onclick = () => {
      G = GAMES[saved.g]; S = saved.s;
      if (S.phase === "rolling-tmp") { S.phase = "bet"; S.dice = []; }
      show("game"); renderGame();
    };
    $("#dropBtn").onclick = () => { clearSave(); renderHome(); };
  } else rb.classList.add("hidden");
}

/* ---------------- SETUP ---------------- */
let setupN = 4, setupNames = [], setupFirst = 0;
function renderSetup() {
  show("setup");
  const el = $("#setup");
  while (setupNames.length < 6) setupNames.push("");
  el.innerHTML = `<div class="panel setup-box">
    <div class="setup-hero"><img src="${A("logo")}" alt=""></div>
    ${G.id === "hdd" ? `<div class="strip" style="background-image:url(${A("strip_a1")})"></div>` : `<div class="strip"></div>`}
    <div class="setup-body">
      <h2 class="disp">Thiết lập ván chơi</h2>
      <div class="hint">${esc(G.audience)}. Mỗi người nhận <b>${G.startTokens} ${G.token}</b> + <b>1 ${G.special}</b> ngẫu nhiên; số Token còn lại vào <b>${G.bank}</b>.</div>
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
        <button class="btn" id="seeRules">📖 Luật chơi</button>
        <span style="flex:1"></span>
        <button class="btn big pink" id="startBtn">Bắt đầu ván! ▶</button>
      </div>
    </div></div>`;
  el.querySelectorAll("[data-n]").forEach(b => b.onclick = () => { setupN = +b.dataset.n; if (setupFirst >= setupN) setupFirst = 0; renderSetup(); });
  el.querySelectorAll("input[data-i]").forEach(inp => inp.oninput = () => setupNames[+inp.dataset.i] = inp.value);
  el.querySelectorAll("input[name=first]").forEach(r => r.onchange = () => setupFirst = +r.value);
  $("#backHome").onclick = renderHome;
  $("#seeRules").onclick = showRules;
  $("#startBtn").onclick = startGame;
}

function startGame() {
  const tag = G.id === "hdd" ? "Sinh viên" : "Đồng nghiệp";
  const sDeck = shuffle(G.specials.map(c => c.id));
  const players = Array.from({ length: setupN }, (_, i) => ({
    id: "p" + i, name: (setupNames[i] || "").trim() || `${tag} ${i + 1}`, color: COLORS[i],
    tokens: G.startTokens, marks: 0, hand: [sDeck.pop()], alive: true, flags: {}
  }));
  S = {
    players, bank: G.totalTokens - G.startTokens * setupN,
    challengeDeck: shuffle(G.challenges.map(c => c.id)), specialDeck: sDeck, specialDiscard: [],
    turn: 1, dealer: "p" + setupFirst, phase: "bet", bets: {}, dice: [], lost: {}, returned: {},
    results: null, cur: null, log: [], winner: null
  };
  players.forEach(p => S.bets[p.id] = {});
  log(`🎬 Ván mới bắt đầu! ${nameOf(S.dealer)} cầm cái đầu tiên.`);
  selBettor = null;
  show("game"); renderGame(); jingle();
}

/* ---------------- luật chơi ---------------- */
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
   <li><b>2. Lắc xúc xắc:</b> người cầm cái hô “${t.cry}” và bấm lắc 3 viên xúc xắc.</li>
   <li><b>3. Phân định:</b> ô ra <b>1 mặt</b> → nhận lại Token + thưởng bằng số đã cược từ Quỹ. Ô ra <b>2–3 mặt</b> → nhận lại Token + rút 1 ${t.special}. Ô không ra → mất Token vào Quỹ.</li>
   <li><b>4. Kiếp nạn tập thể:</b> nếu xúc xắc có mặt <b>“${t.trigger}”</b> hoặc ra <b>3 mặt giống nhau</b> → rút 1 ${t.challenge}, cả bàn cùng chơi mini-game. Người thua nhận 1 ${t.mark} hoặc mất Token theo thẻ.</li>
  </ul>
  <h4>🃏 ${t.special}</h4>
  <ul><li>Bấm <b>“Bài”</b> cạnh tên mình để xem bài bí mật và tung thẻ. Thẻ phòng thủ (miễn trừ, ủy quyền…) dùng khi bạn đang bị chọn là người thua.</li>
  <li>Khi ai đó tung thẻ, người đang giữ <b>${t.specials[11].title}</b> có thể bấm Veto để vô hiệu hóa.</li></ul>
  <h4>📇 ${t.challenge} (24 lá)</h4>
  <ul><li>Nhóm A – ${t.groups.A} (8) • Nhóm B – ${t.groups.B} (8) • Nhóm C – ${t.groups.C} (8)</li></ul>
  </div>`;
  modal({ title: "Luật chơi " + esc(t.title), body: html, buttons: [{ label: "Đã hiểu!", cls: "pink" }] });
}

/* ---------------- RENDER GAME ---------------- */
function renderGame() {
  const el = $("#game");
  if (S.phase === "over") { renderEnd(); return; }
  const deckLeft = S.challengeDeck.length;
  el.innerHTML = `
  <div class="topbar">
    <img class="logo" src="${A("logo")}" alt="">
    <span class="chip-stat">🔁 Lượt ${S.turn}</span>
    <span class="chip-stat alt">🃏 ${esc(G.challenge)}: ${deckLeft}/24</span>
    <span class="chip-stat alt"><img src="${tokImg()}" style="width:20px;height:20px;border-radius:50%">${esc(G.bank)}: ${S.bank}</span>
    <span class="sp"></span>
    <button class="btn sm" id="bRules">📖 Luật</button>
    <button class="btn sm" id="bSound">${soundOn ? "🔊" : "🔇"}</button>
    <button class="btn sm" id="bRestart">↺ Ván mới</button>
    <button class="btn sm" id="bHome">🏠</button>
  </div>
  ${G.id === "hdd" ? `<div class="strip" style="background-image:url(${A("strip_c1")})"></div>` : ""}
  <div class="layout">
    <div class="stage">
      <div class="phase-banner">${phaseBanner()}</div>
      ${S.phase === "challenge" ? challengeView() : ""}
      ${bettorBar()}
      <div class="mat" id="mat">${G.locs.map((n, i) => tileHTML(i + 1)).join("")}</div>
      <div class="tray">
        ${[0, 1, 2].map(i => S.dice[i] ? `<div class="die" data-d="${i}"><img src="${A("loc" + S.dice[i])}" alt="${esc(G.locs[S.dice[i] - 1])}"></div>` : `<div class="die blank" data-d="${i}">?</div>`).join("")}
        <div class="act">${actionArea()}</div>
      </div>
      ${S.results && S.phase !== "bet" ? resultsView() : ""}
    </div>
    <div class="side">
      ${S.players.map(playerCard).join("")}
      <div class="logbox"><h4>📜 Nhật ký ván</h4>${S.log.slice(0, 40).map(l => `<div>${l}</div>`).join("")}</div>
    </div>
  </div>
  <div class="foot">© Zui Dee Studio – ${esc(G.title)} • ${esc(G.slogan)}</div>`;
  bindGame();
  save();
}

function phaseBanner() {
  const d = nameOf(S.dealer);
  const map = {
    bet: [`Giai đoạn 1 – ${G.betPhase}`, `Chọn người chơi → bấm ô để đặt 1–3 Token. Cầm cái: 🎲 ${d}`],
    late: ["Cược muộn!", `Người có thẻ “${card("s10").title}” được đặt cược sau khi đã thấy xúc xắc.`],
    resolved: ["Giai đoạn 3 – Phân định cược", S.trigger ? "⚠️ Kiếp nạn đã kích hoạt! Rút thẻ ngay." : "Không có kiếp nạn – qua lượt mới."],
    challenge: [`Giai đoạn 4 – Kiếp nạn tập thể`, `Cầm cái 🎲 ${d} đọc to thẻ cho cả bàn!`],
    done: ["Hết lượt", "Kiểm tra bài, rồi qua lượt tiếp theo."]
  };
  const [t, s] = map[S.phase] || ["", ""];
  return `<div><div class="t">${t}</div><div class="s">${s}</div></div>`;
}

function bettorBar() {
  if (!(S.phase === "bet" || S.phase === "late")) return "";
  const elig = bettorsEligible();
  if (!selBettor || !elig.includes(selBettor)) selBettor = elig[0] || null;
  return `<div class="bettors">${alive().map(p => {
    const on = elig.includes(p.id);
    const used = betSum(p.id);
    let why = "";
    if (!on) why = p.flags.skipBet === S.turn ? "mất lượt" : (S.phase === "late" ? "đã chốt" : "hết token");
    return `<button class="bettor ${p.id === selBettor ? "on" : ""} ${on ? "" : "off"}" data-b="${p.id}" ${on ? "" : "disabled"}>${dot(p)}${esc(p.name)} <em>${on ? `${used}/3 đã cược` : why}</em></button>`;
  }).join("")}</div>`;
}

function tileHTML(n) {
  const cnt = S.dice.filter(d => d === n).length;
  const showRes = S.dice.length && !rolling && S.phase !== "bet";
  let chips = "";
  S.players.forEach(p => { const b = S.bets[p.id]?.[n]; if (b) chips += `<span class="chipT" data-chip="${p.id}" data-loc="${n}" style="background:${p.color}" title="${esc(p.name)}">${b}<small>${esc(p.name)}</small></span>`; });
  return `<div class="tile ${showRes ? (cnt ? "hit" : "dim") : ""}" data-loc="${n}">
    <img src="${A("loc" + n)}" alt="${esc(G.locs[n - 1])}">
    ${showRes && cnt ? `<span class="hitcount">×${cnt}</span>` : ""}
    <div class="bets">${chips}</div></div>`;
}

function actionArea() {
  if (S.phase === "bet") {
    return `<button class="btn huge pink" id="bRoll">🎲 ${esc(G.cry)}</button>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" id="bTimer5">⏱ Đếm 5 giây đặt cược</button><button class="btn sm ghost" id="bClear">Xóa cược của người đang chọn</button></div>`;
  }
  if (S.phase === "late") return `<button class="btn huge green" id="bLateDone">✅ Chốt cược muộn & phân định</button>`;
  if (S.phase === "resolved") {
    return S.trigger
      ? `<button class="btn huge red" id="bDraw">🔥 Rút ${esc(G.challenge)}!</button><div class="hint">Lý do: ${S.triggerWhy}</div>`
      : `<button class="btn huge green" id="bNext">Lượt tiếp theo ▶</button>`;
  }
  if (S.phase === "challenge") return `<div class="hint" style="font-weight:700">⬆️ Xử lý ${esc(G.challenge)} ở phía trên trước nhé.</div>`;
  if (S.phase === "done") return `<button class="btn huge green" id="bNext">Lượt tiếp theo ▶</button>`;
  return "";
}

function playerCard(p) {
  const marks = [0, 1, 2].map(i => `<i class="${i < p.marks ? "on" : ""}" style="${i < p.marks ? `background-image:url(${A("mark")})` : ""}"></i>`).join("");
  const b = [];
  if (p.id === S.dealer && p.alive) b.push(`<span class="badge">🎲 Cầm cái</span>`);
  if (!p.alive) b.push(`<span class="badge r">💀 ${esc(G.elim)}</span>`);
  if (p.flags.skipBet === S.turn) b.push(`<span class="badge r">Mất lượt cược</span>`);
  else if (p.flags.skipBet === S.turn + 1) b.push(`<span class="badge r">Mất lượt cược lượt sau</span>`);
  if (p.flags.ban === S.turn) b.push(`<span class="badge r">Cấm dùng thẻ</span>`);
  else if (p.flags.ban === S.turn + 1) b.push(`<span class="badge r">Cấm thẻ lượt sau</span>`);
  if (p.flags.immune === S.turn) b.push(`<span class="badge b">🛡️ Out-of-Office</span>`);
  if (p.flags.lateBet === S.turn) b.push(`<span class="badge g">⚡ Cược muộn</span>`);
  else if (p.flags.lateBet === S.turn + 1) b.push(`<span class="badge g">⚡ Cược muộn lượt sau</span>`);
  return `<div class="pl ${p.alive ? "" : "dead"} ${p.id === S.dealer && p.alive ? "dealer" : ""}">
    <div class="av" style="background:${p.color}">${esc(p.name[0].toUpperCase())}</div>
    <div class="nm">${esc(p.name)}</div>
    <div>${p.alive ? `<button class="btn sm yellow" data-hand="${p.id}">🃏 Bài (${p.hand.length})</button>` : ""}</div>
    <div class="row2"><span class="tok"><img src="${tokImg()}" alt="">${p.tokens}</span><span class="marks" title="${esc(G.mark)}">${marks}</span></div>
    <div></div>
    ${b.length ? `<div class="badges">${b.join("")}</div>` : ""}
  </div>`;
}

function resultsView() {
  const r = S.results; if (!r) return "";
  return `<div class="results"><h3 class="disp">Kết quả lượt ${S.turn}</h3>${r.length ? r.map(x => `<div class="res-line">${dot(P(x.p))}<div>${x.t}</div></div>`).join("") : "<div class='res-line'>Không ai đặt cược lượt này.</div>"}</div>`;
}

function challengeView() {
  const c = card(S.cur.id);
  const isMini = c.g !== "C";
  let pen = "";
  if (isMini) pen = c.pen.t === "mark" ? `Thua: Nhận 1 ${G.mark}` : `Thua: Mất ${c.pen.n} ${G.token}`;
  const pickers = isMini
    ? `<div style="font-weight:800;margin-top:10px">Ai thua? <span class="hint">(bấm chọn – có thể chọn nhiều người)</span></div>
       <div class="pickers">${alive().map(p => `<button class="pick ${S.cur.losers.includes(p.id) ? "on" : ""}" data-loser="${p.id}">${dot(p)}${esc(p.name)}${countIn(S.cur.losers, p.id) > 1 ? " ×" + countIn(S.cur.losers, p.id) : ""}</button>`).join("")}</div>`
    : `<div style="font-weight:800;margin-top:10px">Ai dính kiếp nạn này? <span class="hint">(mặc định: người cầm cái đã rút thẻ)</span></div>
       <div class="pickers">${alive().map(p => `<button class="pick ${S.cur.victim === p.id ? "on" : ""}" data-victim="${p.id}">${dot(p)}${esc(p.name)}</button>`).join("")}</div>`;
  const riddle = c.riddle ? `<div class="riddle" id="riddleBox">${S.cur.riddle != null ? `❓ ${esc(RIDDLES[S.cur.riddle][0])}<br><span id="ans" class="hidden">💡 ${esc(RIDDLES[S.cur.riddle][1])}</span> <button class="btn sm" id="bAns">Xem đáp án</button>` : ""} <button class="btn sm" id="bRiddle">🎲 ${S.cur.riddle != null ? "Câu khác" : "Bốc câu đố mẹo"}</button></div>` : "";
  const timer = c.secs ? `<div class="timer"><span class="num" id="tNum">${c.secs}</span><button class="btn yellow" id="bTimer" data-s="${c.secs}">⏱ Bấm giờ ${c.secs}s</button></div>` : `<div class="timer"><button class="btn sm" id="bTimer" data-s="10">⏱ Bấm giờ 10s (tùy chọn)</button><span class="num hidden" id="tNum">10</span></div>`;
  return `<div class="chal">
    <div class="cardimg flip"><img src="${A(c.id)}" alt="${esc(c.title)}"></div>
    <div>
      <span class="grp">Nhóm ${c.g} – ${esc(G.groups[c.g])}</span>
      <h3 class="disp">${esc(c.title)}</h3>
      <div class="txt">${esc(c.text)}</div>
      ${pen ? `<div class="pen">⚠️ ${pen}</div>` : ""}
      ${riddle}${timer}
      ${pickers}
      <div class="hint">💡 Người bị chọn có thể mở “🃏 Bài” để tung thẻ cứu nguy (${isMini ? "miễn trừ / ủy quyền / " : ""}${G.immunity === "shield" ? card("s7").title : card("s7").title}) <b>trước khi</b> bấm Xử phạt.</div>
      <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap">
        <button class="btn big red" id="bApply">⚖️ Xử phạt</button>
        ${isMini ? `<button class="btn ghost" id="bNoLoser">Không ai thua</button>` : ""}
      </div>
    </div></div>`;
}
const countIn = (arr, id) => arr.filter(x => x === id).length;

/* ---------------- bind ---------------- */
function bindGame() {
  $("#bRules").onclick = showRules;
  $("#bSound").onclick = () => { soundOn = !soundOn; renderGame(); };
  $("#bHome").onclick = () => modal({ title: "Về trang chủ?", body: "Ván đang chơi được lưu lại, bạn có thể chơi tiếp sau.", buttons: [{ label: "Ở lại" }, { label: "Về trang chủ", cls: "pink", onClick: () => { save(); renderHome(); } }] });
  $("#bRestart").onclick = () => modal({ title: "Chơi ván mới?", body: "Ván hiện tại sẽ bị xóa.", buttons: [{ label: "Hủy" }, { label: "Ván mới", cls: "pink", onClick: () => { clearSave(); renderSetup(); } }] });
  document.querySelectorAll("[data-b]").forEach(b => b.onclick = () => { selBettor = b.dataset.b; renderGame(); });
  document.querySelectorAll(".tile").forEach(t => t.onclick = () => addBet(+t.dataset.loc));
  document.querySelectorAll("[data-chip]").forEach(c => c.onclick = e => { e.stopPropagation(); removeBet(c.dataset.chip, +c.dataset.loc); });
  document.querySelectorAll("[data-hand]").forEach(b => b.onclick = () => openHand(b.dataset.hand));
  const on = (id, fn) => { const e = $("#" + id); if (e) e.onclick = fn; };
  on("bRoll", tryRoll); on("bLateDone", resolve); on("bDraw", drawChallenge); on("bNext", nextTurn);
  on("bClear", () => { if (selBettor) { refundBets(selBettor); renderGame(); } });
  on("bTimer5", e => startTimer(5, null, e.target));
  on("bApply", applyChallenge);
  on("bNoLoser", () => { S.cur.losers = []; S.cur.victim = null; applyChallenge(); });
  on("bTimer", e => startTimer(+e.target.dataset.s, $("#tNum"), e.target));
  on("bRiddle", () => { let r; do { r = Math.floor(Math.random() * RIDDLES.length); } while (r === S.cur.riddle && RIDDLES.length > 1); S.cur.riddle = r; renderGame(); });
  on("bAns", () => $("#ans").classList.remove("hidden"));
  document.querySelectorAll("[data-loser]").forEach(b => b.onclick = () => {
    const id = b.dataset.loser; const i = S.cur.losers.indexOf(id);
    if (i >= 0) S.cur.losers.splice(i, 1); else S.cur.losers.push(id); renderGame();
  });
  document.querySelectorAll("[data-victim]").forEach(b => b.onclick = () => { S.cur.victim = S.cur.victim === b.dataset.victim ? null : b.dataset.victim; renderGame(); });
}

function startTimer(secs, numEl, btn) {
  clearInterval(timerInt);
  let t = secs;
  const label = btn ? btn.innerHTML : "";
  if (numEl) { numEl.classList.remove("hidden", "alarm"); numEl.textContent = t; }
  if (btn) btn.innerHTML = `⏳ ${t}`;
  beep(700, .08);
  timerInt = setInterval(() => {
    t--;
    if (numEl && document.body.contains(numEl)) numEl.textContent = t;
    if (btn && document.body.contains(btn)) btn.innerHTML = t > 0 ? `⏳ ${t}` : "⏰ HẾT GIỜ!";
    if (t > 0) beep(t <= 3 ? 880 : 600, .06);
    if (t <= 0) {
      clearInterval(timerInt); buzz();
      if (numEl && document.body.contains(numEl)) numEl.classList.add("alarm");
      setTimeout(() => { if (btn && document.body.contains(btn)) btn.innerHTML = label; }, 2200);
    }
  }, 1000);
}

/* ---------------- ĐẶT CƯỢC ---------------- */
const betSum = id => Object.values(S.bets[id] || {}).reduce((a, b) => a + b, 0);
function bettorsEligible() {
  return alive().filter(p => {
    if (p.flags.skipBet === S.turn) return false;
    if (S.phase === "late") return p.flags.lateBet === S.turn;
    if (p.flags.lateBet === S.turn) return false; // cược sau khi đổ
    return p.tokens + betSum(p.id) > 0;
  }).map(p => p.id);
}
function addBet(loc) {
  if (!(S.phase === "bet" || S.phase === "late")) return;
  if (!selBettor) { toast("Chọn người đặt cược trước nhé!"); return; }
  const p = P(selBettor);
  if (betSum(p.id) >= 3) { toast(`${esc(p.name)} đã cược đủ 3 Token rồi!`); return; }
  if (p.tokens <= 0) { toast(`${esc(p.name)} hết Token rồi 😢`); return; }
  p.tokens--; S.bets[p.id][loc] = (S.bets[p.id][loc] || 0) + 1; beep(440 + loc * 40, .05, "triangle");
  renderGame();
}
function removeBet(pid, loc) {
  if (!(S.phase === "bet" || S.phase === "late")) return;
  if (S.phase === "late" && P(pid).flags.lateBet !== S.turn) return;
  const b = S.bets[pid]; if (!b[loc]) return;
  b[loc]--; if (!b[loc]) delete b[loc]; P(pid).tokens++; beep(300, .05, "triangle"); selBettor = pid;
  renderGame();
}
function refundBets(pid) { const p = P(pid); p.tokens += betSum(pid); S.bets[pid] = {}; }

function tryRoll() {
  if (rolling) return;
  const elig = bettorsEligible();
  const missing = elig.filter(id => betSum(id) === 0 && P(id).tokens > 0);
  if (missing.length) {
    modal({ title: "Có người chưa cược!", body: `<p>${missing.map(nameOf).join(", ")} chưa đặt Token nào (luật: mỗi người đặt 1–3 Token).</p>`, buttons: [{ label: "Quay lại đặt" }, { label: "Vẫn lắc!", cls: "pink", onClick: roll }] });
    return;
  }
  roll();
}

function roll() {
  rolling = true;
  S.dice = [rnd6(), rnd6(), rnd6()];
  S.phase = "rolling-tmp";
  renderGame();
  const dice = document.querySelectorAll(".die");
  dice.forEach(d => d.classList.add("rolling"));
  const final = [rnd6(), rnd6(), rnd6()];
  let k = 0;
  const iv = setInterval(() => {
    k++;
    dice.forEach((d, i) => { const f = k > 8 + i * 3 ? final[i] : rnd6(); d.innerHTML = `<img src="${A("loc" + f)}">`; if (k === 9 + i * 3) { d.classList.remove("rolling"); beep(220 + i * 80, .12, "square"); } });
    if (k % 2) beep(180 + Math.random() * 120, .03, "square", .03);
    if (k >= 16) {
      clearInterval(iv); rolling = false; S.dice = final;
      log(`🎲 ${nameOf(S.dealer)} lắc ra: ${final.map(f => G.locs[f - 1]).join(" • ")}`);
      const late = alive().filter(p => p.flags.lateBet === S.turn && p.flags.skipBet !== S.turn);
      if (late.length) { S.phase = "late"; selBettor = late[0].id; toast(`⚡ ${late.map(p => esc(p.name)).join(", ")} được cược muộn!`); renderGame(); }
      else resolve();
    }
  }, 90);
}
const rnd6 = () => 1 + Math.floor(Math.random() * 6);

/* ---------------- PHÂN ĐỊNH ---------------- */
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
  S.triggerWhy = [has6 ? `xuất hiện mặt “${G.trigger}”` : "", all3 ? "3 mặt giống hệt nhau" : ""].filter(Boolean).join(" + ");
  S.phase = "resolved";
  if (S.trigger) { log(`🔥 Kiếp nạn kích hoạt (${S.triggerWhy})!`); buzz(); } else jingle();
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

/* ---------------- KIẾP NẠN ---------------- */
function drawChallenge() {
  const id = S.challengeDeck.pop();
  if (!id) { endGame("deck"); return; }
  S.cur = { id, losers: [], victim: card(id).g === "C" ? (P(S.dealer).alive ? S.dealer : alive()[0].id) : null, riddle: null };
  S.phase = "challenge";
  log(`📇 Rút ${G.challenge}: <b>${esc(card(id).title)}</b> (nhóm ${card(id).g}).`);
  beep(330, .2, "sawtooth", .05);
  renderGame();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function applyChallenge() {
  clearInterval(timerInt);
  const c = card(S.cur.id);
  let chain = false;
  if (c.g !== "C") {
    if (!S.cur.losers.length) log("😎 Không ai thua mini-game này.");
    S.cur.losers.forEach(id => {
      const p = P(id); if (!p.alive) return;
      if (p.flags.immune === S.turn) { log(`🛡️ ${nameOf(id)} đang Out-of-Office – miễn nhiễm!`); return; }
      if (c.pen.t === "mark") { p.marks++; log(`🙈 ${nameOf(id)} nhận 1 ${G.mark} (${p.marks}/3).`); toast(`${esc(p.name)} +1 ${esc(G.markShort)}!`); }
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
        case "directMark": v.marks++; log(`🙈 ${n} nhận thẳng 1 ${G.mark} (${v.marks}/3).`); toast(`${n} +1 ${esc(G.markShort)}!`); break;
        case "forfeitBets": { const r = Math.min(S.returned[v.id] || 0, v.tokens); v.tokens -= r; S.bank += r; S.returned[v.id] = 0; log(`💸 ${n} bị thu hồi ${r} Token đã cược lượt này.`); break; }
      }
    }
  }
  S.cur = null;
  if (checkElims()) return;
  if (chain) {
    if (S.challengeDeck.length) { toast(`📇 Rút thêm 1 ${esc(G.challenge)}!`); drawChallenge(); return; }
  }
  if (!S.challengeDeck.length) { endGame("deck"); return; }
  S.phase = "done";
  renderGame();
}

function checkElims() {
  let any = false;
  S.players.forEach(p => {
    if (p.alive && p.marks >= 3) {
      p.alive = false; any = true;
      S.bank += p.tokens; p.tokens = 0; S.specialDiscard.push(...p.hand); p.hand = [];
      Object.values(S.bets[p.id] || {}); S.bets[p.id] = {};
      log(`💀 <b>${esc(p.name)}</b> dính đủ 3 ${G.mark} → “${G.elim}”!`);
      modal({ title: G.elim + "!", body: `<div class="reveal"><img src="${A("mark")}" alt=""><div class="rt"><h2 class="disp" style="margin:0">${esc(p.name)}</h2><p>đã tích đủ 3 ${esc(G.mark)} và bị loại khỏi ván chơi. Token còn lại về ${esc(G.bank)}.</p></div></div>`, buttons: [{ label: "Tiễn đồng chí 🫡", cls: "pink" }] });
      buzz();
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
  S.phase = "bet"; selBettor = null;
  log(`— Lượt ${S.turn}: ${nameOf(S.dealer)} cầm cái —`);
  alive().forEach(p => { if (p.flags.skipBet === S.turn) log(`🚫 ${esc(p.name)} mất lượt cược lượt này.`); });
  renderGame();
}

/* ---------------- KẾT THÚC ---------------- */
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
  S.winner = winners.map(p => p.id); S.endReason = reason; S.phase = "over";
  log(`🏆 ${winners.map(p => esc(p.name)).join(" & ")} là “${G.win}”!`);
  renderEnd(); clearSave(); jingle(); confetti();
}
function renderEnd() {
  const el = $("#game");
  const ranked = S.players.slice().sort((a, b) => (b.alive - a.alive) || (b.tokens - a.tokens) || (a.marks - b.marks));
  const why = S.endReason === "last" ? "Người duy nhất còn trụ lại trên bàn!" : `Xấp ${G.challenge} đã hết – người giàu Token nhất chiến thắng!`;
  el.innerHTML = `<div class="topbar"><img class="logo" src="${A("logo")}"><span class="sp"></span><button class="btn sm" id="eHome">🏠 Trang chủ</button></div>
  <div class="end"><div class="panel" style="padding:24px">
    <div class="trophy">🏆</div>
    <div class="hint">${why}</div>
    <h1 class="disp" style="font-size:40px;margin:8px 0">${S.winner.map(nameOf).join(" & ")}</h1>
    <div style="font-weight:800;font-size:20px;color:var(--p1)">“${esc(G.win)}”</div>
    <table class="rank"><tr><th>#</th><th>Người chơi</th><th>Token</th><th>${esc(G.markShort)}</th><th></th></tr>
    ${ranked.map((p, i) => `<tr><td>${i + 1}</td><td>${dot(p)} ${esc(p.name)}</td><td>${p.tokens}</td><td>${p.marks}/3</td><td>${p.alive ? "" : "💀"}</td></tr>`).join("")}</table>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      <button class="btn big pink" id="eAgain">↺ Chơi lại (cùng nhóm)</button>
      <button class="btn big" id="eSwitch">Đổi game</button>
    </div></div></div>`;
  el.querySelectorAll(".dot,.av").forEach(d => { d.style.display = "inline-block"; d.style.width = "16px"; d.style.height = "16px"; d.style.borderRadius = "50%"; d.style.border = "2px solid #1a1a1a"; d.style.verticalAlign = "middle"; });
  $("#eHome").onclick = renderHome; $("#eSwitch").onclick = renderHome;
  $("#eAgain").onclick = () => { setupN = S.players.length; setupNames = S.players.map(p => p.name); setupFirst = 0; startGame(); };
}
function confetti() {
  const cols = [getComputedStyle(document.body).getPropertyValue("--p1"), "#FFD200", "#3BB54A", "#7280ED", "#F47B20"];
  for (let i = 0; i < 90; i++) {
    const c = document.createElement("div"); c.className = "confetti";
    c.style.left = Math.random() * 100 + "vw"; c.style.background = cols[i % cols.length];
    c.style.animationDuration = 2 + Math.random() * 2.5 + "s"; c.style.animationDelay = Math.random() * .8 + "s";
    document.body.appendChild(c); setTimeout(() => c.remove(), 5500);
  }
}

/* ---------------- BÀI TRÊN TAY ---------------- */
function openHand(pid) {
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
  box.querySelectorAll("[data-use]").forEach(b => b.onclick = () => { md.close(); useCard(pid, p.hand[+b.dataset.use]); });
}

function canUse(p, c) {
  const no = why => ({ ok: false, why });
  if (S.phase === "over") return no("Ván đã kết thúc");
  if (p.flags.ban === S.turn) return no("Bạn đang bị cấm dùng thẻ lượt này");
  if (S.phase === "rolling-tmp") return no("Đang lắc xúc xắc…");
  const others = alive().filter(o => o.id !== p.id);
  const inCh = S.phase === "challenge" && S.cur;
  const ch = inCh ? card(S.cur.id) : null;
  const targeted = inCh && (ch.g === "C" ? S.cur.victim === p.id : S.cur.losers.includes(p.id));
  switch (c.eff) {
    case "removeMark": return p.marks > 0 ? { ok: true } : no(`Bạn chưa có ${G.mark} nào`);
    case "bonus2": return S.bank > 0 ? { ok: true } : no("Quỹ đã cạn");
    case "passMark":
      if (p.marks <= 0) return no(`Bạn chưa có ${G.mark} nào`);
      return passTargets(p).length ? { ok: true } : no("Không có ai để chuyển");
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
  // LDD: đồng nghiệp bên cạnh (trái/phải trong vòng)
  const ring = alive(); const i = ring.findIndex(o => o.id === p.id);
  const set = new Set([ring[(i + 1) % ring.length].id, ring[(i - 1 + ring.length) % ring.length].id]); set.delete(p.id);
  return [...set];
}

function useCard(pid, cid) {
  const p = P(pid); const c = card(cid);
  const v = canUse(p, c); if (!v.ok) { toast(v.why); return; }
  const go = target => vetoWindow(pid, cid, () => execCard(pid, cid, target));
  if (c.eff === "passMark") return pickPlayer(`Chuyển 1 ${G.markShort} cho ai?`, passTargets(p), go, G.passMode === "neighbor" ? "Chỉ được chuyển cho đồng nghiệp ngồi bên cạnh." : "");
  if (c.eff === "delegate") return pickPlayer("Ai chịu phạt thay bạn?", alive().filter(o => o.id !== pid).map(o => o.id), go);
  if (c.eff === "swap") return pickPlayer("Hoán đổi vị trí cược với ai?", alive().filter(o => o.id !== pid && betSum(o.id) > 0).map(o => o.id), go);
  if (c.eff === "steal") {
    const others = alive().filter(o => o.id !== pid); const max = Math.max(...others.map(o => o.tokens));
    const top = others.filter(o => o.tokens === max).map(o => o.id);
    if (top.length > 1) return pickPlayer("Nhiều người cùng giàu nhất – chọn 1 người:", top, go);
    return go(top[0]);
  }
  go(null);
}

function vetoWindow(pid, cid, exec) {
  const p = P(pid), c = card(cid);
  // gỡ thẻ khỏi tay ngay (đã tung ra)
  p.hand.splice(p.hand.indexOf(cid), 1); S.specialDiscard.push(cid);
  beep(660, .12, "triangle");
  const others = alive().filter(o => o.id !== pid && o.flags.ban !== S.turn);
  const vetoName = card("s12").title;
  const box = document.createElement("div");
  box.innerHTML = `<div class="reveal"><img class="flip" src="${A(cid)}" alt=""><div class="rt">
    <p style="margin:0"><b>${esc(p.name)}</b> vừa tung:</p><h2 class="disp" style="margin:4px 0 8px">${esc(c.title)}</h2><p>${esc(c.text)}</p>
    ${others.length ? `<p style="font-weight:800">Ai có thẻ “${esc(vetoName)}” muốn chặn không?</p><div class="pickers">${others.map(o => `<button class="pick" data-v="${o.id}">🚫 ${dot(o)}${esc(o.name)}</button>`).join("")}</div>` : ""}
  </div></div>`;
  const md = modal({ title: "Tung thẻ!", body: box, close: false, buttons: [{ label: "Không ai chặn → Thực thi ✅", cls: "green", onClick: exec }] });
  box.querySelectorAll("[data-v]").forEach(b => b.onclick = () => {
    const o = P(b.dataset.v); const idx = o.hand.indexOf("s12");
    if (idx < 0) { toast(`${esc(o.name)} không có thẻ ${esc(vetoName)} đâu nha 😜`); return; }
    o.hand.splice(idx, 1); S.specialDiscard.push("s12");
    md.close(); buzz();
    log(`🚫 ${esc(o.name)} dùng “${esc(vetoName)}” chặn thẻ “${esc(c.title)}” của ${esc(p.name)}!`);
    modal({ title: "BỊ VETO!", body: `<div class="reveal"><img src="${A("s12")}" alt=""><div class="rt"><h2 class="disp" style="margin:0">${esc(o.name)}</h2><p>đã vô hiệu hóa thẻ “${esc(c.title)}” của ${esc(p.name)}. Cả 2 thẻ vào xấp bỏ.</p></div></div>`, buttons: [{ label: "Đau thế 😭", cls: "pink" }] });
    renderGame();
  });
}

function execCard(pid, cid, target) {
  const p = P(pid), c = card(cid), n = esc(p.name);
  let msg = "";
  switch (c.eff) {
    case "removeMark": p.marks = Math.max(0, p.marks - 1); msg = `${n} xóa 1 ${G.mark} (còn ${p.marks}/3).`; break;
    case "bonus2": { const x = Math.min(2, S.bank); S.bank -= x; p.tokens += x; msg = `${n} nhận ${x} Token từ Quỹ.`; break; }
    case "passMark": { const t = P(target); p.marks--; t.marks++; msg = `${n} chuyển 1 ${G.mark} sang ${esc(t.name)} (${t.marks}/3).`; break; }
    case "steal": { const t = P(target); const x = Math.min(G.stealN, t.tokens); t.tokens -= x; p.tokens += x; msg = `${esc(t.name)} phải “chia sẻ” ${x} Token cho ${n}.`; break; }
    case "exempt": removeTarget(pid); msg = `${n} được miễn trừ mini-game này!`; break;
    case "shield": removeTarget(pid); msg = `${n} miễn nhiễm với ${G.challenge} này!`; break;
    case "ooo": p.flags.immune = S.turn; if (S.cur) removeTarget(pid); msg = `${n} bật Out-of-Office – miễn nhiễm mọi ${G.challenge} trong lượt này.`; break;
    case "refund": { const x = Math.min(S.lost[pid] || 0, S.bank); S.bank -= x; p.tokens += x; S.lost[pid] = 0; msg = `${n} lấy lại ${x} Token vừa cược thua.`; break; }
    case "draw2": { const g = drawSpecial(pid, 2); msg = `${n} rút thêm ${g} ${G.special}.`; break; }
    case "delegate": { const i = S.cur.losers.indexOf(pid); if (i >= 0) S.cur.losers[i] = target; msg = `${esc(P(target).name)} phải chịu phạt thay ${n}!`; break; }
    case "lateBet": p.flags.lateBet = S.turn + 1; msg = `${n} sẽ được đặt cược SAU khi xúc xắc đổ ở lượt sau.`; break;
    case "swap": {
      const t = P(target); const a = S.bets[pid], b = S.bets[target]; const sa = betSum(pid), sb = betSum(target);
      if (p.tokens + sa - sb < 0 || t.tokens + sb - sa < 0) { msg = `Không đủ Token để hoán đổi – thẻ mất tác dụng.`; break; }
      S.bets[pid] = b; S.bets[target] = a; p.tokens += sa - sb; t.tokens += sb - sa;
      msg = `${n} hoán đổi toàn bộ vị trí cược với ${esc(t.name)}!`; break;
    }
  }
  log(`🃏 ${n} tung “${esc(c.title)}”: ${msg}`);
  toast("🃏 " + msg, 3200);
  if (!checkElims()) renderGame();
}
function removeTarget(pid) {
  if (!S.cur) return;
  if (card(S.cur.id).g === "C") { if (S.cur.victim === pid) S.cur.victim = null; }
  else { const i = S.cur.losers.indexOf(pid); if (i >= 0) S.cur.losers.splice(i, 1); }
}

/* ---------------- khởi động ---------------- */
document.querySelectorAll(".gcard").forEach(b => b.onclick = () => { G = GAMES[b.dataset.game]; setupNames = []; renderSetup(); });
renderHome();

// hook kiểm thử
window.__zd = { get S() { return S; }, get G() { return G; } };
})();
