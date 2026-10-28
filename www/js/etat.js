// État partagé de l'application : livres + médias, avec notifications de changement
import { db, uid } from './db.js';
import { dureeMedia, dimensionsVideo } from './outils.js';

export const bus = new EventTarget();
export const emettre = (nom) => bus.dispatchEvent(new Event(nom));

export const etat = {
  livres: [],
  medias: new Map(),
};

export async function chargerTout() {
  const [livres, medias] = await Promise.all([db.tous('livres'), db.tous('medias')]);
  etat.livres = livres.sort((a, b) => (b.maj || 0) - (a.maj || 0));
  etat.medias = new Map(medias.map((m) => [m.id, m]));
}

// ---------- médias ----------
export async function ajouterMedia({ blob, type, nom, origine = 'import' }) {
  const media = { id: uid(), type, nom: nom || 'Sans titre', blob, mime: blob.type, origine, cree: Date.now() };
  if (type === 'video') Object.assign(media, await dimensionsVideo(blob));
  else media.duree = await dureeMedia(blob, 'audio');
  await db.ecrire('medias', media);
  etat.medias.set(media.id, media);
  emettre('medias');
  return media;
}

export async function majMedia(media) {
  await db.ecrire('medias', media);
  etat.medias.set(media.id, media);
  emettre('medias');
}

export async function supprimerMedia(id) {
  await db.effacer('medias', id);
  etat.medias.delete(id);
  emettre('medias');
}

export const mediasDeType = (type) =>
  [...etat.medias.values()].filter((m) => m.type === type).sort((a, b) => (b.cree || 0) - (a.cree || 0));

export function utilisationsMedia(id) {
  const out = [];
  for (const l of etat.livres) for (const p of l.pages) if (p.action?.mediaId === id) out.push({ livre: l, page: p });
  return out;
}

// ---------- livres ----------
export function nouveauLivre(titre = 'Nouveau livre') {
  return { id: uid(), titre, pages: [], cible: null, cree: Date.now(), maj: Date.now() };
}

export async function enregistrerLivre(livre) {
  livre.maj = Date.now();
  await db.ecrire('livres', livre);
  const i = etat.livres.findIndex((l) => l.id === livre.id);
  if (i >= 0) etat.livres[i] = livre; else etat.livres.unshift(livre);
  etat.livres.sort((a, b) => (b.maj || 0) - (a.maj || 0));
  emettre('livres');
}

export async function supprimerLivre(id) {
  await db.effacer('livres', id);
  etat.livres = etat.livres.filter((l) => l.id !== id);
  emettre('livres');
}

export const livreParId = (id) => etat.livres.find((l) => l.id === id);

export const OPTIONS_DEFAUT = {
  video: { taille: 1, decalage: 0, decalageX: 0, opacite: 1, boucle: true, son: true, debut: false, chroma: false, chromaCouleur: '#00ff00', chromaTol: 0.25 },
  son: { volume: 1, boucle: false, arret: true, debut: true },
};

export function nouvellePage(n) {
  return {
    id: uid(), titre: `Page ${n}`, image: null, largeur: 0, hauteur: 0, imageVersion: null,
    action: { type: 'aucune', mediaId: null, video: { ...OPTIONS_DEFAUT.video }, son: { ...OPTIONS_DEFAUT.son } },
  };
}

// Signature de l'ensemble des illustrations : si elle change, il faut ré-analyser les cibles
export function signatureCibles(livre) {
  return livre.pages.filter((p) => p.image).map((p) => `${p.id}:${p.imageVersion}`).join('|');
}
export const ciblesAJour = (livre) => !!livre.cible && livre.cible.signature === signatureCibles(livre);
