// =====================================================================
//  CONFIGURAZIONE · DA COMPILARE
//  Inserisci qui l'URL del progetto Supabase e la chiave PUBBLICA
//  (anon key / publishable key). Le trovi in Supabase → Project Settings
//  → API. NON inserire mai la service_role key o la secret key.
// =====================================================================

export const CONFIG = {
  SUPABASE_URL: 'https://urtdlosuxwydhnkmzczk.supabase.co',
  SUPABASE_ANON_KEY: 'INSERISCI-LA-TUA-ANON-KEY',

  // Nome del canale Realtime: deve coincidere con quello usato nel
  // trigger SQL private.ping_realtime().
  CANALE_REALTIME: 'classe-5c',

  NOME_CLASSE: '5C Informatica',
  FUSO_ORARIO: 'Europe/Rome',
};

/** true se l'URL e la chiave sono ancora quelli segnaposto. */
export const configMancante =
  CONFIG.SUPABASE_URL.includes('INSERISCI') || CONFIG.SUPABASE_ANON_KEY.includes('INSERISCI');
