// Screenshots for the README, taken from a demo instance that runs on the fake hackrf_transfer (a synthetic
// carrier on 145.500 MHz): no radio, nothing local in the pictures. Chrome headless through the DevTools protocol.
//   docker run -d --rm --name hackrf-web-demo -p 127.0.0.1:8074:8073 -e HACKRF_TRANSFER=/srv/fake/hackrf_transfer \
//     -e TX_ENABLE=1 -e ALLOWED_HOSTS=127.0.0.1:8074 -e RECORDINGS_DIR=/tmp/rec hackrf-web:test \
//     uvicorn app.server:app --host 0.0.0.0 --port 8073
//   node tools/screenshots.mjs        → docs/listen.png, docs/transmit.png, docs/confirm.png, docs/guide.png
import { spawn } from "node:child_process";
const URL = process.env.DEMO_URL || "http://127.0.0.1:8074", PORT = 9333;
const chrome = spawn(process.env.CHROME || "google-chrome", ["--headless=new", `--remote-debugging-port=${PORT}`,
  "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--autoplay-policy=no-user-gesture-required",
  "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding", `--user-data-dir=/tmp/hackrf-web-shots-${process.pid}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try { target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json(); } catch { await sleep(200); }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0; const waiting = new Map();
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (waiting.has(m.id)) { waiting.get(m.id)(m.result); waiting.delete(m.id); } });
  const cdp = (method, params = {}) => new Promise((r) => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const js = async (expression) => (await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
  const until = async (cond, what) => { for (let i = 0; i < 150; i++) { if (await js(cond)) return; await sleep(200); } throw new Error("mai pronto: " + what); };
  const OUT = process.env.OUT || "docs";
  const shot = async (file, height) => {
    file = file.replace(/^docs/, OUT);
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1180, height, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    const { data } = await cdp("Page.captureScreenshot", { format: "png" });
    (await import("node:fs")).writeFileSync(file, Buffer.from(data, "base64")); console.log(file);
  };
  await cdp("Page.enable"); await cdp("Network.enable"); await cdp("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1180, height: 1190, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.navigate", { url: URL }); await cdp("Page.bringToFront");
  await until(`typeof st !== "undefined" && !!st && document.querySelectorAll(".band").length === 5`, "pagina");
  if (process.env.UI_LANG) await js(`applyLang(${JSON.stringify(process.env.UI_LANG)})`);     // UI_LANG=en for English
  const band = process.env.BAND || "2m";              // BAND=fm DEMO_URL=http://127.0.0.1:8073 for a real HackRF
  await js(`document.querySelector('.band[data-id="${band}"]').click()`);
  await until(`st.rx && bandOf(st.freq)?.id === "${band}" && document.getElementById("rssi").textContent.startsWith("-")`, "ascolto");
  await sleep(19000);                                  // let the waterfall fill
  await shot("docs/listen.png", 1190);
  await js(`document.getElementById("rx-toggle").click()`);
  await js(`showTab("tx"); document.querySelector('.bandcard').click();
            const n = 8000 * 42, wav = new Uint8Array(44 + n).fill(128), v = new DataView(wav.buffer);     // 42 s of silence
            [["RIFF", 0], ["WAVE", 8], ["fmt ", 12], ["data", 36]].forEach(([t, o]) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0))));
            v.setUint32(4, 36 + n, true); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
            v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); v.setUint32(40, n, true);
            setFile(new File([wav], "cq-test.wav", { type: "audio/wav" })); 1`);
  await until(`txDuration > 0`, "durata del file");
  await shot("docs/transmit.png", 880);
  await js(`document.getElementById("tx-go").click(); document.querySelectorAll(".dlg-check").forEach((c, i) => { if (i < 2) c.click(); }); 1`);
  await shot("docs/confirm.png", 880);
  await js(`document.getElementById("dlg-cancel").click()`);
  await js(`showTab("guide"); window.scrollTo(0, 0); 1`);
  await shot("docs/guide.png", 1500);
  ws.close();
} finally { chrome.kill(); }
