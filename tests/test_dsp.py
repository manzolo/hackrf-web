"""DSP with known inputs: a synthetic signal goes in, the expected tone, level or peak must come out."""
import numpy as np
import pytest

from app import dsp

RATE = 2_400_000


def fm_iq(seconds, offset, dev, tone_hz=1000.0, rate=RATE, amp=0.5, noise=0.01, seed=1):
    k = np.arange(int(seconds * rate))
    ph = 2 * np.pi * np.cumsum(offset + dev * np.sin(2 * np.pi * tone_hz * k / rate)) / rate
    rng = np.random.default_rng(seed)
    x = amp * np.exp(1j * ph) + noise * (rng.normal(size=len(k)) + 1j * rng.normal(size=len(k)))
    return x.astype(np.complex64)


def run(demod, iq, block=120000):
    return np.concatenate([demod.process(iq[s:s + block]) for s in range(0, len(iq), block)])


def dominant(audio, fs=48000):
    a = audio[len(audio) // 4:]                      # skip filter start-up
    S = np.abs(np.fft.rfft(a * np.hanning(len(a))))
    return np.fft.rfftfreq(len(a), 1 / fs)[np.argmax(S)]


def rms(a):
    a = a[len(a) // 4:]
    return float(np.sqrt(np.mean(a ** 2)))


def test_nfm_tone_and_level():
    audio = run(dsp.Demodulator(RATE, "nfm", 150e3), fm_iq(1.0, 150e3, 3000))
    assert abs(dominant(audio) - 1000) < 5
    # 3 kHz of deviation on a 5 kHz full scale: a sine of peak 0.6, rms 0.42
    assert 0.36 < rms(audio) < 0.48


def test_nfm_wrong_channel_is_quiet():
    # the same signal 50 kHz away from where we listen: nothing of it in the audio
    d = dsp.Demodulator(RATE, "nfm", 200e3)
    audio = run(d, fm_iq(1.0, 150e3, 3000))
    S = np.abs(np.fft.rfft(audio[12000:]))
    f = np.fft.rfftfreq(len(audio[12000:]), 1 / 48000)
    assert S[np.argmin(abs(f - 1000))] < 0.05 * S.max() or d.rssi < -40


def test_wfm_tone():
    audio = run(dsp.Demodulator(RATE, "wfm", -400e3), fm_iq(1.0, -400e3, 50e3))
    assert abs(dominant(audio) - 1000) < 5


def test_am_tone():
    k = np.arange(RATE)
    x = 0.4 * (1 + 0.5 * np.sin(2 * np.pi * 1000 * k / RATE)) * np.exp(2j * np.pi * 100e3 * k / RATE)
    audio = run(dsp.Demodulator(RATE, "am", 100e3), x.astype(np.complex64))
    assert abs(dominant(audio) - 1000) < 5


def test_chunk_size_does_not_change_audio():
    iq = fm_iq(0.5, 150e3, 3000)
    a = run(dsp.Demodulator(RATE, "nfm", 150e3), iq, block=120000)
    b = run(dsp.Demodulator(RATE, "nfm", 150e3), iq, block=60000)
    c = run(dsp.Demodulator(RATE, "nfm", 150e3), iq, block=len(iq))
    assert np.allclose(a, b, atol=1e-4) and np.allclose(a, c, atol=1e-4)


@pytest.mark.parametrize("mode,dev", [("wfm", 50e3), ("am", 0)])
def test_chunk_size_does_not_change_audio_other_modes(mode, dev):
    if mode == "am":
        k = np.arange(RATE // 2)
        iq = (0.4 * (1 + 0.5 * np.sin(2 * np.pi * 1000 * k / RATE)) * np.exp(2j * np.pi * 150e3 * k / RATE)).astype(np.complex64)
    else:
        iq = fm_iq(0.5, 150e3, dev)
    a = run(dsp.Demodulator(RATE, mode, 150e3), iq, block=120000)
    b = run(dsp.Demodulator(RATE, mode, 150e3), iq, block=60000)
    c = run(dsp.Demodulator(RATE, mode, 150e3), iq, block=len(iq))
    assert np.allclose(a, b, atol=1e-3) and np.allclose(a, c, atol=1e-3)


def test_wfm_neighbour_200khz_away_stays_out():
    # a stronger station on the next broadcast channel must not alias into the one we listen to
    wanted = fm_iq(1.0, -400e3, 50e3, tone_hz=1000, amp=0.2)
    neighbour = fm_iq(1.0, -200e3, 50e3, tone_hz=3000, amp=0.4, noise=0, seed=2)
    audio = run(dsp.Demodulator(RATE, "wfm", -400e3), wanted + neighbour)
    a = audio[len(audio) // 4:]
    S = np.abs(np.fft.rfft(a * np.hanning(len(a))))
    f = np.fft.rfftfreq(len(a), 1 / 48000)
    assert abs(f[np.argmax(S)] - 1000) < 5
    assert S[np.argmin(abs(f - 3000))] < 0.05 * S.max()


def test_squelch():
    noise = fm_iq(0.5, 150e3, 3000, amp=0.0, noise=0.01)
    d = dsp.Demodulator(RATE, "nfm", 150e3, squelch=-40)
    assert not np.any(run(d, noise)) and not d.open
    d = dsp.Demodulator(RATE, "nfm", 150e3, squelch=-40)
    assert np.any(run(d, fm_iq(0.5, 150e3, 3000))) and d.open


def test_spectrum_peak():
    k = np.arange(120000)
    x = (0.5 * np.exp(2j * np.pi * 300e3 * k / RATE)).astype(np.complex64)
    s = dsp.spectrum(x, 1024)
    peak = (np.argmax(s) - 512) * RATE / 1024
    assert abs(peak - 300e3) <= RATE / 1024
    assert s.max() > -10


def test_bands():
    b = dsp.parse_bands("144-146,430-434")
    assert dsp.in_bands(145.5e6, b) and dsp.in_bands(433.45e6, b)
    assert not dsp.in_bands(435.5e6, b) and not dsp.in_bands(100e6, b)
    for wrong in ("146-144", "abc", "144-", "0-10", "nan-146"):
        with pytest.raises(ValueError):
            dsp.parse_bands(wrong)


def test_tx_allowed_counts_everything_that_goes_on_air():
    b = dsp.parse_bands("144-146,430-434")
    lo = 200e3
    assert dsp.tx_allowed(145.5e6, lo, b) and dsp.tx_allowed(433.45e6, lo, b)
    assert dsp.tx_allowed(145.992e6, lo, b) and not dsp.tx_allowed(145.993e6, lo, b)   # ±8 kHz of modulation
    assert dsp.tx_allowed(144.408e6, lo, b) and not dsp.tx_allowed(144.407e6, lo, b)   # carrier and image below
    assert not dsp.tx_allowed(430.2e6, lo, b) and not dsp.tx_allowed(100e6, lo, b)


def test_modulate_then_demodulate():
    t = np.arange(48000) / 48000
    audio = np.sin(2 * np.pi * 1000 * t)
    raw = b"".join(dsp.modulate_fm(audio, RATE, 200e3, dev=2500, tone=88.5))
    iq = dsp.iq_from_int8(raw)
    assert abs(len(iq) / RATE - 2.0) < 0.01               # 1 s + 0.5 s of carrier on each side
    out = run(dsp.Demodulator(RATE, "nfm", 200e3), iq)
    assert abs(dominant(out) - 1000) < 5
    assert 0.3 < rms(out[:48000 * 3 // 2]) < 0.42           # 2.5 kHz → peak 0.5, rms 0.35 (+ silent pad)


def test_mute_audio_refused():
    with pytest.raises(ValueError):
        list(dsp.modulate_fm(np.zeros(48000), RATE, 200e3))
