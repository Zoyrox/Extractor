// Esportazione PNG e PDF di una materia, lato client.
// Il PNG è disegnato direttamente su <canvas> (niente html2canvas: layout
// pulito, nitido e senza dipendenze). Il PDF usa jsPDF con testo vettoriale,
// caricato da CDN solo quando serve.

import { h, icon, dialogo, toast, testoBreve, dataLunga, dataOra, oggiRoma, STATI } from './ui.js';
import { CONFIG } from './config.js';

const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js';

/** Prepara i dati da esportare: sessioni (future o tutte) con gli interrogati. */
function preparaDati(d, includiPassate) {
  const sessioni = d.sessioni
    .filter((s) => includiPassate || s.data >= d.oggi)
    .map((s) => ({
      data: s.data,
      titolo: capitalizza(dataLunga(s.data)),
      argomento: testoBreve(s.argomento),
      max: s.max_interrogati,
      passata: s.data < d.oggi,
      persone: [...s.interrogati, ...s.non_presenti].map((p) => ({
        nome: `${p.nome} ${p.cognome}`,
        etichetta: [p.stato !== 'assegnato' ? STATI[p.stato].testo : null, p.volontario ? 'volontario' : null].filter(Boolean).join(' · '),
        stato: p.stato,
      })),
    }));
  return {
    materia: d.materia.nome,
    classe: CONFIG.NOME_CLASSE,
    aggiornato: dataOra(d.generato_il || new Date()),
    sessioni,
    file: `interrogazioni-${d.materia.slug}-${oggiRoma()}`,
  };
}

const capitalizza = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------
//  PNG su canvas
// ---------------------------------------------------------------------

const COL = {
  bg: '#ffffff', card: '#f3f4f8', testo: '#15171c', testo2: '#4a5160', accento: '#4338ca',
  interrogato: '#166534', assente: '#b42318', rimandato: '#8a4b00', assegnato: '#3730a3',
};
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

/** Spezza il testo su più righe entro una larghezza massima. */
function aCapo(ctx, testo, larghezza) {
  const parole = String(testo).split(/\s+/);
  const righe = [];
  let riga = '';
  for (let p of parole) {
    // Parola più lunga della riga (es. un URL): spezzala a caratteri.
    while (ctx.measureText(p).width > larghezza && p.length > 1) {
      let i = p.length - 1;
      while (i > 1 && ctx.measureText(p.slice(0, i)).width > larghezza) i--;
      if (riga) { righe.push(riga); riga = ''; }
      righe.push(p.slice(0, i));
      p = p.slice(i);
    }
    const prova = riga ? `${riga} ${p}` : p;
    if (ctx.measureText(prova).width > larghezza && riga) { righe.push(riga); riga = p; } else riga = prova;
  }
  if (riga) righe.push(riga);
  return righe;
}

function disegnaPng(dati) {
  const W = 1080, PAD = 64, CARD_PAD = 36, INT = W - PAD * 2 - CARD_PAD * 2;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // Due passate: la prima misura l'altezza, la seconda disegna.
  const esegui = (disegna) => {
    let y = PAD;
    const testo = (t, x, size, peso, colore, allinea = 'left') => {
      ctx.font = `${peso} ${size}px ${FONT}`;
      if (disegna) { ctx.fillStyle = colore; ctx.textAlign = allinea; ctx.fillText(t, x, y); }
    };
    ctx.textBaseline = 'top';

    testo(`CLASSE ${dati.classe.toUpperCase()}`, PAD, 24, 700, COL.accento); y += 40;
    ctx.font = `800 56px ${FONT}`;
    for (const r of aCapo(ctx, `Interrogazioni di ${dati.materia}`, W - PAD * 2)) { testo(r, PAD, 56, 800, COL.testo); y += 66; }
    y += 6;
    testo(`Aggiornato al ${dati.aggiornato}`, PAD, 26, 400, COL.testo2); y += 64;

    if (!dati.sessioni.length) { testo('Nessuna interrogazione in programma.', PAD, 30, 400, COL.testo2); y += 50; }

    for (const s of dati.sessioni) {
      const inizio = y;
      // Misura il contenuto della card.
      ctx.font = `400 28px ${FONT}`;
      const righeArg = s.argomento ? aCapo(ctx, s.argomento, INT) : [];
      const altezza = CARD_PAD * 2 + 48 + righeArg.length * 38 + 12 + Math.max(1, s.persone.length) * 52;
      if (disegna) {
        ctx.fillStyle = COL.card;
        ctx.beginPath(); ctx.roundRect(PAD, inizio, W - PAD * 2, altezza, 28); ctx.fill();
        ctx.fillStyle = s.passata ? COL.testo2 : COL.accento;
        ctx.beginPath(); ctx.roundRect(PAD, inizio, 10, altezza, [28, 0, 0, 28]); ctx.fill();
      }
      y += CARD_PAD;
      const x = PAD + CARD_PAD;
      testo(s.titolo + (s.passata ? ' (passata)' : ''), x, 38, 750, COL.testo);
      testo(`${s.persone.length}/${s.max}`, W - PAD - CARD_PAD, 30, 600, COL.testo2, 'right');
      y += 48;
      for (const r of righeArg) { testo(r, x, 28, 400, COL.testo2); y += 38; }
      y += 12;
      if (!s.persone.length) { testo('Estrazione da fare', x, 30, 400, COL.testo2); y += 52; }
      for (const p of s.persone) {
        testo(p.nome, x, 32, 600, COL.testo);
        if (p.etichetta) testo(p.etichetta, W - PAD - CARD_PAD, 26, 700, COL[p.stato] || COL.testo2, 'right');
        y += 52;
      }
      y = inizio + altezza + 24;
    }
    y += 16;
    testo('Generato con l\'app Interrogazioni 5C', PAD, 22, 400, COL.testo2);
    return y + 22 + PAD;
  };

  canvas.width = W;
  canvas.height = esegui(false);
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  esegui(true);
  return canvas;
}

const comeBlob = (canvas) => new Promise((r) => canvas.toBlob(r, 'image/png'));

function scarica(blob, nome) {
  const a = h('a', { href: URL.createObjectURL(blob), download: nome });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------------------------------------------------------------------
//  PDF con jsPDF
// ---------------------------------------------------------------------

let jspdfPromessa = null;
function caricaJsPdf() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  jspdfPromessa ??= new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = JSPDF_URL;
    s.crossOrigin = 'anonymous';
    s.onload = () => (window.jspdf?.jsPDF ? ok(window.jspdf.jsPDF) : ko(new Error('jsPDF non disponibile')));
    s.onerror = () => { jspdfPromessa = null; ko(new Error('Impossibile caricare il generatore PDF: controlla la connessione.')); };
    document.head.append(s);
  });
  return jspdfPromessa;
}

/** I font standard del PDF coprono solo Latin-1: togliamo il resto. */
const latin1 = (s) => String(s).normalize('NFC').replace(/[^\x20-\xFF]/g, (c) => {
  const base = c.normalize('NFD')[0];
  return /[\x20-\xFF]/.test(base) ? base : '?';
});

async function creaPdf(dati) {
  const JsPDF = await caricaJsPdf();
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 16, FONDO = 297 - 16;
  let y = M;
  const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const testo = (t, x, size, stile, colore, opz = {}) => {
    doc.setFont('helvetica', stile); doc.setFontSize(size); doc.setTextColor(...hex(colore));
    doc.text(latin1(t), x, y, { baseline: 'top', ...opz });
  };

  testo(`CLASSE ${dati.classe.toUpperCase()}`, M, 9, 'bold', COL.accento); y += 6;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
  for (const r of doc.splitTextToSize(latin1(`Interrogazioni di ${dati.materia}`), W - M * 2)) { testo(r, M, 20, 'bold', COL.testo); y += 9; }
  testo(`Aggiornato al ${dati.aggiornato}`, M, 10, 'normal', COL.testo2); y += 10;

  if (!dati.sessioni.length) { testo('Nessuna interrogazione in programma.', M, 11, 'normal', COL.testo2); }

  for (const s of dati.sessioni) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    const righeArg = s.argomento ? doc.splitTextToSize(latin1(s.argomento), W - M * 2 - 12) : [];
    const altezza = 6 + 7 + righeArg.length * 5 + 2 + Math.max(1, s.persone.length) * 6.5 + 4;
    if (y + altezza > FONDO) { doc.addPage(); y = M; }
    doc.setFillColor(...hex(COL.card));
    doc.roundedRect(M, y, W - M * 2, altezza, 3, 3, 'F');
    doc.setFillColor(...hex(s.passata ? COL.testo2 : COL.accento));
    doc.rect(M, y, 1.5, altezza, 'F');
    const inizio = y;
    y += 6;
    testo(s.titolo + (s.passata ? ' (passata)' : ''), M + 6, 13, 'bold', COL.testo);
    testo(`${s.persone.length}/${s.max}`, W - M - 6, 11, 'normal', COL.testo2, { align: 'right' });
    y += 7;
    for (const r of righeArg) { testo(r, M + 6, 10, 'normal', COL.testo2); y += 5; }
    y += 2;
    if (!s.persone.length) { testo('Estrazione da fare', M + 6, 11, 'normal', COL.testo2); y += 6.5; }
    for (const p of s.persone) {
      testo(p.nome, M + 6, 11, 'bold', COL.testo);
      if (p.etichetta) testo(p.etichetta, W - M - 6, 9.5, 'bold', COL[p.stato] || COL.testo2, { align: 'right' });
      y += 6.5;
    }
    y = inizio + altezza + 4;
  }
  return doc.output('blob');
}

// ---------------------------------------------------------------------
//  Dialogo di esportazione
// ---------------------------------------------------------------------

export function apriEsportazione(d) {
  return dialogo(`Esporta · ${d.materia.nome}`, (chiudi) => {
    const passate = h('input', { type: 'checkbox' });
    const azione = (testo, ic, fn) => h('button', {
      class: 'btn', type: 'button',
      onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true;
        try { await fn(preparaDati(d, passate.checked)); chiudi(true); }
        catch (err) { if (err?.name !== 'AbortError') toast(err.message || 'Esportazione non riuscita', 'errore'); }
        finally { b.disabled = false; }
      },
    }, icon(ic, 18), testo);

    const puoCondividere = !!navigator.canShare && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] });
    return h('div', {},
      h('p', { class: 'muted' }, 'Un riepilogo pulito delle sessioni con gli interrogati, da mandare nel gruppo della classe.'),
      h('label', { class: 'check' }, passate, 'Includi anche le sessioni passate'),
      h('div', { class: 'scelte' },
        azione('Immagine PNG', 'immagine', async (x) => scarica(await comeBlob(disegnaPng(x)), `${x.file}.png`)),
        azione('Documento PDF', 'pdf', async (x) => scarica(await creaPdf(x), `${x.file}.pdf`)),
        puoCondividere
          ? azione('Condividi immagine', 'condividi', async (x) => {
              const blob = await comeBlob(disegnaPng(x));
              await navigator.share({ files: [new File([blob], `${x.file}.png`, { type: 'image/png' })], title: `Interrogazioni di ${x.materia}` });
            })
          : null));
  });
}
