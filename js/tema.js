// Tema chiaro/scuro: preferenza salvata (sistema | chiaro | scuro),
// colore della barra di stato del telefono e cambio con un cerchio che si
// allarga dal pulsante premuto (View Transitions, se disponibili).

import { prefs } from './prefs.js';
import { icon } from './ui.js';

const scuroSistema = matchMedia('(prefers-color-scheme: dark)');
const ETICHETTE = { chiaro: 'Tema chiaro', scuro: 'Tema scuro' };

/** true se in questo momento il tema effettivo è scuro. */
export function temaScuro() {
  const t = prefs.tema;
  return t === 'scuro' || (t !== 'chiaro' && scuroSistema.matches);
}

/** Applica la preferenza salvata a <html>, al pulsante e alla barra di stato. */
export function applicaTema() {
  const t = prefs.tema;
  const root = document.documentElement;
  if (t === 'chiaro') root.dataset.theme = 'light';
  else if (t === 'scuro') root.dataset.theme = 'dark';
  else delete root.dataset.theme;

  // Barra di stato / barra del browser: segue lo sfondo della pagina.
  const meta = document.getElementById('meta-tema');
  if (meta) meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim() || (temaScuro() ? '#0e0c1b' : '#f3f2f9'));

  const btn = document.getElementById('btn-tema');
  if (btn) {
    const testo = ETICHETTE[t] || 'Tema automatico (come il sistema)';
    btn.replaceChildren(icon(t === 'chiaro' ? 'sole' : t === 'scuro' ? 'luna' : 'auto'));
    btn.setAttribute('aria-label', `${testo}. Cambia tema`);
    btn.title = testo;
  }
  document.dispatchEvent(new CustomEvent('tema-cambiato'));
}

/**
 * Imposta il tema ('chiaro' | 'scuro' | null = sistema). Se `origine` è un
 * elemento, il nuovo tema si apre a cerchio partendo dal suo centro.
 */
export function impostaTema(t, origine = null) {
  const prima = temaScuro();
  prefs.tema = t;   // subito: un secondo tocco rapido parte dal valore giusto
  const cambia = () => applicaTema();
  const fermo = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Se il colore effettivo non cambia (es. "sistema" → "scuro" già scuro) niente effetto.
  const cambiaColore = (t === 'scuro' || (t !== 'chiaro' && scuroSistema.matches)) !== prima;
  if (!document.startViewTransition || fermo || !cambiaColore) { cambia(); return; }

  const r = origine?.getBoundingClientRect?.();
  const x = r ? r.left + r.width / 2 : innerWidth / 2;
  const y = r ? r.top + r.height / 2 : 0;
  const raggio = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  document.documentElement.classList.add('cambio-tema');
  const vt = document.startViewTransition(cambia);
  vt.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${raggio}px at ${x}px ${y}px)`] },
      { duration: 600, easing: 'cubic-bezier(.2,.8,.2,1)', pseudoElement: '::view-transition-new(root)' });
  }).catch(() => {});
  vt.finished.finally(() => document.documentElement.classList.remove('cambio-tema'));
}

/** Pulsante in alto: sistema → chiaro → scuro → sistema. */
export function ciclaTema(origine) {
  const ordine = [null, 'chiaro', 'scuro'];
  impostaTema(ordine[(ordine.indexOf(prefs.tema) + 1) % ordine.length], origine);
}

// Se il tema è "come il sistema" e il sistema cambia, aggiorna la barra di stato.
scuroSistema.addEventListener?.('change', () => { if (!prefs.tema) applicaTema(); });
