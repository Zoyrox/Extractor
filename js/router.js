// Router basato sull'hash (#/materia/storia): funziona su GitHub Pages
// anche con link diretti, senza configurazione del server.

const rotte = [];
let gestoreCorrente = null;   // oggetto restituito dalla vista attiva
let onCambio = () => {};

/** Registra una rotta: pattern tipo '/materia/:slug'. */
export function rotta(pattern, handler) {
  const chiavi = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { chiavi.push(k); return '([^/]+)'; }) + '/?$');
  rotte.push({ re, chiavi, handler });
}

/** Legge il percorso e i parametri di query dall'hash corrente. */
export function percorsoCorrente() {
  const hash = location.hash || '#/';
  // Hash non di routing (es. token di Supabase Auth): non li gestiamo qui.
  if (!hash.startsWith('#/')) return { path: '/', query: new URLSearchParams() };
  const [path, qs = ''] = hash.slice(1).split('?');
  return { path: path || '/', query: new URLSearchParams(qs) };
}

export function vai(path) {
  if (location.hash === '#' + path) risolvi();
  else location.hash = path;
}

/** Aggiorna la query string dell'hash senza ricaricare la vista. */
export function sostituisciQuery(params) {
  const { path } = percorsoCorrente();
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  history.replaceState(null, '', '#' + path + (qs ? '?' + qs : ''));
}

export function vistaCorrente() { return gestoreCorrente; }

export async function risolvi() {
  const { path, query } = percorsoCorrente();
  gestoreCorrente?.distruggi?.();
  gestoreCorrente = null;
  for (const r of rotte) {
    const m = path.match(r.re);
    if (m) {
      const params = Object.fromEntries(r.chiavi.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      onCambio(path);
      gestoreCorrente = (await r.handler(params, query)) || null;
      return;
    }
  }
  location.replace('#/');
}

export function avviaRouter(callbackCambio) {
  onCambio = callbackCambio || onCambio;
  window.addEventListener('hashchange', risolvi);
  return risolvi();
}
