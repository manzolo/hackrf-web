"""The HackRF side: receive (hackrf_transfer -r - streaming into the demodulator) and transmit (hackrf_transfer -t).

One HackRF, half duplex: a transmission pauses reception and resumes it afterwards. Messages for the web page go
to subscribers: binary frames (spectrum, audio) and status dicts.

Frames: b"S" + float32 rssi + float32 squelch-open + uint8[1024] spectrum (dB+140, clipped 0..255)
        b"A" + int16 audio at 48 kHz
"""
from __future__ import annotations

import collections
import datetime as dt
import math
import os
import re
import shutil
import struct
import subprocess
import threading
import time
import wave
from pathlib import Path

import numpy as np

from . import dsp

RATE = 2_400_000
BLOCK = RATE // 20                 # 50 ms of IQ per read
CENTER_SHIFT = 300e3               # tune the HackRF this far below the wanted frequency (away from its DC spike)
EDGE = RATE * 0.45                 # beyond this offset from the centre, retune
TX_OFFSET = 200e3
MAX_TX_SECONDS = 420               # of audio; the modulated IQ is streamed to hackrf_transfer, never stored
ERR = re.compile(r"fail|error|not found|no hackrf|busy", re.I)


class Busy(RuntimeError):
    pass


def hackrf_cmd() -> str:
    return os.environ.get("HACKRF_TRANSFER", "hackrf_transfer")


class Proc:
    """A hackrf_transfer process whose stderr is drained all the time (it prints statistics every second: an
    unread pipe would fill up and block it) keeping only the last lines."""

    def __init__(self, cmd: list[str], stdout, stdin=None):
        self.p = subprocess.Popen(cmd, stdout=stdout, stderr=subprocess.PIPE, stdin=stdin, bufsize=0)
        self.tail: collections.deque[str] = collections.deque(maxlen=20)
        self.t = threading.Thread(target=self._drain, daemon=True)
        self.t.start()

    def _drain(self):
        try:
            for line in self.p.stderr:
                self.tail.append(line.decode(errors="replace").strip())
        except (OSError, ValueError):
            pass

    def stop(self):
        """terminate → 3 s → kill → wait: the process is gone and reaped when this returns."""
        if self.p.poll() is None:
            self.p.terminate()
            try:
                self.p.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.p.kill()
                try:
                    self.p.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    pass
        self.t.join(timeout=1)

    def last_error(self) -> str:
        lines = [l for l in self.tail if l]
        bad = [l for l in lines if ERR.search(l)]
        return (bad or lines or ["hackrf_transfer si è fermato"])[-1]


class Engine:
    def __init__(self, recordings: Path, tx_bands: str = "144-146,430-434", tx_max_level: int = 30,
                 tx_enabled: bool = False, rec_max_seconds: int = 600):
        self.recordings = Path(recordings)
        self.recordings.mkdir(parents=True, exist_ok=True)
        self.tx_bands = dsp.parse_bands(tx_bands)
        if not 0 <= tx_max_level <= 47:
            raise ValueError("TX_MAX_LEVEL: da 0 a 47")
        self.tx_max_level = tx_max_level
        self.tx_enabled = tx_enabled
        self.rec_max_seconds = rec_max_seconds
        self.freq = 100.0e6
        self.center = self.freq - CENTER_SHIFT
        self.mode = "wfm"
        self.lna, self.vga = 24, 20
        self.squelch = -200.0
        self.rx_on = False
        self.tx_on = False
        self.error = ""
        self.subscribers: list = []           # callables taking a message (bytes or dict), from any thread
        self.lock = threading.RLock()         # state only: never held while filtering or waiting for a process
        self.proc: Proc | None = None
        self.demod = dsp.Demodulator(RATE, self.mode, self.freq - self.center, self.squelch)
        self.rec_wav: wave.Wave_write | None = None
        self.rec_wav_f = None
        self.rec_iq = None
        self.rec_files: set[str] = set()
        self.rec_name = ""
        self.rec_start = 0.0
        self.tx_proc: Proc | None = None
        self.tx_cancel = threading.Event()

    # ------------------------------------------------------------------ messages
    def status(self) -> dict:
        return {"type": "status", "freq": self.freq, "center": self.center, "rate": RATE, "mode": self.mode,
                "lna": self.lna, "vga": self.vga, "squelch": self.squelch, "rx": self.rx_on, "tx": self.tx_on,
                "recording": self.rec_name, "rec_seconds": round(time.time() - self.rec_start, 1) if self.rec_name else 0,
                "error": self.error, "tx_enabled": self.tx_enabled,
                "tx_bands": [[lo / 1e6, hi / 1e6] for lo, hi in self.tx_bands],
                "tx_ranges": [[(lo + 2 * TX_OFFSET + dsp.OCCUPIED) / 1e6, (hi - dsp.OCCUPIED) / 1e6]
                              for lo, hi in self.tx_bands],
                "tx_max_level": self.tx_max_level, "tx_max_seconds": MAX_TX_SECONDS, "ctcss": list(dsp.CTCSS)}

    def publish(self, msg):
        for s in list(self.subscribers):
            try:
                s(msg)
            except Exception:
                pass

    def publish_status(self):
        self.publish(self.status())

    # ------------------------------------------------------------------ receive
    def start_rx(self):
        with self.lock:
            if self.tx_on:
                raise Busy("sta trasmettendo")
            old, self.proc = self.proc, None
        if old:
            old.stop()
        with self.lock:
            if self.tx_on or self.proc:           # someone else got there while the old process was stopping
                return
            self.error = ""
            self.demod = dsp.Demodulator(RATE, self.mode, self.freq - self.center, self.squelch)
            cmd = [hackrf_cmd(), "-r", "-", "-f", str(int(self.center)), "-s", str(RATE),
                   "-l", str(self.lna), "-g", str(self.vga), "-a", "0"]
            try:
                self.proc = Proc(cmd, subprocess.PIPE)
                self.rx_on = True
                threading.Thread(target=self._reader, args=(self.proc,), daemon=True).start()
            except OSError as e:
                self.error = f"hackrf_transfer non parte: {e}"
                self.rx_on = False
        self.publish_status()

    def stop_rx(self):
        with self.lock:
            self.rx_on = False
            old, self.proc = self.proc, None
        if old:
            old.stop()
        self.stop_recording()
        self.publish_status()

    def _reader(self, hp: Proc):
        n = 0
        buf = b""
        err = None
        try:
            while True:
                chunk = hp.p.stdout.read(2 * BLOCK - len(buf))
                if not chunk:
                    break
                buf += chunk
                if len(buf) < 2 * BLOCK:
                    continue
                raw, buf = buf, b""
                with self.lock:
                    if hp is not self.proc:
                        return
                    demod = self.demod
                iq = dsp.iq_from_int8(raw)
                audio = demod.process(iq)
                pcm = (audio * 32767).astype("<i2").tobytes()
                with self.lock:
                    if hp is not self.proc:
                        return
                    if self.rec_wav:
                        self.rec_wav.writeframes(pcm)
                    if self.rec_iq:
                        self.rec_iq.write(raw)
                    too_long = bool(self.rec_name) and time.time() - self.rec_start > self.rec_max_seconds
                if too_long:
                    self.stop_recording()
                self.publish(b"A" + pcm)
                n += 1
                if n % 2 == 0:                        # spectrum at 10 frames per second
                    spec = np.clip(dsp.spectrum(iq) + 140, 0, 255).astype(np.uint8)
                    self.publish(b"S" + struct.pack("<ff", demod.rssi, 1.0 if demod.open else 0.0) + spec.tobytes())
                if n % 20 == 0 and self.rec_name:
                    self.publish_status()
        except Exception as e:                        # disk full, a DSP error: stop cleanly, say why
            err = f"ricezione interrotta: {e}"
        finally:
            with self.lock:
                mine = hp is self.proc
                if mine:
                    self.proc = None
                    self.rx_on = False
            if mine:                                  # it ended on its own: no HackRF, unplugged, busy, or `err`
                hp.stop()
                self.stop_recording()
                self.error = err or "HackRF: " + hp.last_error()
                self.publish_status()

    def tune(self, freq: float):
        if not (math.isfinite(freq) and 1e6 <= freq <= 6e9):
            raise ValueError("frequenza fuori dalla portata dell'HackRF (1 MHz – 6 GHz)")
        restart = False
        with self.lock:
            self.freq = float(freq)
            if abs(self.freq - self.center) > EDGE:
                self.center = self.freq - CENTER_SHIFT
                restart = self.rx_on
                if restart and self.rec_iq:           # a new centre is a new IQ file: the name carries the centre
                    self._open_iq()
            self.demod.set_offset(self.freq - self.center)
        if restart:
            self.start_rx()
        else:
            self.publish_status()

    def settings(self, mode=None, lna=None, vga=None, squelch=None):
        # validate everything first: a refused request changes nothing
        if mode is not None and mode not in dsp.MODES:
            raise ValueError(f"modo sconosciuto: {mode}")
        if lna is not None and lna not in range(0, 41, 8):
            raise ValueError("LNA: 0–40 a passi di 8")
        if vga is not None and vga not in range(0, 63, 2):
            raise ValueError("VGA: 0–62 a passi di 2")
        if squelch is not None and not (math.isfinite(squelch) and -200 <= squelch <= 0):
            raise ValueError("squelch: da -200 a 0 dBFS")
        with self.lock:
            restart = (lna is not None and lna != self.lna) or (vga is not None and vga != self.vga)
            if lna is not None:
                self.lna = lna
            if vga is not None:
                self.vga = vga
            if squelch is not None:
                self.squelch = float(squelch)
                self.demod.squelch = self.squelch
            if mode is not None and mode != self.mode:
                self.mode = mode
                self.demod = dsp.Demodulator(RATE, mode, self.freq - self.center, self.squelch)
            restart = restart and self.rx_on
        if restart:
            self.start_rx()
        else:
            self.publish_status()

    # ------------------------------------------------------------------ recording
    def _new_file(self, name: str):
        """Create recordings/NAME exclusively (never over an existing file); returns (file, final name)."""
        stem, ext = name.rsplit(".", 1)
        for i in range(1, 100):
            final = name if i == 1 else f"{stem}-{i}.{ext}"
            try:
                return open(self.recordings / final, "xb"), final
            except FileExistsError:
                continue
        raise RuntimeError("troppe registrazioni con lo stesso nome")

    def _open_iq(self):
        """(Re)open the IQ file of the running recording for the current centre. Call with the lock held."""
        if self.rec_iq:
            self.rec_files.discard(Path(self.rec_iq.name).name)
            self.rec_iq.close()
        self.rec_iq, final = self._new_file(f"{self.rec_name}.c{int(self.center)}.s{RATE}.iq")
        self.rec_files.add(final)

    def start_recording(self, iq: bool = False) -> str:
        with self.lock:
            if not self.rx_on:
                raise RuntimeError("prima accendi la ricezione")
            if self.rec_name:
                return self.rec_name
            stamp = dt.datetime.now().strftime("%Y-%m-%d-%H%M%S")
            f, final = self._new_file(f"{stamp}-{self.freq / 1e6:.4f}MHz-{self.mode}.wav")
            w = wave.open(f, "wb")
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(dsp.AF)
            self.rec_wav, self.rec_wav_f = w, f
            self.rec_name = final[:-4]
            self.rec_files = {final}
            if iq:
                self._open_iq()
            self.rec_start = time.time()
            name = self.rec_name
        self.publish_status()
        return name

    def stop_recording(self) -> str:
        with self.lock:
            name = self.rec_name
            for closing in (self.rec_wav, self.rec_wav_f, self.rec_iq):
                try:
                    if closing:
                        closing.close()
                except OSError:
                    pass
            self.rec_wav = self.rec_wav_f = self.rec_iq = None
            self.rec_name = ""
            self.rec_files = set()
        if name:
            self.publish_status()
        return name

    def delete_recording(self, name: str):
        with self.lock:
            if name in self.rec_files:
                raise ValueError("la registrazione è in corso")
            p = self.recording_path(name)
            p.unlink()

    def recording_path(self, name: str) -> Path:
        p = self.recordings / name
        if not re.fullmatch(r"[\w.\-]+", name) or p.is_symlink() or not p.is_file():
            raise FileNotFoundError(name)
        return p

    # ------------------------------------------------------------------ transmit
    def check_tx(self, freq: float, level: int, tone: float = 0.0, repeat: int = 1):
        if not self.tx_enabled:
            raise PermissionError("la trasmissione è disabilitata (TX_ENABLE=1 per abilitarla)")
        if not math.isfinite(freq) or not dsp.tx_allowed(freq, TX_OFFSET, self.tx_bands):
            bands = ", ".join(f"{lo/1e6:g}–{hi/1e6:g}" for lo, hi in self.tx_bands)
            raise ValueError(f"{freq/1e6:.4f} MHz non si può trasmettere: bande {bands} MHz, e servono "
                             f"{(2*TX_OFFSET+dsp.OCCUPIED)/1e3:.0f} kHz liberi sotto e {dsp.OCCUPIED/1e3:.0f} kHz sopra")
        if not 0 <= level <= self.tx_max_level:
            raise ValueError(f"livello da 0 a {self.tx_max_level}")
        if tone != 0 and tone not in dsp.CTCSS:
            raise ValueError("tono CTCSS non standard")
        if not 1 <= repeat <= 5:
            raise ValueError("ripetizioni da 1 a 5")

    def reserve_tx(self):
        """Take the transmitter before the slow part (decoding the upload). A `stop_tx` from now on cancels."""
        with self.lock:
            if self.tx_on:
                raise Busy("sta già trasmettendo")
            self.tx_on = True
            self.tx_cancel.clear()
            self.error = ""
        self.publish_status()

    def release_tx(self, error: str = ""):
        with self.lock:
            self.tx_on = False
            self.error = error
        self.publish_status()

    def transmit(self, audio: np.ndarray, freq: float, level: int, tone: float = 0.0, repeat: int = 1):
        """Blocking, after reserve_tx(): pause reception, send `repeat` times, resume reception. The modulated IQ
        is streamed into hackrf_transfer's stdin as it is produced: memory and disk stay small at any length."""
        was_rx, err = False, ""
        try:
            self.check_tx(freq, level, tone, repeat)
            with self.lock:
                was_rx, self.rx_on = self.rx_on, False
                old, self.proc = self.proc, None
            if old:
                old.stop()
            self.stop_recording()
            self.publish_status()
            seconds = len(audio) / dsp.AF + 1
            cmd = [hackrf_cmd(), "-t", "-", "-f", str(int(freq - TX_OFFSET)), "-s", str(RATE),
                   "-x", str(level), "-a", "0"]
            for i in range(repeat):
                if i and self.tx_cancel.wait(2):          # the pause between repetitions, interruptible
                    break
                with self.lock:                           # start and register atomically with respect to stop_tx
                    if self.tx_cancel.is_set():
                        break
                    hp = self.tx_proc = Proc(cmd, subprocess.DEVNULL, subprocess.PIPE)
                feed_err: list[str] = []
                feeder = threading.Thread(target=self._feed, args=(hp, audio, tone, feed_err), daemon=True)
                feeder.start()
                try:
                    hp.p.wait(timeout=seconds + 15)
                except subprocess.TimeoutExpired:
                    err = "trasmissione fermata: hackrf_transfer non finiva"
                hp.stop()
                feeder.join(timeout=5)
                with self.lock:
                    self.tx_proc = None
                if not err and feed_err:
                    err = "trasmissione: " + feed_err[0]
                if not err and hp.p.returncode != 0 and not self.tx_cancel.is_set():
                    err = "trasmissione fallita: " + hp.last_error()
                if err:
                    break
        except Exception as e:
            err = f"trasmissione: {e}"
        finally:
            with self.lock:
                self.tx_on = False
                self.tx_proc = None
            if was_rx:
                try:
                    self.start_rx()
                except Exception as e:
                    err = err or f"la ricezione non riparte: {e}"
            if err:
                self.error = err
            self.publish_status()

    def _feed(self, hp: Proc, audio, tone, errors: list):
        """Modulate into the transmitter's stdin; the pipe paces us to real time. Ends at the end of the audio,
        on cancel, or when the process goes away."""
        try:
            for block in dsp.modulate_fm(audio, RATE, TX_OFFSET, tone=tone):
                if self.tx_cancel.is_set():
                    break
                hp.p.stdin.write(block)
        except (BrokenPipeError, ValueError) as e:
            if isinstance(e, ValueError) and "closed file" not in str(e):
                errors.append(str(e))                     # e.g. silent audio
        except Exception as e:
            errors.append(str(e))
        finally:
            try:
                hp.p.stdin.close()
            except OSError:
                pass

    def stop_tx(self):
        self.tx_cancel.set()
        with self.lock:
            hp = self.tx_proc
        if hp:
            hp.stop()

    def shutdown(self):
        self.stop_tx()
        self.stop_rx()


def sniff_audio(head: bytes) -> str:
    """The ffmpeg demuxer for an upload, from its first bytes. Only plain audio containers: no playlists or
    formats that can point ffmpeg to other files or to the network."""
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "wav"
    if head[:4] == b"OggS":
        return "ogg"
    if head[:4] == b"fLaC":
        return "flac"
    if head[:3] == b"ID3" or (len(head) > 1 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0):
        return "mp3"
    raise ValueError("formato non riconosciuto: servono wav, mp3, ogg o flac")


def decode_audio(path: str) -> np.ndarray:
    """A wav/mp3/ogg/flac file → mono float at 48 kHz, at most MAX_TX_SECONDS."""
    if not shutil.which("ffmpeg"):
        raise RuntimeError("manca ffmpeg")
    with open(path, "rb") as f:
        fmt = sniff_audio(f.read(16))
    try:
        r = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-protocol_whitelist", "file,pipe", "-f", fmt,
                            "-i", path, "-t", str(MAX_TX_SECONDS + 1), "-vn", "-ac", "1", "-ar", str(dsp.AF),
                            "-f", "s16le", "-"], capture_output=True, timeout=90)
    except subprocess.TimeoutExpired:
        raise ValueError("file audio troppo lento da leggere")
    if r.returncode != 0 or not r.stdout:
        raise ValueError("file audio non leggibile: " + r.stderr.decode(errors="replace").strip()[:200])
    a = np.frombuffer(r.stdout, "<i2").astype(np.float32) / 32768
    if len(a) > MAX_TX_SECONDS * dsp.AF:
        raise ValueError(f"audio troppo lungo: massimo {MAX_TX_SECONDS} secondi")
    return a
