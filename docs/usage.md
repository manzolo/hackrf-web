# Using hackrf-web

[← back to the README](../README.md)

## Listening

- **Bands**: one click on a band tunes to it, sets mode and step, starts listening and makes the slider span the
  whole band; the HackRF retunes by itself as you move. Under the dial, the well-known spots of that band
  (calling channels, APRS, ISS) are one click away.
- **Band plan**: on 2 m and 70 cm a strip under the slider shows the IARU Region 1 segments (CW, SSB, beacons,
  digital, repeater inputs and outputs, FM simplex, satellites) and the line below names the one you are in.
  It is coarse and indicative (`app/static/bandplan.js`): national plans differ, the
  [IARU R1 pages](https://www.iaru-r1.org/on-the-air/band-plans/) and your national society have the real thing.
- **Tuning**: slider, ◀ ▶ buttons, ←/→ keys, mouse wheel on the spectrum, click on the waterfall, or type a
  frequency in «Vai a». Anything from 1 MHz to 6 GHz.
- **Modes**: WFM (broadcast, 50 µs de-emphasis), NFM (amateur FM, CTCSS filtered out), AM (airband).
- **Displays**: spectrum of the 2.4 MHz around you, scrolling waterfall, waveform of the audio, S-meter in dBFS.
- **Squelch**, volume, LNA and VGA gains. The HackRF's RF amplifier is never switched on.

The first click also unlocks audio in the browser.

## Recordings

«● Registra» saves what you hear as WAV (48 kHz mono) and, if you tick the box, the raw IQ stream too (int8
interleaved, 2.4 MS/s, 4.8 MB per second; centre frequency in the file name, a new file at each retune). They
live in `./recordings`; the «Registrazioni» tab plays, downloads and deletes them, and sends one back on air with
a click. A recording stops by itself after `REC_MAX_SECONDS`.

## Commands

| Command | What it does |
|---|---|
| `make up` | build the image and start the container |
| `make down` | stop it and release the HackRF (needed before another program uses it) |
| `make test` | run the test suite in a container, with a fake `hackrf_transfer` (never the real radio) |
| `make logs` | follow the container log |
| `make check-public` | scan tree and history for private data before pushing |

## Settings

In the environment or in a `.env` file next to `compose.yaml`:

| Variable | Default | Meaning |
|---|---|---|
| `TX_ENABLE` | `0` | `1` allows transmitting. Leave it off if you only listen. |
| `TX_BANDS` | `144-146,430-434` | where transmitting is allowed, MHz ranges separated by commas. **Set it to your licence and band plan.** |
| `TX_MAX_LEVEL` | `30` | highest TX gain accepted (the HackRF goes to 47) |
| `REC_MAX_SECONDS` | `600` | a recording stops by itself after this long (raw IQ is 17 GB per hour) |
| `ALLOWED_HOSTS` | `127.0.0.1:8073,localhost:8073` | `Host` headers the server answers to |
| `UID`, `GID` | `1000` | user the container runs as (owner of the recordings) |
| `PLUGDEV_GID` | `46` | group that owns the HackRF USB node on the host (`ls -l /dev/bus/usb/*/*`) |

The container sees USB through a bind mount of `/dev/bus/usb` and the device cgroup rule `c 189:* rmw`, so
unplugging and replugging the HackRF works without a restart. On Debian and Ubuntu the `hackrf` package installs
the udev rules that give the `plugdev` group access.
