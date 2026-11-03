// Stockage local (IndexedDB) : livres et médias (vidéos, sons) restent dans l'appareil.
const NOM_BASE = 'kit-livre-augmente';
const VERSION = 1;
let ouverture = null;

function ouvrir() {
  if (!ouverture) {
    ouverture = new Promise((ok, ko) => {
      const r = indexedDB.open(NOM_BASE, VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('livres')) d.createObjectStore('livres', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('medias')) d.createObjectStore('medias', { keyPath: 'id' });
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    });
  }
  return ouverture;
}

async function transaction(magasin, mode, fn) {
  const d = await ouvrir();
  return new Promise((ok, ko) => {
    const t = d.transaction(magasin, mode);
    let resultat;
    const req = fn(t.objectStore(magasin));
    if (req) req.onsuccess = () => { resultat = req.result; };
    t.oncomplete = () => ok(resultat);
    t.onerror = () => ko(t.error);
    t.onabort = () => ko(t.error || new Error('Transaction annulée'));
  });
}

export const db = {
  tous: (m) => transaction(m, 'readonly', (s) => s.getAll()),
  lire: (m, id) => transaction(m, 'readonly', (s) => s.get(id)),
  ecrire: (m, v) => transaction(m, 'readwrite', (s) => s.put(v)),
  effacer: (m, id) => transaction(m, 'readwrite', (s) => s.delete(id)),
};

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// Demande au navigateur de ne pas purger le stockage (utile sur tablette)
export async function stockagePersistant() {
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch { /* sans importance */ }
}
