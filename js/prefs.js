// Preferenze salvate nel browser. SOLO preferenze: tema, codice di classe
// e piccole scelte d'interfaccia. Nessun dato della classe in localStorage.

const PREFISSO = 'estrazioni5c:';

function leggi(chiave) {
  try { return localStorage.getItem(PREFISSO + chiave); } catch { return null; }
}
function scrivi(chiave, valore) {
  try {
    if (valore === null || valore === undefined) localStorage.removeItem(PREFISSO + chiave);
    else localStorage.setItem(PREFISSO + chiave, valore);
  } catch { /* storage non disponibile (es. navigazione privata) */ }
}

export const prefs = {
  get tema() { return leggi('tema'); },          // 'chiaro' | 'scuro' | null (= sistema)
  set tema(v) { scrivi('tema', v); },
  get codice() { return leggi('codice'); },
  set codice(v) { scrivi('codice', v); },
  get mioNome() { return leggi('mio-nome'); },   // ultima ricerca "cerca il mio nome"
  set mioNome(v) { scrivi('mio-nome', v); },
  get velocitaEstrazione() { return leggi('velocita') || 'normale'; },  // veloce | normale | teatrale
  set velocitaEstrazione(v) { scrivi('velocita', v); },
  get suoni() { return leggi('suoni') !== '0'; },
  set suoni(v) { scrivi('suoni', v ? '1' : '0'); },
  get schermoIntero() { return leggi('schermo-intero') !== '0'; },
  set schermoIntero(v) { scrivi('schermo-intero', v ? '1' : '0'); },
  get iosAvvisoChiuso() { return leggi('ios-avviso') === '1'; },
  set iosAvvisoChiuso(v) { scrivi('ios-avviso', v ? '1' : null); },
};
