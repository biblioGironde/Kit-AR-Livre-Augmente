// Analyse des illustrations (cibles MindAR) : faite une fois, conservée avec le livre
import { chargerImage } from './outils.js';
import { signatureCibles } from './etat.js';

let compilateur = null;
async function chargerCompilateur() {
  if (!compilateur) compilateur = (await import('../vendor/mindar/mindar-image.prod.js')).Compiler;
  return compilateur;
}

/**
 * Analyse toutes les pages illustrées du livre.
 * Renvoie { blob, signature, ordre:[pageId] } — l'index de cible MindAR = position dans `ordre`.
 */
export async function analyserCibles(livre, surProgression = () => {}) {
  const pages = livre.pages.filter((p) => p.image);
  if (!pages.length) throw new Error('Aucune illustration à analyser');
  const Compiler = await chargerCompilateur();
  const images = await Promise.all(pages.map((p) => chargerImage(p.image)));
  const c = new Compiler();
  await c.compileImageTargets(images, (p) => surProgression(Math.min(100, p)));
  const donnees = await c.exportData();
  return {
    blob: new Blob([donnees], { type: 'application/octet-stream' }),
    signature: signatureCibles(livre),
    ordre: pages.map((p) => p.id),
  };
}
