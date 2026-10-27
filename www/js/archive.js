// Export / import d'un livre complet en .zip (illustrations, médias, cibles analysées)
import { etat, enregistrerLivre, livreParId } from './etat.js';
import { db } from './db.js';

const FORMAT = 'kit-livre-augmente';
const VERSION = 1;

const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/ogg': 'ogv',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg',
  'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/flac': 'flac',
};
const extension = (mime, defaut) => EXT[(mime || '').split(';')[0]] || defaut;

export async function exporterLivre(livre, surProgression = () => {}) {
  const zip = new window.JSZip();
  const pages = livre.pages.map((p) => {
    const { image, ...reste } = p;
    const out = { ...reste };
    if (image) {
      out.image = `illustrations/${p.id}.${extension(image.type, 'jpg')}`;
      zip.file(out.image, image, { compression: 'STORE' });
    } else out.image = null;
    return out;
  });
  const ids = new Set(livre.pages.map((p) => p.action?.mediaId).filter(Boolean));
  const medias = [];
  for (const id of ids) {
    const m = etat.medias.get(id);
    if (!m) continue;
    const { blob, ...reste } = m;
    const fichier = `medias/${m.id}.${extension(m.mime, m.type === 'video' ? 'mp4' : 'webm')}`;
    zip.file(fichier, blob, { compression: 'STORE' });
    medias.push({ ...reste, fichier });
  }
  let cible = null;
  if (livre.cible?.blob) {
    zip.file('cibles.mind', livre.cible.blob, { compression: 'STORE' });
    cible = { signature: livre.cible.signature, ordre: livre.cible.ordre, fichier: 'cibles.mind' };
  }
  const { pages: _p, cible: _c, ...infos } = livre;
  zip.file('livre.json', JSON.stringify({ format: FORMAT, version: VERSION, exporte: new Date().toISOString(), livre: { ...infos, pages, cible }, medias }, null, 2));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }, (m) => surProgression(m.percent));
}

/** Importe un .zip (Blob/File). Renvoie le livre importé. Un livre de même identifiant est remplacé. */
export async function importerLivre(fichier, surProgression = () => {}) {
  let zip;
  try { zip = await window.JSZip.loadAsync(fichier); } catch { throw new Error("Ce fichier n'est pas une archive .zip valide."); }
  const j = zip.file('livre.json');
  if (!j) throw new Error("Ce .zip n'est pas un livre du Kit Livre Augmenté (livre.json absent).");
  const donnees = JSON.parse(await j.async('string'));
  if (donnees.format !== FORMAT) throw new Error('Format de livre inconnu.');
  if (donnees.version > VERSION) throw new Error("Ce livre a été créé avec une version plus récente de l'appli. Mettez-la à jour.");

  const lireBlob = async (chemin, type) => {
    const f = zip.file(chemin);
    if (!f) return null;
    const b = await f.async('blob');
    return new Blob([b], { type: type || '' });
  };

  const total = donnees.medias.length + donnees.livre.pages.length + 1;
  let fait = 0;
  const avance = () => surProgression(Math.round((++fait / total) * 100));

  for (const m of donnees.medias) {
    if (!etat.medias.has(m.id)) {
      const blob = await lireBlob(m.fichier, m.mime);
      if (blob) {
        const { fichier: _f, ...reste } = m;
        const media = { ...reste, blob };
        await db.ecrire('medias', media);
        etat.medias.set(media.id, media);
      }
    }
    avance();
  }

  const livre = { ...donnees.livre };
  livre.pages = [];
  for (const p of donnees.livre.pages) {
    const img = p.image ? await lireBlob(p.image, p.image.endsWith('.png') ? 'image/png' : 'image/jpeg') : null;
    livre.pages.push({ ...p, image: img });
    avance();
  }
  if (donnees.livre.cible?.fichier) {
    const blob = await lireBlob(donnees.livre.cible.fichier, 'application/octet-stream');
    livre.cible = blob ? { signature: donnees.livre.cible.signature, ordre: donnees.livre.cible.ordre, blob } : null;
  } else livre.cible = null;
  avance();

  const existe = !!livreParId(livre.id);
  await enregistrerLivre(livre);
  return { livre, remplace: existe };
}
