// A short video of a real transmission for the README: listen first, load a file, confirm, on air.
// It drives the running page (default http://127.0.0.1:8073, the real HackRF) with Chrome headless and records
// the screen through the DevTools protocol. IT TRANSMITS: run it only with a licence, a message that carries
// your callsign and TX_ENABLE=1. It refuses to go on if the frequency does not look clear.
//   node tools/video.mjs MESSAGE.wav [NAME-SHOWN.wav]     → docs/transmit.mp4, docs/transmit.gif   (needs ffmpeg)
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const [file, shown] = process.argv.slice(2);
if (!file) { console.error("uso: node tools/video.mjs MESSAGGIO.wav [NOME-MOSTRATO.wav]"); process.exit(2); }
const URL = process.env.DEMO_URL || "http://127.0.0.1:8073", FREQ = process.env.FREQ || "433.4500", LEVEL = process.env.LEVEL || "10";
const PORT = 9334, W = 1180, H = 860;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hackrf-web-video-"));
const chrome = spawn(process.env.CHROME || "google-chrome", ["--headless=new", `--remote-debugging-port=${PORT}`,
  "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--autoplay-policy=no-user-gesture-required",
  "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding", `--user-data-dir=${tmp}/profile`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = false;
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try { target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json(); } catch { await sleep(200); }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0; const waiting = new Map(); const frames = [];
  const cdp = (method, params = {}) => new Promise((r) => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (waiting.has(m.id)) { waiting.get(m.id)(m.result); waiting.delete(m.id); }
    if (m.method === "Page.screencastFrame") {
      const name = `f${String(frames.length).padStart(5, "0")}.jpg`;
      fs.writeFileSync(path.join(tmp, name), Buffer.from(m.params.data, "base64"));
      frames.push([name, m.params.metadata.timestamp]);
      cdp("Page.screencastFrameAck", { sessionId: m.params.sessionId });
    }
  });
  const js = async (expression) => (await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
  const until = async (cond, what, tries = 150) => { for (let i = 0; i < tries; i++) { if (await js(cond)) return; await sleep(200); } throw new Error("mai pronto: " + what); };
  // a pointer you can see: the clicks are made by script, the dot shows where
  const click = async (sel) => {
    await js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(), p = window.__ptr;
      p.hidePopover(); p.showPopover(); p.style.left = (r.left + Math.min(r.width / 2, 60)) + "px"; p.style.top = (r.top + r.height / 2) + "px"; })()`);
    await sleep(750);
    await js(`(() => { const p = window.__ptr; p.animate([{ boxShadow: "0 0 0 0 #fff" }, { boxShadow: "0 0 0 18px #fff0" }], 350);
      document.querySelector(${JSON.stringify(sel)}).click(); })()`);
    await sleep(450);
  };
  await cdp("Page.enable"); await cdp("Network.enable"); await cdp("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.navigate", { url: URL }); await cdp("Page.bringToFront");
  await until(`typeof st !== "undefined" && !!st && document.querySelectorAll(".bandcard").length > 0`, "pagina");
  if (!(await js(`st.tx_enabled`))) throw new Error("la trasmissione è disabilitata (TX_ENABLE=1)");
  await js(`(() => { const p = document.createElement("div"); p.popover = "manual"; window.__ptr = p; document.body.append(p);
    p.style.cssText = "position:fixed;inset:auto;margin:0;left:600px;top:300px;width:22px;height:22px;border-radius:50%;padding:0;" +
      "border:2px solid #fff;background:#ffffff55;transform:translate(-50%,-50%);transition:left .6s ease,top .6s ease;pointer-events:none;overflow:visible"; p.showPopover(); })()`);

  // 1 · listen first: is the frequency clear?
  await js(`(async () => { await goTo(${FREQ} * 1e6, "nfm"); await startRx(); })()`);
  await until(`st.rx && Math.abs(st.freq - ${FREQ} * 1e6) < 1 && document.getElementById("rssi").textContent.startsWith("-")`, "ascolto");
  await sleep(2500);
  const rssi = parseFloat(await js(`document.getElementById("rssi").textContent`));
  console.log(`ascolto su ${FREQ} MHz: ${rssi} dBFS`);
  if (!(rssi < -40)) throw new Error(`la frequenza non sembra libera (${rssi} dBFS): non trasmetto`);
  await cdp("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await sleep(2500);

  // 2 · the message
  await click('.tabs button[data-tab="tx"]');
  const b64 = fs.readFileSync(file).toString("base64");
  await js(`(async () => { document.getElementById("tx-freq").value = "${FREQ}"; updateTxFreq();
    document.getElementById("tx-level").value = ${LEVEL}; document.getElementById("tx-level").oninput({ target: document.getElementById("tx-level") });
    const bytes = Uint8Array.from(atob("${b64}"), (c) => c.charCodeAt(0));
    setFile(new File([bytes], ${JSON.stringify(shown || path.basename(file))}, { type: "audio/wav" })); })()`);
  await until(`txDuration > 0`, "file");
  await sleep(1500);

  // 3 · confirm and go on air
  await click("#tx-go");
  for (const i of [1, 2, 3]) await click(`.dlg-checks label:nth-child(${i}) input`);
  await sleep(500);
  await click("#dlg-ok");
  await until(`st.tx`, "in onda", 100);
  console.log("in onda");
  await until(`!st.tx && document.getElementById("onair").hidden`, "fine della trasmissione", 1200);
  const err = await js(`st.error`);
  await sleep(2000);
  await cdp("Page.stopScreencast");
  await js(`fetch("/api/rx/stop", { method: "POST", headers: { "X-Token": token } }).then(() => 1)`);
  ws.close();
  if (err) throw new Error("la trasmissione ha dato errore: " + err);

  // frames (irregular, one per screen change) → constant 12 fps mp4, and a gif for the README
  let list = "";
  frames.forEach(([name, t], i) => { const d = i + 1 < frames.length ? frames[i + 1][1] - t : 1.5; list += `file '${name}'\nduration ${d.toFixed(3)}\n`; });
  list += `file '${frames.at(-1)[0]}'\n`;
  fs.writeFileSync(path.join(tmp, "list.txt"), list);
  const ff = (...a) => execFileSync("ffmpeg", ["-v", "error", "-y", ...a], { cwd: tmp });
  const out = path.resolve(process.env.OUT || "docs");
  ff("-f", "concat", "-i", "list.txt", "-vf", "fps=12,scale=944:-2:flags=lanczos", "-pix_fmt", "yuv420p", "-movflags", "+faststart", `${out}/transmit.mp4`);
  ff("-i", `${out}/transmit.mp4`, "-vf", "fps=8,scale=760:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4", `${out}/transmit.gif`);
  console.log(`${frames.length} fotogrammi → ${out}/transmit.mp4, ${out}/transmit.gif`);
  ok = true;
} finally { chrome.kill(); fs.rmSync(tmp, { recursive: true, force: true }); if (!ok) process.exitCode = 1; }
