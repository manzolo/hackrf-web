# How it works

[← back to the README](../README.md)

```
hackrf_transfer -r -  ──int8 IQ 2.4 MS/s──▶ engine.py reader thread (50 ms blocks)
                                              ├─ dsp.Demodulator: mix → FIR ÷10 → FIR ÷5 → FM/AM → 48 kHz
                                              ├─ dsp.spectrum (10 frames/s)
                                              └─ WAV / IQ recording
                       websocket /ws ◀────────┘   "S" frames: RSSI + 1024-bin spectrum, "A" frames: int16 audio
browser: canvas (spectrum, waterfall, scope) + Web Audio, REST calls for every command

upload ─▶ ffmpeg (48 kHz mono) ─▶ dsp.modulate_fm ──int8 IQ on stdin──▶ hackrf_transfer -t - … -a 0
```

## Files

- `app/dsp.py`: channel selection and demodulation on blocks with stateful filters (a stream cut into blocks of
  any size gives the same audio as one array), spectrum, FM modulator, band checks.
- `app/engine.py`: the HackRF processes (stderr drained, terminate → kill → wait), the reader thread, recordings,
  transmission with cancellation.
- `app/server.py`: FastAPI routes, the request guard, the websocket with a bounded per-browser buffer (half a
  second of audio, latest spectrum, latest status).
- `app/static/`: the page, plain JavaScript and canvas, no external assets; `i18n.js` holds the English
  dictionary, keyed by the Italian text of the page.
- `fake/hackrf_transfer`: the stand-in used by the tests and by the demo instance.
- `tools/screenshots.mjs`, `tools/video.mjs`: retake the pictures and the video of the README (Chrome headless
  through the DevTools protocol). The pictures come from a demo instance on the fake HackRF; the video is a real
  transmission, and its sound is the message file placed where it went on air (a HackRF cannot listen to itself
  while it transmits).

## Tests

`make test` builds a test image and runs 36 tests against `fake/hackrf_transfer`, which streams a synthetic FM
signal (1 kHz tone), writes statistics on stderr like the real one, logs its arguments and can be told to fail,
die mid-stream or ignore SIGTERM.

- `tests/test_dsp.py`: known synthetic signals in, expected result out — tone frequency and level after NFM, WFM
  and AM demodulation, a signal 50 kHz away stays out, a stronger broadcast station 200 kHz away stays out,
  identical audio in every mode whatever the block size, squelch, spectrum peak position, modulate → demodulate
  round trip, band parsing, and the transmit check at the exact edges.
- `tests/test_api.py`: the whole path through the API — foreign Host, missing or wrong token, foreign Origin and
  strangers on the websocket refused; the stream with the carrier where expected even with a chatty stderr; a slow
  browser gets only fresh frames; tuning inside and outside the window; settings applied all or nothing; a
  recording whose WAV contains the 1 kHz tone; recordings never overwritten, files being written protected, the
  IQ file rotated on retune, symlinks and traversal refused; HackRF unplugged while recording; transmit disabled
  by default and every guard (band, edges, level, confirmation, repetitions, tone, NaN, oversized upload,
  playlists disguised as audio, too long); reception paused and resumed around a transmission with the exact
  number of bytes sent; Stop between repetitions, on air against a process that ignores SIGTERM, and before it
  starts; a failure while preparing leaves nothing stuck; mp3; shutdown leaves no process.

The suite was checked against injected defects (band check removed, confirmation removed, RF amplifier turned on,
filter state reset between blocks, token check removed, Stop that does not cancel): each one makes at least one
test fail. Dependencies are pinned and `pip-audit` reports no known vulnerabilities at the time of writing.
