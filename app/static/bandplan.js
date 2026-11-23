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
// [from, to, kind, what, notes for the guide]
const BANDPLAN = {
  "2m": [
    [144.000, 144.025, "sat", "satelliti (discesa)", "tutti i modi, solo dallo spazio verso terra"],
    [144.025, 144.150, "cw", "telegrafia (CW)", "chiamata CW 144.050; anche modi digitali stretti e EME"],
    [144.150, 144.400, "ssb", "SSB e CW · chiamata SSB 144.300", "il DX in fonia: SSB in banda laterale superiore (USB)"],
    [144.400, 144.500, "beacon", "beacon: non trasmettere", "radiofari per studiare la propagazione: si ascoltano soltanto"],
    [144.500, 144.794, "all", "tutti i modi", "SSTV attorno a 144.500, transponder lineari, esperimenti"],
    [144.794, 144.975, "digi", "digitale · APRS 144.800", "APRS e packet su 144.800 in tutta Europa"],
    [144.975, 145.194, "rptin", "ingressi dei ponti FM", "qui trasmette chi usa un ponte: 600 kHz sotto la sua uscita"],
    [145.194, 145.206, "space", "comunicazioni spaziali", "FM, collegamenti con lo spazio"],
    [145.206, 145.5935, "simplex", "FM diretta · chiamata 145.500", "canali ogni 12,5 kHz; su 145.500 ci si chiama e poi ci si sposta; 145.375 chiamata in fonia digitale"],
    [145.5935, 145.7935, "rptout", "uscite dei ponti FM", "qui si ascoltano i ponti; shift −600 kHz, spesso con tono CTCSS"],
    [145.7935, 145.806, "space", "comunicazioni spaziali · ISS 145.800", "la Stazione Spaziale: fonia, SSTV e packet scendono su 145.800"],
    [145.806, 146.000, "sat", "satelliti", "solo satelliti"],
  ],
  "70cm": [
    [430.000, 432.000, "nat", "ponti e link (piano nazionale)", "in Italia i ponti FM e digitali, con shift +1,6 o +5 MHz secondo il ponte"],
    [432.000, 432.100, "cw", "telegrafia (CW) ed EME", "anche i collegamenti via Luna"],
    [432.100, 432.400, "ssb", "SSB e CW · chiamata SSB 432.200", "il DX in fonia, in USB"],
    [432.400, 432.500, "beacon", "beacon: non trasmettere", "radiofari: si ascoltano soltanto"],
    [432.500, 433.000, "all", "tutti i modi", "transponder lineari, SSTV, esperimenti"],
    [433.000, 433.400, "rptin", "ponti FM (piano IARU)", "ingressi dei ponti nei Paesi che usano lo shift di 1,6 MHz"],
    [433.400, 433.600, "simplex", "FM diretta · chiamata 433.500", "canali ogni 25 kHz (o 12,5); su 433.500 ci si chiama e poi ci si sposta"],
    [433.600, 434.000, "all", "tutti i modi e digitale", "attenzione: 433.05–434.79 è anche banda ISM, con telecomandi e sensori"],
    [434.000, 435.000, "out", "non assegnata in Italia", "altrove: tutti i modi, ATV, uscite dei ponti"],
    [435.000, 438.000, "sat", "satelliti", "in Italia assegnata ai radioamatori per il servizio via satellite"],
    [438.000, 440.000, "out", "non assegnata in Italia", "altrove: ATV, ponti e link"],
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

// planTable(el, key, label): the same plan as a readable table (for the guide)
function planTable(el, key, label) {
  const rows = BANDPLAN[key].map(([a, b, kind, text, note]) =>
    `<tr><td class="mono"><span class="chip" style="background:${KINDS[kind].color}"></span>${a.toFixed(3)} – ${b.toFixed(3)}</td>` +
    `<td><b>${label(text)}</b><div class="dim">${label(note)}</div></td><td class="fm ${KINDS[kind].fm ? "yes" : "no"}">${KINDS[kind].fm ? "✓" : "—"}</td></tr>`).join("");
  el.innerHTML = `<table><thead><tr><th>MHz</th><th>${label("Uso")}</th><th>${label("Fonia FM")}</th></tr></thead><tbody>${rows}</tbody></table>`;
}
