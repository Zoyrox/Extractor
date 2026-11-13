// Orario della classe: giorni suggeriti per una materia, prof, colori.

import { oggiRoma } from './ui.js';

export const GIORNI = ['', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
export const GIORNI_BREVI = ['', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

/** Palette dei colori delle materie: tutti con contrasto AA sul bianco. */
export const PALETTE = ['#4f46e5', '#0e7490', '#b45309', '#be123c', '#15803d', '#7c3aed', '#c2410c', '#1d4ed8', '#a21caf', '#475569'];

/** Colore di una materia: quello scelto, oppure uno della palette in base all'id. */
export function coloreMateria(m) {
  if (m?.colore) return m.colore;
  const id = Number(m?.id) || 0;
  return PALETTE[id % PALETTE.length];
}

/** "3ª ora · 10:00–10:55" (o stringa vuota se l'ora non c'è). */
export function descriviOra(x) {
  if (!x?.ora) return '';
  return `${x.ora}ª ora${x.inizio ? ` · ${x.inizio}–${x.fine}` : ''}`;
}

/** Ora + prof in una riga: "3ª ora · 10:00–10:55 · Prof.ssa Rossi". */
export function descriviOraProf(x) {
  return [descriviOra(x), x?.prof].filter(Boolean).join(' · ');
}

/** Giorno della settimana (1 = lunedì ... 7 = domenica) di una data 'YYYY-MM-DD'. */
export function giornoSettimana(iso) {
  const g = new Date(iso + 'T12:00:00Z').getUTCDay();
  return g === 0 ? 7 : g;
}

function aggiungiGiorni(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Prof ordinati: prima quelli che insegnano la materia. */
export function profPerMateria(orario, subjectId) {
  const insegna = (p) => p.materie.includes(subjectId);
  return [...orario.prof].sort((a, b) => (insegna(b) - insegna(a)) || a.nome.localeCompare(b.nome, 'it'));
}

/**
 * Giorni utili per interrogare in una materia nelle prossime `settimane`:
 *  - le ore in cui c'è proprio quella materia;
 *  - le ore di un'altra materia tenute da un prof che insegna ANCHE questa
 *    (es. ora di Italiano con la prof che fa anche Storia).
 * `occupate`: Set di "data|ora" già usate da sessioni di questa materia.
 */
export function giorniSuggeriti(orario, subjectId, { settimane = 6, occupate = new Set() } = {}) {
  const prof = new Map(orario.prof.map((p) => [p.id, p]));
  const materie = new Map(orario.materie.map((m) => [m.id, m]));
  const ore = new Map(orario.ore.map((o) => [o.ora, o]));
  const utili = orario.slot
    .map((s) => {
      const p = prof.get(s.teacher_id);
      const stessa = s.subject_id === subjectId;
      const tramiteProf = !stessa && p?.materie.includes(subjectId);
      if (!stessa && !tramiteProf) return null;
      return { ...s, prof: p?.nome || '', materiaOra: materie.get(s.subject_id)?.nome || '', tramiteProf, ...(ore.get(s.ora) || {}) };
    })
    .filter(Boolean);
  if (!utili.length) return [];

  const out = [];
  const oggi = oggiRoma();
  for (let i = 1; i <= settimane * 7; i++) {
    const data = aggiungiGiorni(oggi, i);
    const g = giornoSettimana(data);
    for (const s of utili.filter((x) => x.giorno === g).sort((a, b) => a.ora - b.ora)) {
      out.push({ data, ...s, occupata: occupate.has(`${data}|${s.ora}`) || occupate.has(`${data}|`) });
    }
  }
  return out;
}
