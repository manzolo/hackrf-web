// Two languages, Italian first. The page is written in Italian; English is a dictionary keyed by the Italian text
// (plain text nodes, title/placeholder/aria-label attributes, and the strings the script builds), plus a few blocks
// with markup inside, keyed by their data-i18n-html name. Messages that come from the server stay in Italian.
"use strict";
const EN = {
  "🎧 Ascolto": "🎧 Listen", "📡 Trasmissione": "📡 Transmit", "💾 Registrazioni": "💾 Recordings",
  "Cosa vuoi ascoltare?": "What do you want to listen to?",
  "squelch chiuso": "squelch closed", "▶ Ascolta": "▶ Listen", "■ Ferma": "■ Stop", "● Registra": "● Record",
  "■ Ferma reg.": "■ Stop rec.", "salva anche l'IQ grezzo": "save the raw IQ too",
  "un passo giù (←)": "one step down (←)", "un passo su (→)": "one step up (→)",
  "trascina, oppure ← → sulla tastiera": "drag, or ← → on the keyboard",
  "Spettro · 2,4 MHz attorno alla frequenza": "Spectrum · 2.4 MHz around the frequency",
  "Waterfall · clic per sintonizzare, rotella per un passo": "Waterfall · click to tune, wheel for one step",
  "Forma d'onda dell'audio": "Audio waveform",
  "12,5k": "12.5k", "−12,5k": "−12.5k", "+12,5k": "+12.5k",
  "Vai a (MHz)": "Go to (MHz)", "Vai": "Go", "Modo": "Mode", "Passo": "Step", "Squelch": "Squelch", "Volume": "Volume",
  "aperto": "open", "Guadagno LNA / VGA": "LNA / VGA gain",
  "Amplificatore RF dell'HackRF sempre spento. L'ingresso dell'HackRF regge al massimo −5 dBm: se una radio trasmette vicino, togli l'antenna dall'HackRF, e non collegarlo mai a un trasmettitore senza un attenuatore adeguato.":
    "The HackRF's RF amplifier is always off. Its input takes −5 dBm at most: if a radio transmits nearby, remove the HackRF's antenna, and never connect it to a transmitter without a proper attenuator.",
  "Frequenza libera": "Free tuning",
  "Fuori dalle bande in elenco: lo slider copre ±1,1 MHz attorno alla frequenza.": "Outside the listed bands: the slider covers ±1.1 MHz around the frequency.",
  "Radio FM": "FM radio", "Aerei": "Airband", "2 metri": "2 metres", "6 metri": "6 metres", "10 metri": "10 metres",
  "Le emittenti: il modo più semplice per provare che tutto funziona.": "Broadcast stations: the easiest way to check that everything works.",
  "Banda aeronautica in AM: torri di controllo e piloti. Solo ascolto.": "Airband in AM: towers and pilots. Listen only.",
  "Radioamatori VHF: ponti ripetitori fra 145.575 e 145.7875, diretta attorno a 145.500.": "Amateur VHF: repeaters between 145.575 and 145.7875, simplex around 145.500.",
  "Radioamatori UHF: ponti nella parte bassa, diretta attorno a 433.500. In Italia la banda è 430–434 (più 435–438 satelliti).":
    "Amateur UHF: repeaters in the lower part, simplex around 433.500. In Italy the band is 430–434 (plus 435–438 for satellites).",
  "I walkie-talkie senza licenza: 16 canali da 12,5 kHz.": "Licence-free walkie-talkies: 16 channels, 12.5 kHz apart.",
  "chiamata FM": "FM calling", "ponti ▸": "repeaters ▸", "ISS ponte": "ISS repeater",
  "1 · Banda": "1 · Band", "2 · Frequenza": "2 · Frequency", "3 · Messaggio": "3 · Message", "4 · Come": "4 · How",
  "frequenza in MHz": "frequency in MHz", "trasmissibile": "transmittable",
  "🎧 Ascolta prima qui": "🎧 Listen here first", "sintonizza l'ascolto su questa frequenza": "tune the receiver to this frequency",
  "togli il file": "remove the file", "Tono CTCSS": "CTCSS tone", "nessuno": "none", "Livello": "Level", "Ripetizioni": "Repetitions",
  "📡 Trasmetti": "📡 Transmit", "IN ONDA": "ON AIR",
  "✗ fuori dalle bande in cui si può trasmettere": "✗ outside the bands where transmitting is allowed",
  "✓ si può trasmettere qui": "✓ you can transmit here",
  "✗ troppo vicino al bordo: da {a} a {b}": "✗ too close to the edge: from {a} to {b}",
  " · troppo lungo!": " · too long!",
  "scegli un file audio": "choose an audio file", "la frequenza non è fra quelle trasmissibili": "this frequency cannot be transmitted on",
  "il file dura più di {n} minuti": "the file is longer than {n} minutes",
  "{n} volte": "{n} times", "{a} su {b}": "{a} of {b}", "preparo…": "preparing…", "fatto ✓": "done ✓",
  "Pronto a trasmettere?": "Ready to transmit?", "Controlla e conferma: dopo va in onda.": "Check and confirm: then it goes on air.",
  "Messaggio": "Message", "Durata": "Length", "Tono": "Tone", "Annulla": "Cancel", "📡 Vai in onda": "📡 Go on air",
  "↻ Aggiorna": "↻ Refresh",
  "band plan IARU R1, indicativo": "IARU R1 band plan, indicative",
  "⚠ non è un segmento per la fonia FM": "⚠ not a segment for FM voice",
  "satelliti (discesa)": "satellites (downlink)", "telegrafia (CW)": "telegraphy (CW)",
  "SSB e CW · chiamata SSB 144.300": "SSB and CW · SSB calling 144.300", "beacon: non trasmettere": "beacons: do not transmit",
  "tutti i modi": "all modes", "digitale · APRS 144.800": "digital · APRS 144.800", "ingressi dei ponti FM": "FM repeater inputs",
  "comunicazioni spaziali": "space communications", "FM diretta · chiamata 145.500": "FM simplex · calling 145.500",
  "uscite dei ponti FM": "FM repeater outputs", "comunicazioni spaziali · ISS 145.800": "space communications · ISS 145.800",
  "satelliti": "satellites", "ponti e link (piano nazionale)": "repeaters and links (national plan)",
  "telegrafia (CW) ed EME": "telegraphy (CW) and EME", "SSB e CW · chiamata SSB 432.200": "SSB and CW · SSB calling 432.200",
  "ponti FM (piano IARU)": "FM repeaters (IARU plan)", "FM diretta · chiamata 433.500": "FM simplex · calling 433.500",
  "tutti i modi e digitale": "all modes and digital", "non assegnata in Italia": "not allocated in Italy",
  "Nessuna registrazione: premi ● Registra mentre ascolti.": "No recordings yet: press ● Record while listening.",
  " · in corso": " · in progress", "scarica": "download", "📡 usa in trasmissione": "📡 use for transmitting", "elimina": "delete",
  "Elimino {name}?": "Delete {name}?", "IT / EN": "IT / EN",
};
const EN_HTML = {
  "tx-off": "Transmitting is <b>disabled</b>. To enable it: <code>TX_ENABLE=1</code> in the <code>.env</code> file next to <code>compose.yaml</code>, then <code>make up</code>.",
  "drop-empty": '<div class="drop-icon">🎙️</div><b>Drop an audio file here</b> or click to choose one<div class="dim">wav, mp3, ogg, flac · up to <span id="tx-max">7</span> minutes</div>',
  "warn": '<summary><b>Before you transmit</b> · licence, band plan, power</summary>Transmitting requires an amateur radio licence valid in your country (in Italy: the operator certificate <i>and</i> the general authorisation with a callsign) and following the band plan: the program only checks that the frequency is inside the bands <span id="tx-bands"></span>, not the sub-bands. Your callsign must be in the message; listen first to make sure the frequency is clear. The level is not a calibrated power and the output is not filtered: for tests use the lowest level that works, better on a dummy load. While it transmits, listening stops and then resumes.',
  "chk1": "I am <b>authorised</b> to transmit on this frequency",
  "chk2": "My <b>callsign</b> is in the message",
  "chk3": "I have listened: the frequency is <b>clear</b>",
  "rec-where": "Recordings are kept in the <code>recordings/</code> folder.",
};
let lang = "it";
try { lang = localStorage.getItem("lang") === "en" ? "en" : "it"; } catch (e) { /* no storage: Italian */ }
const T = (s, vars) => {
  let out = lang === "en" && s in EN ? EN[s] : s;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replace(`{${k}}`, v);
  return out;
};
// the static page: remember the Italian of every text node, attribute and marked block once, then swap on demand
const I18N = { nodes: [], attrs: [], blocks: [] };
function i18nScan() {
  for (const el of document.querySelectorAll("[data-i18n-html]")) I18N.blocks.push([el, el.dataset.i18nHtml, el.innerHTML]);
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => n.parentElement.closest("script,[data-i18n-html]") || !n.nodeValue.trim() ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  for (let n = w.nextNode(); n; n = w.nextNode()) I18N.nodes.push([n, n.nodeValue]);
  for (const el of document.querySelectorAll("[title],[placeholder],[aria-label]"))
    for (const a of ["title", "placeholder", "aria-label"]) if (el.hasAttribute(a)) I18N.attrs.push([el, a, el.getAttribute(a)]);
}
function i18nApply() {
  document.documentElement.lang = lang;
  for (const [el, key, it] of I18N.blocks) el.innerHTML = lang === "en" && EN_HTML[key] ? EN_HTML[key] : it;
  for (const [n, it] of I18N.nodes) {
    const core = it.trim().replace(/\s+/g, " ");
    n.nodeValue = it.replace(it.trim(), T(core));
  }
  for (const [el, a, it] of I18N.attrs) el.setAttribute(a, T(it));
}
function setLang(l) {
  lang = l === "en" ? "en" : "it";
  try { localStorage.setItem("lang", lang); } catch (e) { /* fine */ }
  i18nApply();
}
