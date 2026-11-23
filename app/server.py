"""hackrf-web: a small web page to listen with a HackRF One (slider, spectrum, waterfall, waveform, recording) and to
transmit an audio file on the amateur bands.

Environment: RECORDINGS_DIR (default ./recordings), TX_ENABLE (1 to allow transmitting; default off), TX_BANDS
(MHz, default "144-146,430-434"), TX_MAX_LEVEL (default 30), REC_MAX_SECONDS (default 600), ALLOWED_HOSTS (the
Host headers accepted, default "127.0.0.1:8073,localhost:8073"), HACKRF_TRANSFER (the binary; the tests point it
to a fake one).

Who may give commands: the page can transmit, so every request must carry a Host header from ALLOWED_HOSTS (a
page on another name that resolves to this address is refused), and every request that changes something must
carry the X-Token header with the token of this run, which only a page served from here can read (/api/session);
a foreign Origin is refused. The websocket checks Host, Origin and the token too.
"""
from __future__ import annotations

import asyncio
import collections
import contextlib
import os
import secrets
import tempfile
import threading
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .engine import Busy, Engine, decode_audio

HERE = Path(__file__).parent
TOKEN = secrets.token_urlsafe(24)
ALLOWED_HOSTS = {h.strip() for h in os.environ.get("ALLOWED_HOSTS", "127.0.0.1:8073,localhost:8073").split(",") if h.strip()}
ALLOWED_ORIGINS = {f"http://{h}" for h in ALLOWED_HOSTS}
MAX_UPLOAD = 100 * 1024 * 1024
engine = Engine(Path(os.environ.get("RECORDINGS_DIR", "recordings")),
                os.environ.get("TX_BANDS", "144-146,430-434"),
                int(os.environ.get("TX_MAX_LEVEL", "30")),
                os.environ.get("TX_ENABLE", "0") == "1",
                int(os.environ.get("REC_MAX_SECONDS", "600")))


@contextlib.asynccontextmanager
async def lifespan(_app):
    yield
    await asyncio.to_thread(engine.shutdown)       # no hackrf_transfer left behind


app = FastAPI(title="hackrf-web", lifespan=lifespan)


def refuse(code: int, msg: str):
    return JSONResponse({"detail": msg}, status_code=code)


@app.middleware("http")
async def guard(request: Request, call_next):
    if request.headers.get("host", "") not in ALLOWED_HOSTS:
        return refuse(403, "host non ammesso")
    if request.method not in ("GET", "HEAD"):
        origin = request.headers.get("origin")
        if origin is not None and origin not in ALLOWED_ORIGINS:
            return refuse(403, "origine non ammessa")
        if not secrets.compare_digest(request.headers.get("x-token", ""), TOKEN):
            return refuse(403, "token mancante o scaduto: ricarica la pagina")
        length = request.headers.get("content-length", "")
        if request.url.path == "/api/tx" and not length.isdigit():
            return refuse(411, "serve Content-Length")
        if length.isdigit() and int(length) > MAX_UPLOAD:
            return refuse(413, "file troppo grande: massimo 100 MB")
    return await call_next(request)


def bad(e: Exception, code: int = 400):
    raise HTTPException(code, str(e))


class Tune(BaseModel):
    freq: float                       # Hz


class Settings(BaseModel):
    mode: str | None = None
    lna: int | None = None
    vga: int | None = None
    squelch: float | None = None


class Rec(BaseModel):
    iq: bool = False


@app.get("/api/session")
def session():
    return {"token": TOKEN}


@app.get("/api/status")
def status():
    return engine.status()


@app.post("/api/rx/start")
def rx_start():
    try:
        engine.start_rx()
    except Busy as e:
        bad(e, 409)
    return engine.status()


@app.post("/api/rx/stop")
def rx_stop():
    engine.stop_rx()
    return engine.status()


@app.post("/api/rx/tune")
def rx_tune(t: Tune):
    try:
        engine.tune(t.freq)
    except ValueError as e:
        bad(e)
    except Busy as e:
        bad(e, 409)
    return engine.status()


@app.post("/api/rx/settings")
def rx_settings(s: Settings):
    try:
        engine.settings(s.mode, s.lna, s.vga, s.squelch)
    except ValueError as e:
        bad(e)
    except Busy as e:
        bad(e, 409)
    return engine.status()


@app.post("/api/record/start")
def rec_start(r: Rec):
    try:
        return {"name": engine.start_recording(r.iq)}
    except RuntimeError as e:
        bad(e)


@app.post("/api/record/stop")
def rec_stop():
    return {"name": engine.stop_recording()}


@app.get("/api/recordings")
def recordings():
    out = []
    for p in sorted(engine.recordings.iterdir(), reverse=True):
        if p.is_file() and not p.is_symlink() and not p.name.startswith("."):
            out.append({"name": p.name, "bytes": p.stat().st_size, "active": p.name in engine.rec_files})
    return out


@app.get("/api/recordings/{name}")
def recording(name: str):
    try:
        return FileResponse(engine.recording_path(name), filename=name)
    except FileNotFoundError:
        raise HTTPException(404, "registrazione inesistente")


@app.delete("/api/recordings/{name}")
def recording_delete(name: str):
    try:
        engine.delete_recording(name)
    except FileNotFoundError:
        raise HTTPException(404, "registrazione inesistente")
    except ValueError as e:
        bad(e, 409)
    return {"ok": True}


@app.post("/api/tx")
async def tx(file: UploadFile = File(...), freq_mhz: float = Form(...), level: int = Form(10),
             tone: float = Form(0.0), repeat: int = Form(1), confirm: str = Form("")):
    freq = freq_mhz * 1e6
    try:
        engine.check_tx(freq, level, tone, repeat)
        if confirm != "TRASMETTI":
            raise ValueError("per trasmettere serve la conferma: TRASMETTI")
        engine.reserve_tx()                    # one job at a time, taken before the slow decoding
    except PermissionError as e:
        bad(e, 403)
    except ValueError as e:
        bad(e)
    except Busy as e:
        bad(e, 409)
    path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".upload", delete=False) as f:
            path = f.name
            size = 0
            while chunk := await file.read(1 << 20):
                size += len(chunk)
                if size > MAX_UPLOAD:
                    raise ValueError("file troppo grande: massimo 100 MB")
                await asyncio.to_thread(f.write, chunk)
        audio = await asyncio.to_thread(decode_audio, path)
    except (ValueError, RuntimeError, OSError) as e:
        engine.release_tx()
        bad(e)
    finally:
        if path:
            with contextlib.suppress(OSError):
                os.unlink(path)
    threading.Thread(target=engine.transmit, args=(audio, freq, level, tone, repeat), daemon=True).start()
    return {"ok": True, "seconds": round(len(audio) / 48000 + 1, 1), "repeat": repeat}


@app.post("/api/tx/stop")
def tx_stop():
    engine.stop_tx()
    return engine.status()


class Subscriber:
    """What one browser still has to receive. Bounded on purpose: at most half a second of audio, and only the
    latest spectrum and the latest status. A slow browser loses old frames; it never holds the radio back and
    never piles up work on the event loop (one wake-up pending at a time)."""

    def __init__(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop
        self.audio: collections.deque = collections.deque(maxlen=10)
        self.spec = None
        self.status = None
        self.wake = asyncio.Event()
        self.pending = False
        self.lock = threading.Lock()

    def push(self, msg):                       # from any thread
        with self.lock:
            if isinstance(msg, dict):
                self.status = msg
            elif msg[:1] == b"S":
                self.spec = msg
            else:
                self.audio.append(msg)
            if self.pending:
                return
            self.pending = True
        self.loop.call_soon_threadsafe(self.wake.set)

    def take(self) -> list:
        with self.lock:
            out = [m for m in (self.status, *self.audio, self.spec) if m is not None]
            self.status = self.spec = None
            self.audio.clear()
            self.pending = False
        return out


@app.websocket("/ws")
async def ws(sock: WebSocket):
    origin = sock.headers.get("origin")
    if (sock.headers.get("host", "") not in ALLOWED_HOSTS or (origin is not None and origin not in ALLOWED_ORIGINS)
            or not secrets.compare_digest(sock.query_params.get("token", ""), TOKEN)):
        await sock.close(code=1008)
        return
    await sock.accept()
    sub = Subscriber(asyncio.get_running_loop())

    async def sender():
        await sock.send_json(engine.status())
        while True:
            await sub.wake.wait()
            sub.wake.clear()
            for msg in sub.take():
                send = sock.send_json(msg) if isinstance(msg, dict) else sock.send_bytes(msg)
                await asyncio.wait_for(send, timeout=5)

    async def receiver():                      # nothing is expected from the browser: this notices it leaving
        while True:
            await sock.receive_text()

    engine.subscribers.append(sub.push)
    tasks = [asyncio.create_task(sender()), asyncio.create_task(receiver())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        engine.subscribers.remove(sub.push)
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        with contextlib.suppress(Exception):
            await sock.close()


app.mount("/", StaticFiles(directory=HERE / "static", html=True), name="static")
