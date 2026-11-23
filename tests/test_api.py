"""The web API end to end with the fake hackrf_transfer (fake/): who may give commands, receive, tune, record,
transmit with its guards, stopping a transmission at every stage, and what happens when things break."""
import io
import json
import os
import struct
import subprocess
import time
import wave
from pathlib import Path

import numpy as np
import pytest
from starlette.websockets import WebSocketDisconnect

HERE = Path(__file__).resolve().parent
BASE = "http://127.0.0.1:8073"


@pytest.fixture(scope="module")
def env(tmp_path_factory):
    d = tmp_path_factory.mktemp("hw")
    os.environ.update(RECORDINGS_DIR=str(d / "rec"), HACKRF_TRANSFER=str(HERE.parent / "fake" / "hackrf_transfer"),
                      FAKE_LOG=str(d / "calls.log"), FAKE_SIGNAL_HZ="145500000", TX_MAX_LEVEL="30", TX_ENABLE="1")
    for k in ("FAKE_FAIL", "FAKE_TX_SECONDS", "FAKE_IGNORE_TERM", "FAKE_DIE_AFTER", "FAKE_STDERR_KB"):
        os.environ.pop(k, None)
    return d


@pytest.fixture(scope="module")
def client(env):
    from fastapi.testclient import TestClient
    from app import server
    with TestClient(server.app, base_url=BASE, headers={"X-Token": server.TOKEN}) as c:
        c.token = server.TOKEN
        yield c, server.engine
    server.engine.shutdown()


def calls(env, prefix=""):
    p = env / "calls.log"
    return [l for l in (p.read_text().splitlines() if p.exists() else []) if l.startswith(prefix)]


def wav_bytes(seconds=1.0, f=1000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        t = np.arange(int(16000 * seconds)) / 16000
        w.writeframes((0.5 * np.sin(2 * np.pi * f * t) * 32767).astype("<i2").tobytes())
    return buf.getvalue()


def wait(cond, timeout=10):
    t = time.time()
    while time.time() - t < timeout:
        if cond():
            return True
        time.sleep(0.05)
    return False


def listen(c, eng, freq=145.5e6, mode="nfm"):
    """Reception on, on the fake's carrier, with data flowing."""
    assert c.post("/api/rx/settings", json={"mode": mode}).status_code == 200
    assert c.post("/api/rx/tune", json={"freq": freq}).status_code == 200
    if not eng.rx_on:
        assert c.post("/api/rx/start").json()["rx"] is True
    assert wait(lambda: eng.rx_on and eng.demod.rssi > -100)


def tx(c, **kw):
    data = {"freq_mhz": "433.450", "level": "10", "tone": "0", "repeat": "1", "confirm": "TRASMETTI"}
    data.update({k: str(v) for k, v in kw.pop("data", kw).items()})
    return c.post("/api/tx", data=data, files={"file": ("voce.wav", wav_bytes(), "audio/wav")})


def idle(eng):
    assert wait(lambda: not eng.tx_on, 15)


# ------------------------------------------------------------------ who may give commands
def test_host_origin_token(client):
    c, eng = client
    assert c.get("/api/status").status_code == 200
    assert c.get("/api/status", headers={"host": "evil.example:8073"}).status_code == 403     # DNS rebinding
    assert c.post("/api/rx/stop", headers={"X-Token": ""}).status_code == 403                 # no token
    assert c.post("/api/rx/stop", headers={"X-Token": "x" * 32}).status_code == 403
    assert c.post("/api/rx/stop", headers={"origin": "http://127.0.0.1:9999"}).status_code == 403  # another local page
    assert c.post("/api/rx/stop", headers={"origin": BASE}).status_code == 200
    assert c.get("/api/session").json()["token"] == c.token
    assert "access-control-allow-origin" not in c.get("/api/session", headers={"origin": "http://evil"}).headers


def test_websocket_refuses_strangers(client):
    c, _ = client
    ok = {"host": "127.0.0.1:8073"}          # the test client says «testserver» on websockets unless told
    with c.websocket_connect(f"/ws?token={c.token}", headers={**ok, "origin": BASE}) as ws:
        assert ws.receive_json()["type"] == "status"
    for url, headers in (("/ws", ok), ("/ws?token=wrong", ok),
                         (f"/ws?token={c.token}", {**ok, "origin": "http://127.0.0.1:9999"}),
                         (f"/ws?token={c.token}", {"host": "evil.example"})):
        with pytest.raises(WebSocketDisconnect):
            with c.websocket_connect(url, headers=headers) as ws:
                ws.receive_json()


def test_tx_refused_without_token_even_with_confirmation(client, env):
    c, eng = client
    r = c.post("/api/tx", headers={"X-Token": "", "origin": "http://localhost:3000"},
               data={"freq_mhz": "433.450", "confirm": "TRASMETTI"}, files={"file": ("v.wav", wav_bytes(), "audio/wav")})
    assert r.status_code == 403 and not eng.tx_on and not calls(env, "-t ")


# ------------------------------------------------------------------ receive
def test_receive_stream_with_a_chatty_stderr(client, env, monkeypatch):
    c, eng = client
    monkeypatch.setenv("FAKE_STDERR_KB", "300")          # more than a pipe holds: undrained, the fake would hang
    c.post("/api/rx/stop")
    listen(c, eng)
    assert any(l.endswith("-a 0") and "-r -" in l and "-f 145200000" in l for l in calls(env))
    with c.websocket_connect(f"/ws?token={c.token}", headers={"host": "127.0.0.1:8073"}) as ws:
        assert ws.receive_json()["type"] == "status"
        got_s = got_a = None
        for _ in range(200):
            b = ws.receive().get("bytes")
            if b and b[:1] == b"S":
                got_s = b
            elif b and b[:1] == b"A":
                got_a = b
            if got_s and got_a:
                break
    assert got_a and len(got_a) == 1 + 2 * 2400       # 50 ms of 48 kHz int16
    rssi, = struct.unpack("<f", got_s[1:5])
    spec = np.frombuffer(got_s[9:], np.uint8)
    assert len(spec) == 1024 and rssi > -30
    peak = (np.argmax(spec) - 512) * 2.4e6 / 1024 + 145.2e6   # the fake carrier is at 145.5 MHz
    assert abs(peak - 145.5e6) < 20e3


def test_slow_browser_gets_only_fresh_frames():
    import asyncio
    from app.server import Subscriber
    loop = asyncio.new_event_loop()
    try:
        s = Subscriber(loop)
        for i in range(100):
            s.push(b"A" + bytes([i]))
            s.push(b"S" + bytes([i]))
            s.push({"n": i})
        out = s.take()
        audio = [m for m in out if isinstance(m, bytes) and m[:1] == b"A"]
        assert len(audio) == 10 and audio[-1] == b"A" + bytes([99])       # half a second, the newest
        assert [m for m in out if isinstance(m, bytes) and m[:1] == b"S"] == [b"S" + bytes([99])]
        assert [m for m in out if isinstance(m, dict)] == [{"n": 99}]
        assert s.take() == []
    finally:
        loop.close()


def test_tune_inside_and_outside_window(client, env):
    c, eng = client
    listen(c, eng)
    n = len(calls(env))
    s = c.post("/api/rx/tune", json={"freq": 145.6e6}).json()
    assert s["center"] == 145.2e6 and len(calls(env)) == n           # inside: no restart
    s = c.post("/api/rx/tune", json={"freq": 433.5e6}).json()
    assert s["center"] == 433.2e6                                       # outside: retune
    assert wait(lambda: "-f 433200000" in (calls(env) or [""])[-1])
    assert c.post("/api/rx/tune", json={"freq": 7e9}).status_code == 400
    r = c.post("/api/rx/tune", content='{"freq": NaN}', headers={"content-type": "application/json"})
    assert r.status_code in (400, 422) and eng.freq == 433.5e6


def test_settings_are_all_or_nothing(client):
    c, eng = client
    c.post("/api/rx/settings", json={"mode": "nfm", "lna": 24})
    assert c.post("/api/rx/settings", json={"mode": "am", "lna": 12}).status_code == 400
    assert eng.mode == "nfm" and eng.lna == 24                         # the valid half was not applied
    assert c.post("/api/rx/settings", json={"lna": 16, "vga": 63}).status_code == 400 and eng.lna == 24
    assert c.post("/api/rx/settings", json={"mode": "ssb"}).status_code == 400
    r = c.post("/api/rx/settings", content='{"squelch": NaN}', headers={"content-type": "application/json"})
    assert r.status_code in (400, 422) and eng.squelch == -200.0
    assert c.post("/api/rx/settings", json={"squelch": 5}).status_code == 400


# ------------------------------------------------------------------ recordings
def test_record(client, env):
    c, eng = client
    listen(c, eng)
    name = c.post("/api/record/start", json={"iq": False}).json()["name"]
    time.sleep(1.5)
    assert c.post("/api/record/stop").json()["name"] == name
    data = c.get(f"/api/recordings/{name}.wav").content
    with wave.open(io.BytesIO(data)) as w:
        a = np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(float)
        assert w.getframerate() == 48000 and len(a) > 48000
    a = a[len(a) // 4:]
    f = np.fft.rfftfreq(len(a), 1 / 48000)[np.argmax(np.abs(np.fft.rfft(a)))]
    assert abs(f - 1000) < 5                                             # the fake's 1 kHz tone
    assert c.delete(f"/api/recordings/{name}.wav").json()["ok"]


def test_recordings_never_overwrite_and_active_files_are_protected(client, env):
    c, eng = client
    listen(c, eng)
    first = c.post("/api/record/start", json={"iq": True}).json()["name"]
    active = {r["name"] for r in c.get("/api/recordings").json() if r["active"]}
    assert f"{first}.wav" in active and any(n.endswith(".iq") for n in active)
    for n in active:
        assert c.delete(f"/api/recordings/{n}").status_code == 409        # wav and IQ, both being written
    c.post("/api/rx/tune", json={"freq": 433.5e6})                         # retune: the IQ file is rotated
    assert wait(lambda: eng.rx_on and len([n for n in os.listdir(env / "rec") if n.endswith(".iq")]) == 2)
    iqs = sorted(n for n in os.listdir(env / "rec") if n.endswith(".iq"))
    assert any(".c145200000." in n for n in iqs) and any(".c433200000." in n for n in iqs)
    c.post("/api/record/stop")
    (env / "rec" / f"{first}.wav").write_bytes(b"keep me")                 # a same-second recording must not clobber
    f, final = eng._new_file(f"{first}.wav"); f.close()
    assert final == f"{first}-2.wav" and (env / "rec" / f"{first}.wav").read_bytes() == b"keep me"
    for n in os.listdir(env / "rec"):
        assert c.delete(f"/api/recordings/{n}").status_code == 200


def test_recordings_paths(client, env, tmp_path):
    c, _ = client
    secret = tmp_path / "secret.txt"; secret.write_text("no")
    os.symlink(secret, env / "rec" / "link.wav")
    assert c.get("/api/recordings/link.wav").status_code == 404           # a symlink out of the folder
    assert c.delete("/api/recordings/link.wav").status_code == 404 and secret.exists()
    assert "link.wav" not in [r["name"] for r in c.get("/api/recordings").json()]
    assert c.get("/api/recordings/..%2F..%2Fetc%2Fpasswd").status_code == 404
    os.unlink(env / "rec" / "link.wav")


def test_unplugged_while_recording(client, env, monkeypatch):
    c, eng = client
    c.post("/api/rx/stop")
    monkeypatch.setenv("FAKE_DIE_AFTER", "30")                             # 1.5 s of stream, then gone
    listen(c, eng)
    name = c.post("/api/record/start", json={"iq": False}).json()["name"]
    assert wait(lambda: not eng.rx_on, 10)
    assert "streaming terminated" in eng.error and eng.rec_name == "" and eng.proc is None
    with wave.open(str(env / "rec" / f"{name}.wav")) as w:                 # closed properly: a valid file
        assert w.getnframes() > 0
    os.unlink(env / "rec" / f"{name}.wav")


def test_no_hackrf(client, env, monkeypatch):
    c, eng = client
    c.post("/api/rx/stop")
    monkeypatch.setenv("FAKE_FAIL", "1")
    c.post("/api/rx/start")
    assert wait(lambda: not eng.rx_on and "No HackRF" in eng.error, 10), eng.error


# ------------------------------------------------------------------ transmit: guards
def test_tx_disabled_by_default(env, client):
    c, eng = client
    from app.engine import Engine
    assert Engine(env / "x").tx_enabled is False
    eng.tx_enabled = False
    try:
        assert tx(c).status_code == 403 and c.get("/api/status").json()["tx_enabled"] is False
    finally:
        eng.tx_enabled = True
    assert not calls(env, "-t ")


def test_tx_guards(client, env):
    c, eng = client
    n = len(calls(env, "-t "))
    assert tx(c, freq_mhz="435.5").status_code == 400          # outside the bands
    assert tx(c, freq_mhz="430.3").status_code == 400          # carrier and image would fall below 430
    assert tx(c, freq_mhz="145.995").status_code == 400        # the modulation would cross 146
    assert tx(c, freq_mhz="nan").status_code in (400, 422)
    assert tx(c, level="31").status_code == 400
    assert tx(c, confirm="si").status_code == 400
    assert tx(c, repeat="9").status_code == 400
    assert tx(c, tone="100.5").status_code == 400              # not a CTCSS tone
    assert tx(c, tone="nan").status_code in (400, 422)
    assert len(calls(env, "-t ")) == n and not eng.tx_on


def test_tx_upload_limits(client, env):
    c, eng = client
    n = len(calls(env, "-t "))
    data = {"freq_mhz": "145.5", "confirm": "TRASMETTI"}
    big = c.post("/api/tx", data=data, files={"file": ("big.wav", b"RIFF" + bytes(101 << 20), "audio/wav")})
    assert big.status_code == 413
    for body in (b"not audio at all", b"#EXTM3U\nfile:///etc/passwd\n", b"ffconcat version 1.0\nfile /etc/passwd\n"):
        r = c.post("/api/tx", data=data, files={"file": ("x.mp3", body, "audio/mpeg")})
        assert r.status_code == 400, body
    long = c.post("/api/tx", data=data, files={"file": ("l.wav", wav_bytes(421), "audio/wav")})
    assert long.status_code == 400 and "troppo lungo" in long.json()["detail"]
    assert len(calls(env, "-t ")) == n and not eng.tx_on            # every refusal released the transmitter


# ------------------------------------------------------------------ transmit: the real thing and its stops
def test_tx_pauses_and_resumes_rx(client, env):
    c, eng = client
    listen(c, eng)
    n = len(calls(env, "-t "))
    r = tx(c, repeat=2, level=7, tone=88.5)
    assert r.status_code == 200, r.text
    assert tx(c).status_code == 409                               # one at a time
    assert wait(lambda: not eng.rx_on, 5) and eng.tx_on
    assert wait(lambda: not eng.tx_on and eng.rx_on, 20)
    txl = calls(env, "-t ")[n:]
    assert len(txl) == 2
    assert all(l.startswith("-t - ") and "-f 433250000" in l and "-x 7" in l and l.endswith("-a 0") for l in txl)
    sent = [int(x) for x in (env / "calls.log.bytes").read_text().split()][-2:]
    assert sent == [2 * 2 * 2_400_000] * 2                        # 1 s of audio + 2 × 0.5 s of carrier, int8 I/Q
    assert eng.error == ""


def test_stop_between_repetitions(client, env, monkeypatch):
    c, eng = client
    idle(eng)
    monkeypatch.setenv("FAKE_TX_SECONDS", "0.3")
    n = len(calls(env, "-t "))
    assert tx(c, repeat=3).status_code == 200
    assert wait(lambda: len(calls(env, "-t ")) == n + 1 and eng.tx_proc is None and eng.tx_on, 10)  # in the pause
    assert c.post("/api/tx/stop").status_code == 200
    assert wait(lambda: not eng.tx_on, 3)
    time.sleep(2.5)                                               # longer than the pause
    assert len(calls(env, "-t ")) == n + 1                        # nothing went on air after the stop


def test_stop_while_on_air_even_if_it_ignores_sigterm(client, env, monkeypatch):
    c, eng = client
    idle(eng)
    monkeypatch.setenv("FAKE_TX_SECONDS", "60")
    monkeypatch.setenv("FAKE_IGNORE_TERM", "1")
    n = len(calls(env, "-t "))
    assert tx(c, repeat=2).status_code == 200
    assert wait(lambda: len(calls(env, "-t ")) == n + 1, 10)
    hp = eng.tx_proc
    t = time.time()
    c.post("/api/tx/stop")
    assert wait(lambda: not eng.tx_on, 3) and time.time() - t < 8
    assert hp.p.poll() is not None                                # killed and reaped
    time.sleep(2.5)
    assert len(calls(env, "-t ")) == n + 1


def test_stop_before_it_starts(client, env):
    c, eng = client
    idle(eng)
    n = len(calls(env, "-t "))
    eng.reserve_tx()                                              # as /api/tx does before decoding the upload
    eng.stop_tx()                                                 # «Ferma» arrives while it decodes
    eng.transmit(np.sin(np.arange(48000) / 7.6), 433.45e6, 10)
    assert not eng.tx_on and len(calls(env, "-t ")) == n


def test_failure_while_preparing_leaves_nothing_stuck(client, env, monkeypatch):
    c, eng = client
    idle(eng)
    listen(c, eng)
    from app import dsp

    def broken(*a, **k):
        raise OSError("No space left on device")
        yield
    monkeypatch.setattr(dsp, "modulate_fm", broken)
    assert tx(c).status_code == 200
    assert wait(lambda: not eng.tx_on and eng.rx_on, 10)           # released, reception back
    assert "No space left" in eng.error                            # and the reason is still there to read


def test_tx_mp3(client, env, tmp_path):
    c, eng = client
    idle(eng)
    src = tmp_path / "v.wav"; src.write_bytes(wav_bytes())
    mp3 = tmp_path / "v.mp3"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), str(mp3)], check=True)
    n = len(calls(env, "-t "))
    r = c.post("/api/tx", data={"freq_mhz": "145.5", "level": "5", "confirm": "TRASMETTI"},
               files={"file": ("v.mp3", mp3.read_bytes(), "audio/mpeg")})
    assert r.status_code == 200, r.text
    assert wait(lambda: len(calls(env, "-t ")) == n + 1 and not eng.tx_on, 20)


def test_shutdown_leaves_no_process(client, env):
    c, eng = client
    listen(c, eng)
    hp = eng.proc
    eng.shutdown()
    assert hp.p.poll() is not None and eng.proc is None and not eng.rx_on
