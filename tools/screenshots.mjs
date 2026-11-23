// Screenshots for the README, taken from a demo instance that runs on the fake hackrf_transfer (a synthetic
// carrier on 145.500 MHz): no radio, nothing local in the pictures. Chrome headless through the DevTools protocol.
//   docker run -d --rm --name hackrf-web-demo -p 127.0.0.1:8074:8073 -e HACKRF_TRANSFER=/srv/fake/hackrf_transfer \
//     -e TX_ENABLE=1 -e ALLOWED_HOSTS=127.0.0.1:8074 -e RECORDINGS_DIR=/tmp/rec hackrf-web:test \
//     uvicorn app.server:app --host 0.0.0.0 --port 8073
//   node tools/screenshots.mjs        → docs/listen.png, docs/transmit.png
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
  const shot = async (file, height) => {
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1180, height, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    const { data } = await cdp("Page.captureScreenshot", { format: "png" });
    (await import("node:fs")).writeFileSync(file, Buffer.from(data, "base64")); console.log(file);
  };
  await cdp("Page.enable"); await cdp("Network.enable"); await cdp("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1180, height: 1190, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.navigate", { url: URL }); await cdp("Page.bringToFront");
  await until(`typeof st !== "undefined" && !!st && document.querySelectorAll(".band").length === 5`, "pagina");
  await js(`document.querySelector('.band[data-id="2m"]').click()`);
  await until(`st.rx && st.freq === 145.5e6 && document.getElementById("rssi").textContent.startsWith("-")`, "ascolto");
  await sleep(19000);                                  // let the waterfall fill
  await shot("docs/listen.png", 1190);
  await js(`document.getElementById("rx-toggle").click()`);
  await js(`showTab("tx"); document.querySelector('.bandcard').click();
            setFile(new File([new Uint8Array(480000)], "cq-test.wav", { type: "audio/wav" })); 1`);
  await sleep(500);
  await shot("docs/transmit.png", 880);
  ws.close();
} finally { chrome.kill(); }
