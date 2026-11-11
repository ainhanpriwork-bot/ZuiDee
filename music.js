/* Zui Dee – nhạc nền 8-bit tự soạn, phát bằng Web Audio (không dùng file nhạc) */
(() => {
"use strict";
const KEY = "zuidee_music_v1";
const H = -1; // giữ nốt
const N = null; // nghỉ

// Mỗi bài: 4 ô nhịp × 16 bước. chords: [gốc bass, [nốt hợp âm]]
const SONGS = {
  // HỌC ĐẠI ĐI – polka "oom-pah" tinh nghịch, Đô trưởng
  hdd: {
    bpm: 142, swing: 0, wave: "square", vib: 0, gain: .5,
    chords: [[48, [60, 64, 67]], [45, [57, 60, 64]], [41, [57, 60, 65]], [43, [55, 59, 62]]],
    lead: [
      72, H, 76, H, 79, H, 76, H, 81, 79, H, 76, 79, H, H, N,
      76, H, 72, H, 69, H, 72, H, 76, H, 74, 72, 74, H, H, N,
      77, H, 81, H, 84, H, 81, H, 79, H, 77, H, 76, 74, 72, N,
      74, H, 79, H, 74, H, 71, H, 67, H, 71, 74, 79, 83, 84, N
    ],
    style: "polka"
  },
  // LÀM ĐẠI ĐI – funk "thang máy" kèn kazoo, Fa trưởng, nhịp swing
  ldd: {
    bpm: 112, swing: .18, wave: "sawtooth", vib: 7, gain: .32,
    chords: [[41, [57, 60, 64]], [38, [57, 62, 65]], [46, [58, 62, 65]], [48, [58, 60, 64]]],
    lead: [
      72, H, 69, H, N, 72, N, 77, H, H, 76, H, 74, H, 72, N,
      74, H, N, 69, N, 74, N, 77, H, H, 74, H, 69, H, N, N,
      70, H, 74, H, 77, H, 74, H, 79, H, 77, H, 74, H, 70, N,
      72, H, H, N, 67, N, 72, N, 76, H, 79, H, 84, H, H, N
    ],
    style: "funk"
  }
};

let ctx = null, master = null, noiseBuf = null;
let on = true, playing = false, theme = "hdd", step = 0, nextT = 0, iv = null;
try { const v = localStorage.getItem(KEY); if (v === "0") on = false; } catch (e) {}

const hz = m => 440 * Math.pow(2, (m - 69) / 12);

function init() {
  if (ctx) return true;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = .11; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * .3, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  } catch (e) { return false; }
}

function tone(m, t, dur, wave, vol, vib = 0, slide = 0) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = wave; o.frequency.setValueAtTime(hz(m), t);
  if (slide) o.frequency.exponentialRampToValueAtTime(hz(m + slide), t + dur);
  if (vib) {
    const l = ctx.createOscillator(), lg = ctx.createGain();
    l.frequency.value = 6; lg.gain.value = vib; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur + .05);
  }
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + .012);
  g.gain.setValueAtTime(vol * .8, t + Math.max(.02, dur * .6));
  g.gain.exponentialRampToValueAtTime(.0008, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + .02);
}
function noise(t, dur, vol, hp) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; f.type = "highpass"; f.frequency.value = hp;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0008, t + dur);
  s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur);
}
function kick(t) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + .14);
  g.gain.setValueAtTime(.9, t); g.gain.exponentialRampToValueAtTime(.001, t + .18);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + .2);
}

function stepDur(s, i) { const base = 60 / s.bpm / 4; return i % 2 === 0 ? base * (1 + s.swing) : base * (1 - s.swing); }

function schedule(i, t) {
  const s = SONGS[theme]; const bar = Math.floor(i / 16) % 4, b = i % 16;
  const [root, chord] = s.chords[bar];
  const sd = 60 / s.bpm / 4;
  // giai điệu
  const m = s.lead[i];
  if (m != null && m !== H) {
    let len = 1; while (s.lead[(i + len) % 64] === H && len < 16) len++;
    const last = b === 14 && bar === 3;
    tone(m, t, sd * len * .95, s.wave, s.gain * (s.wave === "sawtooth" ? .55 : .42), s.vib, last ? 0 : 0);
  }
  if (s.style === "polka") {
    if (b === 0 || b === 8) { const bn = root + (b === 8 ? 7 : 0); tone(bn, t, sd * 1.6, "triangle", .9); tone(bn, t, sd * 1.2, "square", .18); }
    if (b === 4 || b === 12) chord.forEach(n => tone(n, t, sd * .9, "square", .09));
    if (b === 0 || b === 8) kick(t);
    if (b === 4 || b === 12) noise(t, .11, .35, 1800);
    if (b % 2 === 0) noise(t, .03, .12, 7000);
    if (b === 15 && bar === 3) tone(60, t, sd * 2, "triangle", .5, 0, 12); // “boing!”
  } else {
    const walk = [0, N, N, 7, N, N, 10, N, 12, N, N, 7, N, N, 5, N][b];
    if (walk != null) { tone(root + walk, t, sd * 1.4, "triangle", .9); tone(root + walk, t, sd * 1.1, "square", .16); }
    if (b === 2 || b === 10) chord.forEach(n => tone(n, t, sd * .7, "square", .07));
    if (b === 0 || b === 7 || b === 10) kick(t);
    if (b === 4 || b === 12) noise(t, .14, .32, 1500);
    if (b % 2 === 0) noise(t, .025, .1, 8000);
    if (b === 14 && bar === 1) tone(79, t, sd * 2, "triangle", .25, 0, -7); // tiếng “uỵch” hài hước
  }
}

function tick() {
  if (!playing) return;
  const s = SONGS[theme];
  while (nextT < ctx.currentTime + .15) {
    schedule(step, nextT);
    nextT += stepDur(s, step);
    step = (step + 1) % 64;
  }
}

function start() {
  if (!on || playing) return;
  if (!init()) return;
  if (ctx.state === "suspended") ctx.resume();
  playing = true; step = 0; nextT = ctx.currentTime + .08;
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setValueAtTime(0, ctx.currentTime); master.gain.linearRampToValueAtTime(.11, ctx.currentTime + 1.2);
  clearInterval(iv); iv = setInterval(tick, 25);
}
function stop() {
  playing = false; clearInterval(iv);
  if (master) { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(master.gain.value, ctx.currentTime); master.gain.linearRampToValueAtTime(0, ctx.currentTime + .25); }
}
function setTheme(id) {
  if (!SONGS[id] || id === theme) return;
  theme = id;
  if (playing) { step = 0; nextT = ctx.currentTime + .1; }
}
function paint() {
  const b = document.getElementById("musicBtn"); if (!b) return;
  b.textContent = on ? "🎵" : "🔇"; b.title = on ? "Nhạc nền: đang bật (bấm để tắt)" : "Nhạc nền: đang tắt (bấm để bật)";
  b.classList.toggle("off", !on);
}
function toggle() {
  on = !on;
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) {}
  on ? start() : stop();
  paint();
}

// trình duyệt chỉ cho phát âm thanh sau lần chạm/bấm đầu tiên
const kick0 = () => { if (on) start(); };
document.addEventListener("pointerdown", kick0, { once: false, capture: true });
document.addEventListener("keydown", kick0, { capture: true });
document.addEventListener("visibilitychange", () => {
  if (!ctx) return;
  if (document.hidden) ctx.suspend(); else if (playing) ctx.resume();
});
window.addEventListener("DOMContentLoaded", () => {
  const b = document.getElementById("musicBtn");
  if (b) b.addEventListener("click", e => { e.stopPropagation(); toggle(); });
  paint();
});

window.ZDMusic = { start, stop, toggle, setTheme, get on() { return on; }, get playing() { return playing; }, get theme() { return theme; } };
})();
