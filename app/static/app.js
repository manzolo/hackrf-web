// hackrf-web — the page: bands and controls, websocket stream (spectrum + audio), drawing, transmission form.
"use strict";
const $ = (id) => document.getElementById(id);
let st = null;                 // last status from the server
let ws = null;
let audioCtx = null, nextTime = 0;
let lastAudio = new Float32Array(0);
const SPAN = 1.1e6;            // outside a band, the slider covers centre ± this

// What there is to listen to. Frequencies in MHz; `ch` are well-known spots, not a band plan.
const BANDS = [
  { id: "fm", ico: "📻", name: "Radio FM", lo: 87.5, hi: 108, mode: "wfm", step: 100000, start: 100.0,
    hint: "Le emittenti: il modo più semplice per provare che tutto funziona.", ch: [] },
  { id: "air", ico: "✈️", name: "Aerei", lo: 118, hi: 137, mode: "am", step: 25000, start: 118.0,
    hint: "Banda aeronautica in AM: torri di controllo e piloti. Solo ascolto.", ch: [] },
  { id: "2m", ico: "📡", name: "2 metri", ham: true, lo: 144, hi: 146, mode: "nfm", step: 12500, start: 145.5,
    hint: "Radioamatori VHF: ponti ripetitori fra 145.575 e 145.7875, diretta attorno a 145.500.",
    ch: [[144.8, "APRS"], [145.5, "chiamata FM"], [145.6, "ponti ▸"], [145.8, "ISS"]] },
  { id: "70cm", ico: "🛰️", name: "70 cm", ham: true, lo: 430, hi: 440, mode: "nfm", step: 12500, start: 433.5,
    hint: "Radioamatori UHF: ponti nella parte bassa, diretta attorno a 433.500. In Italia la banda è 430–434 (più 435–438 satelliti).",
    ch: [[430.1, "ponti ▸"], [433.5, "chiamata FM"], [437.8, "ISS ponte"]] },
  { id: "pmr", ico: "🗣️", name: "PMR446", lo: 446.0, hi: 446.2, mode: "nfm", step: 12500, start: 446.00625,
    hint: "I walkie-talkie senza licenza: 16 canali da 12,5 kHz.",
    ch: Array.from({ length: 8 }, (_, i) => [446.00625 + i * 0.0125, `ch ${i + 1}`]) },
];
const bandOf = (hz) => BANDS.find((b) => hz >= b.lo * 1e6 && hz <= b.hi * 1e6) || null;

// ---------------------------------------------------------------- helpers
// Every command carries the token of this server run: only a page served from here can read it.
let token = "";
async function loadToken() { token = (await (await fetch("/api/session")).json()).token; }
async function send(path, opts = {}, retry = true) {
  const r = await fetch(path, { method: "POST", ...opts, headers: { ...(opts.headers || {}), "X-Token": token } });
  if (r.status === 403 && retry) { await loadToken(); return send(path, opts, false); }   // the server restarted
  return r;
}
async function api(path, body) {
  const r = await send(path, body === undefined ? {} :
    { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { showError(j.detail || r.statusText); throw new Error(j.detail); }
  return j;
}
function showError(msg) { const e = $("error"); e.textContent = msg || ""; e.hidden = !msg; }
const mhz = (hz, d = 4) => (hz / 1e6).toFixed(d);
// segmented controls: a row of buttons with data-v, one of them .on
const segGet = (id) => ($(id).querySelector(".on") || {}).dataset?.v;
function segSet(id, v) { $(id).querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === String(v))); }
function segInit(id, onchange) {
  $(id).querySelectorAll("button").forEach((b) => b.onclick = () => { segSet(id, b.dataset.v); onchange && onchange(b.dataset.v); });
}
const step = () => Number(segGet("step") || 12500);
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

// ---------------------------------------------------------------- status
function applyStatus(s) {
  if (st && st.rx && !s.rx) flushAudio();
  const first = !st;
  st = s;
  const band = bandOf(s.freq);
  $("freq").textContent = mhz(s.freq, 4);
  $("band-name").textContent = T(band ? band.name : "Frequenza libera");
  $("mode-badge").textContent = s.mode.toUpperCase();
  $("band-hint").textContent = T(band ? band.hint : "Fuori dalle bande in elenco: lo slider copre ±1,1 MHz attorno alla frequenza.");
  document.querySelectorAll(".band").forEach((b) => b.classList.toggle("on", !!band && b.dataset.id === band.id));
  const ch = $("channels");
  if (ch.dataset.band !== (band ? band.id : "") + lang) {
    ch.dataset.band = (band ? band.id : "") + lang; ch.innerHTML = "";
    for (const [f, label] of (band ? band.ch : [])) {
      const b = document.createElement("button"); b.className = "chan";
      b.innerHTML = `${f.toFixed(f * 1000 % 1 ? 5 : 3)}<i>${T(label)}</i>`;
      b.onclick = () => goTo(f * 1e6, band.mode); ch.append(b);
    }
  }
  $("pill-rx").classList.toggle("on", s.rx);
  $("pill-tx").classList.toggle("on", s.tx);
  $("pill-rec").classList.toggle("on", !!s.recording);
  $("rx-toggle").textContent = T(s.rx ? "■ Ferma" : "▶ Ascolta");
  $("rx-toggle").classList.toggle("primary", !s.rx);
  $("rec-toggle").classList.toggle("rec-on", !!s.recording);
  $("rec-toggle").textContent = T(s.recording ? "■ Ferma reg." : "● Registra");
  $("rec-time").textContent = s.recording ? `● ${fmtTime(s.rec_seconds)}  ${s.recording}` : "";
  segSet("mode", s.mode);
  if (first) segSet("step", band ? band.step : 12500);
  $("lna").value = s.lna; $("vga").value = s.vga;
  showError(s.error);
  const sl = $("slider");
  const [lo, hi] = band ? [band.lo * 1e6, band.hi * 1e6] : [s.center - SPAN, s.center + SPAN];
  sl.min = lo; sl.max = hi; sl.step = step();
  if (document.activeElement !== sl) sl.value = s.freq;
  $("lo").textContent = mhz(lo, 3); $("hi").textContent = mhz(hi, 3);
  drawPlan($("plan"), lo / 1e6, hi / 1e6, s.freq / 1e6, T);
  showSegment("plan-now", "plan-text", s.freq / 1e6, false);
  // transmit side
  $("tx-off").hidden = s.tx_enabled;
  $("tx-go").disabled = !s.tx_enabled || s.tx;
  $("tx-max").textContent = Math.round(s.tx_max_seconds / 60);
  $("tx-bands").textContent = s.tx_bands.map(([a, b]) => `${a}–${b}`).join(", ") + " MHz";
  $("tx-level").max = s.tx_max_level;
  if ($("tx-tone").options.length === 1) for (const t of s.ctcss) $("tx-tone").add(new Option(`${t.toFixed(1)} Hz`, t));
  if ($("tx-bandcards").dataset.lang !== lang) { $("tx-bandcards").dataset.lang = lang; buildTxBands(); }
  updateTxFreq();
}

// Where we are in the band plan. For transmitting, a segment that is not meant for FM voice is a warning.
function showSegment(boxId, textId, fMHz, forTx) {
  const seg = segmentAt(fMHz), box = $(boxId);
  box.hidden = !seg;
  if (!seg) return true;
  const [a, b, kind, text] = seg, okFm = KINDS[kind].fm;
  box.querySelector(".dot").style.background = KINDS[kind].color;
  box.classList.toggle("warn-plan", forTx && !okFm);
  $(textId).textContent = `${a.toFixed(3)}–${b.toFixed(3)} · ${T(text)}` + (forTx && !okFm ? " — " + T("⚠ non è un segmento per la fonia FM") : "");
  return okFm;
}

// ---------------------------------------------------------------- websocket
async function connect() {
  try { await loadToken(); } catch (e) { setTimeout(connect, 1500); return; }
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?token=${encodeURIComponent(token)}`);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => { $("pill-ws").textContent = "online"; $("pill-ws").classList.add("on"); };
  ws.onclose = () => { $("pill-ws").textContent = "offline"; $("pill-ws").classList.remove("on"); flushAudio(); setTimeout(connect, 1500); };
  ws.onmessage = (ev) => {
    if (typeof ev.data === "string") { applyStatus(JSON.parse(ev.data)); return; }
    const dv = new DataView(ev.data);
    const kind = String.fromCharCode(dv.getUint8(0));
    if (kind === "A") playAudio(new Int16Array(ev.data.slice(1)));
    else if (kind === "S") drawSpectrum(dv.getFloat32(1, true), dv.getFloat32(5, true) > 0, new Uint8Array(ev.data, 9));
  };
}

// ---------------------------------------------------------------- audio
let sources = [];             // what is scheduled and not played yet
function flushAudio() {
  for (const s of sources) { try { s.stop(); } catch (e) { /* already ended */ } }
  sources = []; nextTime = 0;
}
function playAudio(pcm) {
  const f = new Float32Array(pcm.length);
  const vol = Number($("volume").value) / 100;
  for (let i = 0; i < pcm.length; i++) f[i] = pcm[i] / 32768 * vol;
  lastAudio = f;
  drawScope();
  if (!audioCtx || audioCtx.state !== "running") return;
  const now = audioCtx.currentTime;
  if (nextTime > now + 0.8) flushAudio();          // a backlog arrived in a burst: drop it, do not play it late
  if (nextTime < now + 0.05) nextTime = now + 0.15;  // keep ~150 ms of buffer
  const buf = audioCtx.createBuffer(1, f.length, 48000);
  buf.copyToChannel(f, 0);
  const src = audioCtx.createBufferSource();
  src.buffer = buf; src.connect(audioCtx.destination); src.start(nextTime);
  sources.push(src);
  src.onended = () => { const i = sources.indexOf(src); if (i >= 0) sources.splice(i, 1); };
  nextTime += buf.duration;
}

// ---------------------------------------------------------------- drawing
function fit(c) { const w = c.clientWidth | 0; if (c.width !== w) c.width = w; return c.getContext("2d"); }
function color(v) {           // 0..1 → black, deep blue, cyan, yellow, red
  const stops = [[0, 0, 0], [8, 20, 120], [0, 200, 220], [250, 230, 0], [255, 40, 0]];
  const x = Math.min(0.999, Math.max(0, v)) * (stops.length - 1), i = x | 0, t = x - i;
  return stops[i].map((a, k) => Math.round(a + (stops[i + 1][k] - a) * t));
}
function xOfFreq(c, f) { return (f - (st.center - st.rate / 2)) / st.rate * c.width; }

function drawSpectrum(rssi, open, spec) {
  if (!st) return;
  // S-meter: -110 dBFS (empty) … -20 dBFS (full)
  $("smeter-bar").style.width = `${Math.max(0, Math.min(100, (rssi + 110) / 90 * 100))}%`;
  $("rssi").textContent = `${rssi.toFixed(0)} dBFS`;
  $("sq-badge").hidden = open;
  const c = $("spectrum"), g = fit(c), w = c.width, h = c.height;
  g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
  g.strokeStyle = "#16202e"; g.lineWidth = 1;
  for (let db = 20; db <= 120; db += 20) { const y = h - (db / 130) * h; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  // frequency axis: a tick every 200 kHz
  g.fillStyle = "#5f7088"; g.font = "10px monospace"; g.textAlign = "center";
  const f0 = st.center - st.rate / 2;
  for (let f = Math.ceil(f0 / 2e5) * 2e5; f < f0 + st.rate; f += 2e5) {
    const x = xOfFreq(c, f);
    g.beginPath(); g.moveTo(x, h - 14); g.lineTo(x, h - 10); g.strokeStyle = "#2a3a50"; g.stroke();
    if (x > 30 && x < w - 30) g.fillText((f / 1e6).toFixed(1), x, h - 1);
  }
  // the trace, filled underneath
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(53,224,230,.55)"); grad.addColorStop(1, "rgba(53,224,230,0)");
  g.beginPath(); g.moveTo(0, h);
  for (let i = 0; i < spec.length; i++) g.lineTo(i / spec.length * w, h - 14 - (spec[i] / 130) * (h - 14));
  g.lineTo(w, h); g.closePath(); g.fillStyle = grad; g.fill();
  g.strokeStyle = "#35e0e6"; g.beginPath();
  for (let i = 0; i < spec.length; i++) {
    const x = i / spec.length * w, y = h - 14 - (spec[i] / 130) * (h - 14);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();
  const fx = xOfFreq(c, st.freq);
  const bw = { wfm: 200e3, nfm: 16e3, am: 10e3 }[st.mode] / st.rate * w;
  g.fillStyle = "rgba(255,182,72,.18)"; g.fillRect(fx - bw / 2, 0, Math.max(2, bw), h - 14);
  g.strokeStyle = "#ffb648"; g.beginPath(); g.moveTo(fx, 0); g.lineTo(fx, h - 14); g.stroke();
  if (st.squelch > -100) { const y = h - 14 - ((st.squelch + 140) / 130) * (h - 14); g.strokeStyle = "#ff5a52"; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); g.setLineDash([]); }
  // waterfall: scroll down one row, new row on top
  const wc = $("waterfall"), wg = fit(wc);
  wg.drawImage(wc, 0, 0, wc.width, wc.height - 1, 0, 1, wc.width, wc.height - 1);
  const row = wg.createImageData(wc.width, 1);
  let lo = 255, hi = 0;
  for (const v of spec) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const floor = lo + 5, range = Math.max(30, hi - floor);
  for (let x = 0; x < wc.width; x++) {
    const v = spec[Math.floor(x / wc.width * spec.length)];
    const [r, gg, b] = color((v - floor) / range);
    row.data.set([r, gg, b, 255], x * 4);
  }
  wg.putImageData(row, 0, 0);
}

function drawScope() {
  const c = $("scope"), g = fit(c), w = c.width, h = c.height;
  g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
  g.strokeStyle = "#16202e"; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  g.strokeStyle = "#3ddc84"; g.shadowColor = "#3ddc84"; g.shadowBlur = 6; g.beginPath();
  const n = Math.min(lastAudio.length, 1200);        // 25 ms
  for (let i = 0; i < n; i++) { const x = i / n * w, y = h / 2 - lastAudio[i] * h / 2; i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke(); g.shadowBlur = 0;
}

// ---------------------------------------------------------------- listening controls
function tune(f) { if (!st) return; api("/api/rx/tune", { freq: Math.round(f) }).then(applyStatus).catch(() => {}); }
// the usual mode for a frequency: broadcast FM, airband AM, everything else narrow FM
function modeFor(f) { const b = bandOf(f); return b ? b.mode : "nfm"; }
async function goTo(f, mode) {
  mode = mode || modeFor(f);
  const b = bandOf(f);
  if (b) segSet("step", b.step);
  if (st && mode !== st.mode) applyStatus(await api("/api/rx/settings", { mode }));
  tune(f);
}
async function unlockAudio() {
  if (!audioCtx) audioCtx = new AudioContext({ sampleRate: 48000 });
  await audioCtx.resume();
}
async function startRx() { await unlockAudio(); if (st && !st.rx) applyStatus(await api("/api/rx/start")); }

function buildBands() {
 $("bands").innerHTML = "";
 for (const b of BANDS) {
  const el = document.createElement("button");
  el.className = "band" + (b.ham ? " ham" : ""); el.dataset.id = b.id;
  el.innerHTML = `<span class="ico">${b.ico}</span><b>${T(b.name)}</b><small>${b.lo}–${b.hi} MHz · ${b.mode.toUpperCase()}</small>`;
  el.onclick = async () => { await goTo(b.start * 1e6, b.mode); startRx().catch(() => {}); };   // one click: tuned and listening
  $("bands").append(el);
 }
}
buildBands();
$("rx-toggle").onclick = async () => {
  await unlockAudio();
  applyStatus(await api(st && st.rx ? "/api/rx/stop" : "/api/rx/start"));
};
$("slider").oninput = (e) => { $("freq").textContent = mhz(Number(e.target.value), 4); };
$("slider").onchange = (e) => tune(Number(e.target.value));
$("up").onclick = () => tune(st.freq + step());
$("down").onclick = () => tune(st.freq - step());
document.addEventListener("keydown", (e) => {
  if (!st || !$("tab-rx").classList.contains("active") || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.key === "ArrowRight") { tune(st.freq + step()); e.preventDefault(); }
  if (e.key === "ArrowLeft") { tune(st.freq - step()); e.preventDefault(); }
});
$("go").onclick = () => { const v = Number($("freq-in").value); if (v > 0) goTo(v * 1e6); };
$("freq-in").onkeydown = (e) => { if (e.key === "Enter") $("go").click(); };
segInit("mode", (v) => api("/api/rx/settings", { mode: v }).then(applyStatus).catch(() => {}));
segInit("step", () => st && applyStatus(st));
const showSquelch = () => { const v = Number($("squelch").value); $("sq-out").textContent = v <= -100 ? T("aperto") : `${v} dBFS`; };
$("squelch").oninput = showSquelch;
$("squelch").onchange = (e) => { const v = Number(e.target.value); api("/api/rx/settings", { squelch: v <= -100 ? -200 : v }).then(applyStatus).catch(() => {}); };
$("volume").oninput = (e) => { $("vol-out").textContent = `${e.target.value}%`; };
for (let v = 0; v <= 40; v += 8) $("lna").add(new Option(`LNA ${v} dB`, v));
for (let v = 0; v <= 62; v += 2) $("vga").add(new Option(`VGA ${v} dB`, v));
$("lna").onchange = (e) => api("/api/rx/settings", { lna: Number(e.target.value) }).then(applyStatus).catch(() => {});
$("vga").onchange = (e) => api("/api/rx/settings", { vga: Number(e.target.value) }).then(applyStatus).catch(() => {});
$("waterfall").onclick = (e) => {
  if (!st) return;
  const r = e.target.getBoundingClientRect();
  const f = st.center - st.rate / 2 + (e.clientX - r.left) / r.width * st.rate;
  tune(Math.round(f / step()) * step());
};
for (const id of ["waterfall", "spectrum"]) $(id).addEventListener("wheel", (e) => {
  if (!st) return; e.preventDefault(); tune(st.freq + (e.deltaY < 0 ? 1 : -1) * step());
}, { passive: false });
$("rec-toggle").onclick = async () => {
  if (st && st.recording) { await api("/api/record/stop"); loadRecordings(); }
  else await api("/api/record/start", { iq: $("rec-iq").checked });
};

// tabs
function showTab(name) {
  document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x.dataset.tab === name));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === `tab-${name}`));
  if (name === "rec") loadRecordings();
}
document.querySelectorAll(".tabs button").forEach((b) => b.onclick = () => showTab(b.dataset.tab));

// ---------------------------------------------------------------- transmit
const TX_NAMES = { 144: ["2 metri", 145.45], 430: ["70 cm", 433.45], 50: ["6 metri", 51.5], 28: ["10 metri", 29.6], 1240: ["23 cm", 1297.5] };
function buildTxBands() {
  $("tx-bandcards").innerHTML = "";
  st.tx_bands.forEach(([lo, hi], i) => {
    const [name, def] = TX_NAMES[Math.floor(lo)] || [`${lo}–${hi}`, null];
    const [a, b] = st.tx_ranges[i];
    const el = document.createElement("button"); el.className = "bandcard"; el.dataset.i = i;
    el.innerHTML = `<span class="big">${T(name)}</span><small>${lo}–${hi} MHz</small><small>${T("trasmissibile")} ${a.toFixed(3)}–${b.toFixed(3)}</small>`;
    el.onclick = () => { $("tx-freq").value = (def && def >= a && def <= b ? def : (a + b) / 2).toFixed(4); updateTxFreq(); };
    $("tx-bandcards").append(el);
  });
}
const txF = () => Number(String($("tx-freq").value).replace(",", "."));
function txBandIndex(f) { return st ? st.tx_bands.findIndex(([lo, hi]) => f >= lo && f <= hi) : -1; }
function updateTxFreq() {
  if (!st) return false;
  const f = txF(), i = txBandIndex(f);
  document.querySelectorAll(".bandcard").forEach((c) => c.classList.toggle("on", Number(c.dataset.i) === i));
  const v = $("tx-valid");
  if (i < 0) {
    $("tx-zone").style.width = "0"; $("tx-mark").style.left = "-10px"; $("tx-lo").textContent = $("tx-hi").textContent = "";
    $("tx-plan").hidden = $("tx-plan-now").hidden = true;
    v.textContent = T("✗ fuori dalle bande in cui si può trasmettere"); v.className = "no"; return false;
  }
  const [lo, hi] = st.tx_bands[i], [a, b] = st.tx_ranges[i], pc = (x) => `${(x - lo) / (hi - lo) * 100}%`;
  drawPlan($("tx-plan"), lo, hi, f, T);
  showSegment("tx-plan-now", "tx-plan-text", f, true);
  $("tx-zone").style.left = pc(a); $("tx-zone").style.width = `${(b - a) / (hi - lo) * 100}%`;
  $("tx-mark").style.left = pc(f);
  $("tx-lo").textContent = lo.toFixed(3); $("tx-hi").textContent = hi.toFixed(3);
  const ok = f >= a && f <= b;
  v.textContent = ok ? T("✓ si può trasmettere qui") : T("✗ troppo vicino al bordo: da {a} a {b}", { a: a.toFixed(3), b: b.toFixed(3) });
  v.className = ok ? "ok" : "no";
  return ok;
}
$("tx-freq").oninput = updateTxFreq;
$("tx-freq").onchange = () => { const f = txF(); if (f > 0) $("tx-freq").value = f.toFixed(4); updateTxFreq(); };
document.querySelectorAll(".steps button").forEach((b) => b.onclick = () => {
  $("tx-freq").value = (txF() + Number(b.dataset.d) / 1e6).toFixed(4); updateTxFreq();
});
$("tx-listen").onclick = async () => { showTab("rx"); await goTo(txF() * 1e6, "nfm"); startRx().catch(() => {}); };
$("tx-level").oninput = (e) => { $("tx-level-out").textContent = e.target.value; };
segInit("tx-repeat");

// the file: click or drag & drop, with a preview
let txFile = null, txDuration = 0;
function setFile(file) {
  txFile = file || null; txDuration = 0;
  $("drop").classList.toggle("has", !!txFile);
  $("drop-empty").hidden = !!txFile; $("drop-file").hidden = !txFile;
  const a = $("file-play");
  if (a.src) URL.revokeObjectURL(a.src);
  if (!txFile) { a.removeAttribute("src"); $("tx-file").value = ""; return; }
  $("file-name").textContent = txFile.name;
  $("file-meta").textContent = `${(txFile.size / 1e6).toFixed(1)} MB`;
  a.src = URL.createObjectURL(txFile);
  a.onloadedmetadata = () => {
    txDuration = a.duration;
    const long = st && txDuration > st.tx_max_seconds;
    $("file-meta").textContent = `${fmtTime(txDuration)} · ${(txFile.size / 1e6).toFixed(1)} MB` + (long ? T(" · troppo lungo!") : "");
    $("file-meta").style.color = long ? "var(--red)" : "";
  };
}
$("tx-file").onchange = (e) => setFile(e.target.files[0]);
$("file-clear").onclick = (e) => { e.preventDefault(); setFile(null); };
$("drop-file").onclick = (e) => { if (e.target.id !== "file-clear") e.preventDefault(); };   // only the empty zone opens the picker
const drop = $("drop");
["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => { if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); });

// Confirmation: a dialog that shows what is about to go on air and asks for the three things that matter.
const dlg = $("tx-dialog"), checks = [...document.querySelectorAll(".dlg-check")];
checks.forEach((c) => c.onchange = () => { $("dlg-ok").disabled = !checks.every((x) => x.checked); });
$("dlg-cancel").onclick = () => dlg.close();
$("tx-go").onclick = () => {
  if (!txFile) { showError(T("scegli un file audio")); return; }
  if (!updateTxFreq()) { showError(T("la frequenza non è fra quelle trasmissibili")); return; }
  if (st && txDuration > st.tx_max_seconds) { showError(T("il file dura più di {n} minuti", { n: Math.round(st.tx_max_seconds / 60) })); return; }
  showError("");
  const rep = Number(segGet("tx-repeat")), tone = Number($("tx-tone").value);
  $("dlg-freq").textContent = txF().toFixed(4);
  $("dlg-file").textContent = txFile.name; $("dlg-file").title = txFile.name;
  $("dlg-dur").textContent = (txDuration ? fmtTime(txDuration) : "?") + (rep > 1 ? " × " + T("{n} volte", { n: rep }) : "");
  $("dlg-level").textContent = T("{a} su {b}", { a: $("tx-level").value, b: $("tx-level").max });
  $("dlg-tone").textContent = tone ? `${tone.toFixed(1)} Hz` : T("nessuno");
  showSegment("dlg-plan", "dlg-plan-text", txF(), true);
  checks.forEach((c) => { c.checked = false; }); $("dlg-ok").disabled = true;
  dlg.showModal();
};
$("dlg-ok").onclick = async () => {
  dlg.close();
  const f = txF().toFixed(4), rep = segGet("tx-repeat");
  const fd = new FormData();
  fd.append("file", txFile); fd.append("freq_mhz", f); fd.append("level", $("tx-level").value);
  fd.append("tone", $("tx-tone").value); fd.append("repeat", rep); fd.append("confirm", "TRASMETTI");
  $("tx-msg").textContent = T("preparo…");
  const r = await send("/api/tx", { body: fd });
  const j = await r.json().catch(() => ({}));
  $("tx-msg").textContent = "";
  if (!r.ok) { showError(j.detail || r.statusText); return; }
  onAir(`${f} MHz`, j.seconds * j.repeat + 2 * (j.repeat - 1));
};
let onAirTimer = null;
function onAir(what, total) {
  const t0 = Date.now();
  let seen = false;                       // the status says «tx» a moment after the request returns
  $("onair-what").textContent = what; $("onair").hidden = false;
  clearInterval(onAirTimer);
  onAirTimer = setInterval(() => {
    const el = (Date.now() - t0) / 1000;
    seen = seen || (st && st.tx);
    $("onair-fill").style.width = `${Math.min(100, el / total * 100)}%`;
    $("onair-time").textContent = `${fmtTime(Math.min(el, total))} / ${fmtTime(total)}`;
    if ((seen && st && !st.tx) || el > total + 20) {
      clearInterval(onAirTimer); $("onair").hidden = true;
      $("tx-msg").textContent = st && st.error ? "" : T("fatto ✓");
    }
  }, 250);
}
$("tx-stop").onclick = () => api("/api/tx/stop").then(applyStatus).catch(() => {});

// ---------------------------------------------------------------- recordings
async function loadRecordings() {
  const list = await (await fetch("/api/recordings")).json();
  const ul = $("rec-list"); ul.innerHTML = "";
  if (!list.length) { ul.innerHTML = `<li class='dim'>${T("Nessuna registrazione: premi ● Registra mentre ascolti.")}</li>`; return; }
  for (const r of list) {
    const li = document.createElement("li");
    const url = `/api/recordings/${encodeURIComponent(r.name)}`;
    const name = document.createElement("span"); name.className = "name";
    name.textContent = `${r.name} (${(r.bytes / 1e6).toFixed(1)} MB)${r.active ? T(" · in corso") : ""}`;
    li.append(name);
    if (r.name.endsWith(".wav") && !r.active) { const a = document.createElement("audio"); a.controls = true; a.preload = "none"; a.src = url; li.append(a); }
    const dl = document.createElement("a"); dl.href = url; dl.textContent = T("scarica"); dl.download = r.name; li.append(dl);
    if (r.name.endsWith(".wav") && !r.active) {
      const use = document.createElement("button"); use.textContent = T("📡 usa in trasmissione");
      use.onclick = async () => { const b = await (await fetch(url)).blob(); setFile(new File([b], r.name, { type: "audio/wav" })); showTab("tx"); };
      li.append(use);
    }
    const del = document.createElement("button"); del.textContent = T("elimina"); del.disabled = r.active;
    del.onclick = async () => { if (confirm(T("Elimino {name}?", { name: r.name }))) { const d = await send(url, { method: "DELETE" }); if (!d.ok) showError((await d.json().catch(() => ({}))).detail); loadRecordings(); } };
    li.append(del);
    ul.append(li);
  }
}
$("rec-refresh").onclick = loadRecordings;

// language: Italian unless the visitor chose English (remembered in the browser)
i18nScan();
function applyLang(l) {
  setLang(l); segSet("lang", lang);
  buildBands(); showSquelch();
  if (st) applyStatus(st);
  if ($("tab-rec").classList.contains("active")) loadRecordings();
}
segInit("lang", applyLang);
applyLang(lang);
if (["rx", "tx", "rec"].includes(location.hash.slice(1))) showTab(location.hash.slice(1));
connect();
