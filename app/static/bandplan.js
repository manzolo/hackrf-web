// An indicative band plan for the two amateur bands of the page: IARU Region 1, coarse segments, MHz.
// It is a guide, not the law: national plans differ (source and details: https://www.iaru-r1.org/on-the-air/band-plans/).
// kind: what the segment is for; `fm` says whether FM voice (what this page transmits) belongs there.
"use strict";
const KINDS = {
  sat: { color: "#e3c341", fm: false }, cw: { color: "#9aa7b8", fm: false }, ssb: { color: "#d98a4a", fm: false },
  beacon: { color: "#ff5a52", fm: false }, all: { color: "#3aa7a0", fm: false }, digi: { color: "#a57be0", fm: false },
  rptin: { color: "#3f7fd6", fm: true }, rptout: { color: "#5aa0ff", fm: true }, simplex: { color: "#3ddc84", fm: true },
  space: { color: "#e3c341", fm: false }, nat: { color: "#5a6b82", fm: true }, out: { color: "#2a3342", fm: false },
};
const BANDPLAN = {
  "2m": [
    [144.000, 144.025, "sat", "satelliti (discesa)"],
    [144.025, 144.150, "cw", "telegrafia (CW)"],
    [144.150, 144.400, "ssb", "SSB e CW · chiamata SSB 144.300"],
    [144.400, 144.500, "beacon", "beacon: non trasmettere"],
    [144.500, 144.794, "all", "tutti i modi"],
    [144.794, 144.975, "digi", "digitale · APRS 144.800"],
    [144.975, 145.194, "rptin", "ingressi dei ponti FM"],
    [145.194, 145.206, "space", "comunicazioni spaziali"],
    [145.206, 145.5935, "simplex", "FM diretta · chiamata 145.500"],
    [145.5935, 145.7935, "rptout", "uscite dei ponti FM"],
    [145.7935, 145.806, "space", "comunicazioni spaziali · ISS 145.800"],
    [145.806, 146.000, "sat", "satelliti"],
  ],
  "70cm": [
    [430.000, 432.000, "nat", "ponti e link (piano nazionale)"],
    [432.000, 432.100, "cw", "telegrafia (CW) ed EME"],
    [432.100, 432.400, "ssb", "SSB e CW · chiamata SSB 432.200"],
    [432.400, 432.500, "beacon", "beacon: non trasmettere"],
    [432.500, 433.000, "all", "tutti i modi"],
    [433.000, 433.400, "rptin", "ponti FM (piano IARU)"],
    [433.400, 433.600, "simplex", "FM diretta · chiamata 433.500"],
    [433.600, 434.000, "all", "tutti i modi e digitale"],
    [434.000, 435.000, "out", "non assegnata in Italia"],
    [435.000, 438.000, "sat", "satelliti"],
    [438.000, 440.000, "out", "non assegnata in Italia"],
  ],
};
function planFor(mhzLo, mhzHi) {            // the plan whose band overlaps [lo, hi], or null
  for (const segs of Object.values(BANDPLAN)) if (segs[0][0] < mhzHi && segs.at(-1)[1] > mhzLo) return segs;
  return null;
}
function segmentAt(fMHz) {
  for (const segs of Object.values(BANDPLAN)) for (const s of segs) if (fMHz >= s[0] && fMHz < s[1]) return s;
  return null;
}
// drawPlan(el, lo, hi, f): a strip of coloured segments between lo and hi (MHz) with a marker at f
function drawPlan(el, lo, hi, f, label) {
  const segs = planFor(lo, hi);
  el.hidden = !segs;
  if (!segs) return;
  const key = `${lo}|${hi}|${label("x")}`;
  if (el.dataset.key !== key) {
    el.dataset.key = key; el.innerHTML = "";
    for (const [a, b, kind, text] of segs) {
      const x0 = Math.max(a, lo), x1 = Math.min(b, hi);
      if (x1 <= x0) continue;
      const d = document.createElement("i");
      d.style.cssText = `left:${(x0 - lo) / (hi - lo) * 100}%;width:${(x1 - x0) / (hi - lo) * 100}%;background:${KINDS[kind].color}`;
      d.title = `${a.toFixed(3)}–${b.toFixed(3)} · ${label(text)}`;
      el.append(d);
    }
    const m = document.createElement("b"); el.append(m);
  }
  el.querySelector("b").style.left = `${Math.max(0, Math.min(100, (f - lo) / (hi - lo) * 100))}%`;
}
