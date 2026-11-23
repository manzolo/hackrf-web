"""Signal processing for hackrf-web: channel selection, demodulation (NFM, WFM, AM), spectrum, FM modulation.

Everything works on blocks and keeps its state between blocks (filters, oscillator phase, last sample), so a
stream cut into chunks of any size gives the same audio as one long array. The block size only has to be a
multiple of the decimation factors (50 at 2.4 MS/s); callers use 1/20 s = 120000 samples.
"""
from __future__ import annotations

import numpy as np
from scipy import signal

AF = 48000           # audio rate
MODES = ("nfm", "wfm", "am")
OCCUPIED = 8e3       # half of the bandwidth an NFM transmission occupies (2.5 kHz deviation + 3 kHz audio, rounded up)
CTCSS = (67.0, 69.3, 71.9, 74.4, 77.0, 79.7, 82.5, 85.4, 88.5, 91.5, 94.8, 97.4, 100.0, 103.5, 107.2, 110.9,
         114.8, 118.8, 123.0, 127.3, 131.8, 136.5, 141.3, 146.2, 151.4, 156.7, 159.8, 162.2, 165.5, 167.9,
         171.3, 173.8, 177.3, 179.9, 183.5, 186.2, 189.9, 192.8, 196.6, 199.5, 203.5, 206.5, 210.7, 218.1,
         225.7, 229.1, 233.6, 241.8, 250.3, 254.1)


class Decim:
    """FIR low-pass + decimation, stateful across blocks."""

    def __init__(self, taps: np.ndarray, factor: int, complex_: bool = True):
        self.h = taps.astype(np.float32)
        self.q = factor
        self.z = np.zeros(len(taps) - 1, np.complex64 if complex_ else np.float32)
        self.phase = 0

    def __call__(self, x: np.ndarray) -> np.ndarray:
        y, self.z = signal.lfilter(self.h, 1, x, zi=self.z)
        out = y[self.phase::self.q]
        self.phase = (self.phase - len(x)) % self.q
        return out


class IIR:
    """A small IIR filter (b, a) with state, real-valued."""

    def __init__(self, b, a):
        self.b, self.a = np.asarray(b, np.float64), np.asarray(a, np.float64)
        self.z = np.zeros(max(len(self.a), len(self.b)) - 1)

    def __call__(self, x):
        y, self.z = signal.lfilter(self.b, self.a, x, zi=self.z)
        return y


class Demodulator:
    """IQ at `rate` → audio at 48 kHz for the channel `offset` Hz away from the tuner centre.

    nfm: ÷10 then ÷5, ±8 kHz channel, 5 kHz deviation = full scale, CTCSS removed (300 Hz high-pass).
    wfm: ÷5 (480 kHz, so that neighbours 200 kHz away do not alias into the channel), 75 kHz deviation = full
         scale, 50 µs de-emphasis, then ÷10.
    am:  as nfm with a ±5 kHz channel; envelope divided by its running average (AGC, 0.3 s time constant).
    The audio does not depend on how the stream is cut into blocks. `rssi` and the squelch are per block:
    channel power in dBFS of the last block; below `squelch` dBFS that block's audio is silence.
    """

    def __init__(self, rate: int, mode: str = "nfm", offset: float = 0.0, squelch: float = -200.0):
        if mode not in MODES:
            raise ValueError(f"modo sconosciuto: {mode}")
        q = int(round(rate / AF))
        if q * AF != rate or q % 10:
            raise ValueError("la frequenza di campionamento deve essere un multiplo di 480000")
        self.rate, self.mode, self.offset, self.squelch = rate, mode, float(offset), squelch
        q1 = 5 if mode == "wfm" else 10
        self.r1 = rate // q1
        self.q2 = q // q1
        self.nco = 0.0
        self.rssi = -200.0
        self.open = False
        if mode == "wfm":
            self.d1 = Decim(signal.firwin(63, 120e3, fs=rate), q1)
            a = np.exp(-1.0 / (self.r1 * 50e-6))
            self.deemph = IIR([1 - a], [1, -a])
            self.d2 = Decim(signal.firwin(255, 15e3, fs=self.r1), self.q2, complex_=False)
        else:
            self.d1 = Decim(signal.firwin(63, 60e3, fs=rate), q1)
            self.d2 = Decim(signal.firwin(255, 8e3 if mode == "nfm" else 5e3, fs=self.r1), self.q2)
            a = np.exp(-1.0 / (AF * 0.3))
            self.agc = IIR([1 - a], [1, -a])
            self.agc_primed = False
            b, a = signal.butter(2, 300, "highpass", fs=AF)
            self.hp = IIR(b, a)
            b, a = signal.butter(2, 3500, "lowpass", fs=AF)
            self.lp = IIR(b, a)
        self.last = np.complex64(1)

    def set_offset(self, offset: float):
        self.offset = float(offset)

    def _mix(self, iq: np.ndarray) -> np.ndarray:
        w = 2 * np.pi * self.offset / self.rate
        ph = self.nco - w * np.arange(len(iq))
        self.nco = float((self.nco - w * len(iq)) % (2 * np.pi))
        return iq * np.exp(1j * ph).astype(np.complex64)

    def _fm(self, x: np.ndarray, fs: float, dev: float) -> np.ndarray:
        prev = np.concatenate(([self.last], x[:-1]))
        self.last = x[-1] if len(x) else self.last
        return np.angle(x * np.conj(prev)) * fs / (2 * np.pi) / dev

    def process(self, iq: np.ndarray) -> np.ndarray:
        x = self.d1(self._mix(iq))
        if self.mode == "wfm":
            self.rssi = 10 * np.log10(np.mean(np.abs(x) ** 2) + 1e-20)
            audio = self.d2(self.deemph(self._fm(x, self.r1, 75e3)))
        else:
            x = self.d2(x)
            self.rssi = 10 * np.log10(np.mean(np.abs(x) ** 2) + 1e-20)
            if self.mode == "nfm":
                audio = self._fm(x, AF, 5e3)
            else:
                env = np.abs(x).astype(np.float64)
                if not self.agc_primed and len(env):       # start the average at the first sample, not at zero
                    self.agc.z = signal.lfilter_zi(self.agc.b, self.agc.a) * env[0]
                    self.agc_primed = True
                audio = env / (self.agc(env) + 1e-12) - 1.0
            audio = self.lp(self.hp(audio))
        self.open = self.rssi >= self.squelch
        if not self.open:
            audio = np.zeros_like(audio)
        return np.clip(audio, -1.0, 1.0).astype(np.float32)


def spectrum(iq: np.ndarray, bins: int = 1024) -> np.ndarray:
    """Power spectrum in dBFS, `bins` points from centre-rate/2 to centre+rate/2 (DC in the middle)."""
    n = bins
    k = len(iq) // n
    if k == 0:
        return np.full(bins, -120.0, np.float32)
    seg = iq[: k * n].reshape(k, n) * np.hanning(n).astype(np.float32)
    p = np.mean(np.abs(np.fft.fft(seg, axis=1)) ** 2, axis=0) / (n * n * 0.375)
    return (10 * np.log10(np.fft.fftshift(p) + 1e-20)).astype(np.float32)


def iq_from_int8(raw: bytes) -> np.ndarray:
    a = np.frombuffer(raw, dtype=np.int8).astype(np.float32)
    return ((a[0::2] + 1j * a[1::2]) / 128.0).astype(np.complex64)


def parse_bands(text: str) -> list[tuple[float, float]]:
    """'144-146,430-434' (MHz) → [(144e6, 146e6), (430e6, 434e6)]."""
    out = []
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        lo, hi = (float(v) * 1e6 for v in part.split("-"))
        if not (np.isfinite(lo) and np.isfinite(hi) and 1e6 <= lo < hi <= 6e9):
            raise ValueError(f"banda non valida: {part}")
        out.append((lo, hi))
    return out


def in_bands(hz: float, bands: list[tuple[float, float]]) -> bool:
    return any(lo <= hz <= hi for lo, hi in bands)


def tx_allowed(freq: float, lo_offset: float, bands: list[tuple[float, float]]) -> bool:
    """True if a transmission on `freq`, with the HackRF tuned `lo_offset` Hz below it, stays inside one band:
    the occupied bandwidth (freq ± OCCUPIED), the residual carrier (freq - lo_offset) and the mirror image that
    I/Q imbalance leaves on the other side of it (freq - 2·lo_offset)."""
    return any(lo <= freq - 2 * lo_offset - OCCUPIED and freq + OCCUPIED <= hi for lo, hi in bands)


def modulate_fm(audio: np.ndarray, rate: int, offset: float, dev: float = 2500.0, tone: float = 0.0,
                pad: float = 0.5):
    """Audio at 48 kHz (any scale) → FM, yields int8 I/Q blocks of one second each.

    Voice band-passed 300–3000 Hz and normalised to `dev` Hz of peak deviation; optional CTCSS `tone` at 600 Hz
    of deviation; `pad` seconds of carrier before and after so the receiver's squelch opens in time.
    """
    up = int(round(rate / AF))
    if up * AF != rate:
        raise ValueError("la frequenza di campionamento deve essere un multiplo di 48000")
    x = signal.lfilter(signal.firwin(511, [300, 3000], pass_zero=False, fs=AF), 1, np.asarray(audio, np.float64))
    pk = np.percentile(np.abs(x), 99.9) if len(x) else 0.0
    if pk <= 0:
        raise ValueError("l'audio è muto")
    x = np.clip(x / pk, -1, 1) * dev
    p = np.zeros(int(pad * AF))
    x = np.concatenate([p, x, p])
    if tone:
        x = x + 600 * np.sin(2 * np.pi * tone * np.arange(len(x)) / AF)
    phase = 0.0
    for s in range(0, len(x), AF):
        xs = x[s:s + AF + 1]
        m = min(AF, len(x) - s)
        f = offset + np.interp(np.arange(m * up) / up, np.arange(len(xs)), xs)
        ph = phase + 2 * np.pi * np.cumsum(f) / rate
        phase = float(ph[-1] % (2 * np.pi))
        b = np.empty(2 * len(ph), np.int8)
        b[0::2] = np.round(0.7 * 127 * np.cos(ph))
        b[1::2] = np.round(0.7 * 127 * np.sin(ph))
        yield b.tobytes()
