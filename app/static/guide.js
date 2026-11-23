// The phrase book of the guide: how a contact goes, step by step, and a glossary with a filter.
// Every entry: [term, category, Italian, English]. Categories: q (Q code), abbr (abbreviations and jargon),
// rep (reports), tech (words of the radio).
"use strict";
const GLOSSARY = [
  ["QRA", "q", "il nome della stazione; in Italia, parlando, il nome dell'operatore: «il mio QRA è Andrea»", "the name of the station; in Italy, on voice, the operator's name"],
  ["QRB", "q", "la distanza fra le due stazioni", "the distance between the two stations"],
  ["QRG", "q", "la frequenza esatta: «che QRG?»", "the exact frequency: “what's the QRG?”"],
  ["QRK", "q", "la comprensibilità dei segnali (da 1 a 5)", "the readability of the signals (1 to 5)"],
  ["QRL", "q", "sono occupato; «QRL?» = la frequenza è occupata?", "I am busy; “QRL?” = is this frequency in use?"],
  ["QRM", "q", "disturbi da altre stazioni", "interference from other stations"],
  ["QRN", "q", "rumore naturale: scariche, temporali", "natural noise: static, thunderstorms"],
  ["QRO", "q", "alta potenza, o «aumenta la potenza»", "high power, or “increase power”"],
  ["QRP", "q", "bassa potenza (di solito fino a 5 W), o «diminuisci la potenza»", "low power (usually up to 5 W), or “reduce power”"],
  ["QRQ", "q", "trasmetti più veloce (in telegrafia)", "send faster (in Morse)"],
  ["QRS", "q", "trasmetti più lentamente (in telegrafia)", "send more slowly (in Morse)"],
  ["QRT", "q", "chiudo la stazione, smetto di trasmettere", "closing down, I stop transmitting"],
  ["QRV", "q", "sono pronto, sono attivo: «sono QRV in 2 metri»", "I am ready, I am active: “I'm QRV on 2 metres”"],
  ["QRX", "q", "aspetta un momento, ti richiamo", "stand by, I will call you again"],
  ["QRZ", "q", "«QRZ?» = chi mi chiama?", "“QRZ?” = who is calling me?"],
  ["QSA", "q", "l'intensità dei segnali (da 1 a 5)", "the strength of the signals (1 to 5)"],
  ["QSB", "q", "evanescenza: il segnale va e viene", "fading: the signal comes and goes"],
  ["QSL", "q", "confermo, ricevuto; anche la cartolina che conferma il collegamento", "I confirm, received; also the card that confirms a contact"],
  ["QSO", "q", "il collegamento fra due stazioni", "a contact between two stations"],
  ["QSP", "q", "ritrasmetto un messaggio a un'altra stazione (faccio da ponte)", "I relay a message to another station"],
  ["QSY", "q", "cambio frequenza: «facciamo QSY a 145.450»", "change of frequency: “let's QSY to 145.450”"],
  ["QTC", "q", "ho un messaggio da passare", "I have a message to pass"],
  ["QTH", "q", "il luogo da cui trasmetto", "the place I transmit from"],
  ["QTR", "q", "l'ora esatta", "the exact time"],
  ["CQ", "abbr", "chiamata generale a tutte le stazioni: «c'è qualcuno?»", "general call to all stations: “anyone there?”"],
  ["CQ DX", "abbr", "chiamata generale rivolta solo a stazioni lontane", "general call for distant stations only"],
  ["DX", "abbr", "collegamento a grande distanza; una stazione lontana o rara", "a long-distance contact; a far or rare station"],
  ["73", "abbr", "cordiali saluti: si dice alla fine di ogni collegamento", "best regards: said at the end of every contact"],
  ["88", "abbr", "baci e abbracci, saluto affettuoso", "love and kisses, an affectionate goodbye"],
  ["OM", "abbr", "«old man»: un radioamatore, qualunque età abbia", "“old man”: a radio amateur, of any age"],
  ["YL / XYL", "abbr", "«young lady»: una radioamatrice / la moglie di un radioamatore", "“young lady”: a woman operator / an amateur's wife"],
  ["SWL", "abbr", "chi ascolta soltanto, senza trasmettere", "a listener, who does not transmit"],
  ["K", "abbr", "«passo»: invito a trasmettere, a fine passaggio", "“over”: invitation to transmit, at the end of a transmission"],
  ["BK / break", "abbr", "interruzione: si dice (col proprio nominativo) per inserirsi in un collegamento", "break: said (with your callsign) to join a contact in progress"],
  ["R / roger", "abbr", "ricevuto tutto", "received everything"],
  ["DE", "abbr", "«da»: IK5XXX de IU5VMO", "“from”: IK5XXX de IU5VMO"],
  ["PSE / TNX", "abbr", "per favore / grazie (in telegrafia e nei messaggi)", "please / thanks (in Morse and in messages)"],
  ["/P /M /MM", "abbr", "dopo il nominativo: in portatile, in mobile (auto), in mobile marittimo", "after the callsign: portable, mobile (car), maritime mobile"],
  ["passo", "abbr", "fine del mio passaggio, tocca a te; «passo e chiudo» alla fine del collegamento", "end of my transmission, your turn (Italian for “over”)"],
  ["pile-up", "abbr", "tante stazioni che chiamano insieme la stessa stazione rara", "many stations calling the same rare station at once"],
  ["contest", "abbr", "gara: fare più collegamenti possibile in un tempo dato", "a competition: as many contacts as possible in a given time"],
  ["shack", "abbr", "la stanza della radio", "the radio room"],
  ["RST", "rep", "il rapporto: comprensibilità (R, 1–5), intensità (S, 1–9) e, in telegrafia, nota (T, 1–9). In fonia: «cinque nove»", "the report: readability (R, 1–5), strength (S, 1–9) and, in Morse, tone (T, 1–9). On voice: “five nine”"],
  ["R 1–5", "rep", "1 incomprensibile · 2 a tratti · 3 con difficoltà · 4 senza difficoltà · 5 perfetto", "1 unreadable · 2 barely · 3 with difficulty · 4 no difficulty · 5 perfect"],
  ["S 1–9", "rep", "1 appena percettibile · 5 discreto · 7 abbastanza forte · 9 fortissimo; oltre: «9 più 20 dB»", "1 barely perceptible · 5 fairly good · 7 moderately strong · 9 very strong; beyond: “9 plus 20 dB”"],
  ["Radio / Santiago", "rep", "in Italia il rapporto in fonia si dice spesso così: «Radio 5, Santiago 9»", "in Italy the voice report is often said this way: “Radio 5, Santiago 9”"],
  ["controllo", "rep", "chiedere come si arriva: «chiedo un controllo di modulazione»", "asking how you sound: a signal and audio check"],
  ["PTT", "tech", "«push to talk»: il tasto che si preme per trasmettere", "push to talk: the key you press to transmit"],
  ["RX / TX / RTX", "tech", "ricevitore / trasmettitore / ricetrasmettitore", "receiver / transmitter / transceiver"],
  ["VFO", "tech", "la sintonia libera: la frequenza la scegli tu con la manopola", "free tuning: you choose the frequency with the knob"],
  ["squelch", "tech", "il silenziatore: taglia il fruscio quando non c'è segnale", "mutes the hiss when there is no signal"],
  ["shift", "tech", "la distanza fra la frequenza su cui ascolti un ponte e quella su cui gli trasmetti", "the distance between the frequency you hear a repeater on and the one you transmit to it on"],
  ["CTCSS / subtono", "tech", "una nota bassa aggiunta alla voce, che apre il ponte", "a low tone added to the voice, which opens the repeater"],
  ["diretta / simplex", "tech", "collegamento senza ponte, sulla stessa frequenza", "a contact without a repeater, on one frequency"],
  ["ponte / ripetitore", "tech", "stazione automatica in alto che ritrasmette chi la usa", "an automatic station on high ground that retransmits its users"],
  ["beacon", "tech", "radiofaro: trasmette da solo, sempre, per far capire come va la propagazione", "a station that transmits by itself, always, to show how propagation is"],
  ["locator", "tech", "la posizione in sei caratteri, per esempio JN53PX: un quadratino di pochi chilometri", "your position in six characters, e.g. JN53PX: a square a few kilometres wide"],
  ["ROS / SWR", "tech", "rapporto d'onde stazionarie: dice se l'antenna è adatta alla frequenza (1:1 perfetto, sotto 1,5 bene)", "standing wave ratio: tells whether the antenna suits the frequency (1:1 perfect, below 1.5 fine)"],
  ["dBm / watt", "tech", "due modi di dire la potenza: 0 dBm = 1 mW, 30 dBm = 1 W, 37 dBm = 5 W", "two ways to state power: 0 dBm = 1 mW, 30 dBm = 1 W, 37 dBm = 5 W"],
  ["UTC", "tech", "l'ora universale, quella che si scrive nel log: in Italia un'ora indietro (due con l'ora legale)", "universal time, the one written in the log"],
  ["log", "tech", "il quaderno di stazione: data, ora UTC, frequenza, nominativo, rapporti", "the station logbook: date, UTC time, frequency, callsign, reports"],
];
const CATS = [["", "tutto", "all"], ["q", "codice Q", "Q code"], ["abbr", "sigle e gergo", "abbreviations and jargon"], ["rep", "rapporti", "reports"], ["tech", "parole della radio", "radio words"]];
// a contact, step by step: [who, Italian line, English line, Italian note, English note]
const QSO_STEPS = [
  ["1", "«CQ CQ CQ da IU5VMO, India Uniform Five Victor Mike Oscar, chiama e ascolta.»", "“CQ CQ CQ from IU5VMO, India Uniform Five Victor Mike Oscar, calling and listening.”",
   "La chiamata. Prima ascolta che la frequenza sia libera. Su un ponte basta: «IU5VMO in ascolto».", "The call. Listen first. On a repeater it is enough to say: “IU5VMO listening”."],
  ["2", "«IU5VMO da IK5XXX, India Kilo Five X-ray X-ray X-ray, passo.»", "“IU5VMO from IK5XXX, India Kilo Five X-ray X-ray X-ray, over.”",
   "La risposta: prima il nominativo di chi è chiamato, poi il proprio.", "The answer: the called station's callsign first, then your own."],
  ["3", "«IK5XXX da IU5VMO, buonasera e grazie. Arrivi cinque nove. Il mio nome è Andrea, il QTH è San Piero a Sieve. Passo.»", "“IK5XXX from IU5VMO, good evening and thanks. You are five nine. My name is Andrea, my QTH is San Piero a Sieve. Over.”",
   "Il primo scambio: saluto, rapporto, nome, QTH.", "The first exchange: greeting, report, name, QTH."],
  ["4", "«…qui uso una veicolare con 5 watt e un'antenna magnetica. Com'è la mia modulazione? Passo.»", "“…I am using a mobile rig with 5 watts and a mag-mount antenna. How is my audio? Over.”",
   "Poi si parla: stazione, antenna, tempo, prove. Passaggi brevi, con una pausa fra l'uno e l'altro.", "Then you talk: station, antenna, weather, tests. Short transmissions, with a pause between them."],
  ["5", "«…grazie del collegamento, 73 e a risentirci. IK5XXX da IU5VMO, passo e chiudo.»", "“…thanks for the contact, 73 and hope to hear you again. IK5XXX from IU5VMO, clear.”",
   "La chiusura: saluti e i due nominativi. Poi si segna il collegamento nel log.", "The ending: regards and both callsigns. Then the contact goes in the log."],
  ["+", "«Break, IU5VMO.»", "“Break, IU5VMO.”",
   "Per inserirsi in un collegamento già in corso: nella pausa fra due passaggi, e si aspetta di essere invitati.", "To join a contact in progress: in the pause between two transmissions, then wait to be invited."],
];
function renderGuideExtra() {
  const en = lang === "en";
  $("qso-steps").innerHTML = QSO_STEPS.map(([n, it, e, nit, ne]) =>
    `<li><span class="n">${n}</span><div><div class="say">${en ? e : it}</div><div class="dim">${en ? ne : nit}</div></div></li>`).join("");
  const cats = $("gloss-cats");
  const current = cats.querySelector(".on")?.dataset.v || "";
  cats.innerHTML = CATS.map(([v, it, e]) => `<button data-v="${v}"${v === current ? ' class="on"' : ""}>${en ? e : it}</button>`).join("");
  cats.querySelectorAll("button").forEach((b) => b.onclick = () => { segSet("gloss-cats", b.dataset.v); filterGlossary(); });
  filterGlossary();
}
function filterGlossary() {
  const en = lang === "en", cat = $("gloss-cats").querySelector(".on")?.dataset.v || "";
  const words = $("gloss-q").value.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = GLOSSARY.filter(([term, c, it, e]) => (!cat || c === cat) &&
    words.every((w) => `${term} ${it} ${e}`.toLowerCase().includes(w)));
  $("gloss-list").innerHTML = hit.map(([term, c, it, e]) =>
    `<div class="gl c-${c}"><b>${term}</b><span>${en ? e : it}</span></div>`).join("") ||
    `<div class="dim">${T("Niente con queste parole.")}</div>`;
  $("gloss-n").textContent = `${hit.length} / ${GLOSSARY.length}`;
}
