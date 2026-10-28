// Lecture en réalité augmentée : reconnaissance des illustrations (MindAR) + vidéos plaquées + sons
import { MindARThree } from '../vendor/mindar/mindar-image-three.prod.js';
import { urlDe, attacherVideo } from './outils.js';
import { creerPlanVideo } from './plan-video.js';

// Filtre de lissage du suivi (One Euro) : minCF = lissage au repos, beta = réactivité quand la page bouge.
// Valeurs MindAR par défaut : minCF 0.001, beta 1000.
export const MODES_SUIVI = {
  reactif: { filterMinCF: 0.005, filterBeta: 5000, warmupTolerance: 2, missTolerance: 4 },
  equilibre: { filterMinCF: 0.001, filterBeta: 1000, warmupTolerance: 3, missTolerance: 5 },
  stable: { filterMinCF: 0.0003, filterBeta: 200, warmupTolerance: 5, missTolerance: 8 },
};

export class LecteurAR {
  /**
   * @param {HTMLElement} conteneur
   * @param {object} livre
   * @param {Map} medias
   * @param {{surDetection:(page)=>void, surPerte:(page)=>void}} rappels
   */
  constructor(conteneur, livre, medias, rappels = {}) {
    this.conteneur = conteneur;
    this.livre = livre;
    this.medias = medias;
    this.rappels = rappels;
    this.elements = []; // <video>/<audio> créés, pour les débloquer / arrêter
    this.textures = [];
    this.visibles = new Set();
    this.cameraId = null;
    this.modeSuivi = 'equilibre';
  }

  async preparer() {
    const { livre } = this;
    this.urlCibles = URL.createObjectURL(livre.cible.blob);
    this.mindar = new MindARThree({
      container: this.conteneur,
      imageTargetSrc: this.urlCibles,
      maxTrack: 1,
      uiLoading: 'no', uiScanning: 'no', uiError: 'no',
      ...(MODES_SUIVI[this.modeSuivi] || MODES_SUIVI.equilibre),
      environmentDeviceId: this.cameraId,
    });

    livre.cible.ordre.forEach((pageId, index) => {
      const page = livre.pages.find((p) => p.id === pageId);
      const ancre = this.mindar.addAnchor(index);
      if (!page) return;
      const action = page.action || {};
      const media = action.mediaId ? this.medias.get(action.mediaId) : null;
      const ratioCible = page.hauteur && page.largeur ? page.hauteur / page.largeur : 1;
      let surTrouve = () => {}, surPerdu = () => {};

      if (action.type === 'video' && media) {
        const o = action.video;
        const v = document.createElement('video');
        v.src = urlDe(media.blob);
        v.loop = !!o.boucle;
        v.muted = !o.son;
        v.playsInline = true;
        v.setAttribute('playsinline', '');
        v.setAttribute('webkit-playsinline', '');
        v.preload = 'auto';
        if (v.muted) v.setAttribute('muted', '');
        attacherVideo(v);
        this.elements.push(v);

        const plan = creerPlanVideo(v, media, ratioCible);
        plan.maj(o);
        this.textures.push(plan);
        ancre.group.add(plan.mesh);

        surTrouve = () => {
          if (o.debut || v.ended) v.currentTime = 0;
          v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
        };
        surPerdu = () => v.pause();
      } else if (action.type === 'son' && media) {
        const o = action.son;
        const a = new Audio(urlDe(media.blob));
        a.loop = !!o.boucle;
        a.volume = o.volume ?? 1;
        a.preload = 'auto';
        this.elements.push(a);
        surTrouve = () => {
          if (!a.paused) return; // son qui continue hors champ : on le laisse finir
          if (o.debut || a.ended) a.currentTime = 0;
          a.play().catch(() => {});
        };
        surPerdu = () => { if (o.arret) a.pause(); };
      }

      ancre.onTargetFound = () => {
        this.visibles.add(page.id);
        surTrouve();
        this.rappels.surDetection?.(page);
      };
      ancre.onTargetLost = () => {
        this.visibles.delete(page.id);
        surPerdu();
        this.rappels.surPerte?.(page);
      };
    });
  }

  /** À appeler dans un geste utilisateur (clic) : débloque la lecture audio/vidéo sur mobile */
  async debloquer() {
    await Promise.all(this.elements.map(async (el) => {
      const muet = el.muted;
      try { el.muted = true; await el.play(); el.pause(); el.currentTime = 0; } catch { /* ignoré */ }
      el.muted = muet;
    }));
  }

  async demarrer() {
    try {
      await this.mindar.start();
    } catch (e) {
      throw new Error("La caméra n'a pas pu démarrer. Vérifiez l'autorisation d'accès à la caméra.");
    }
    if (!this.mindar.controller) throw new Error("La caméra n'a pas pu démarrer. Vérifiez l'autorisation d'accès à la caméra.");
    const { renderer, scene, camera } = this.mindar;
    renderer.setAnimationLoop(() => renderer.render(scene, camera));
  }

  /** Change le compromis réactivité / stabilité en cours de lecture, sans redémarrer la caméra */
  definirModeSuivi(mode) {
    const m = MODES_SUIVI[mode];
    if (!m) return;
    this.modeSuivi = mode;
    if (this.mindar) Object.assign(this.mindar, m); // conservé si la caméra redémarre
    const c = this.mindar?.controller;
    if (!c) return;
    c.filterMinCF = m.filterMinCF; c.filterBeta = m.filterBeta;
    c.warmupTolerance = m.warmupTolerance; c.missTolerance = m.missTolerance;
    for (const t of c.trackingStates || []) {
      if (t.filter) { t.filter.minCutOff = m.filterMinCF; t.filter.beta = m.filterBeta; }
    }
  }

  async changerCamera(deviceId) {
    this.cameraId = deviceId;
    this.mindar.environmentDeviceId = deviceId;
    this.mindar.shouldFaceUser = false;
    this.toutArreter();
    try { this.mindar.stop(); } catch {}
    await this.demarrer();
  }

  toutArreter() {
    for (const el of this.elements) el.pause();
    this.visibles.clear();
  }

  detruire() {
    this.toutArreter();
    try { this.mindar.renderer.setAnimationLoop(null); } catch {}
    try { this.mindar.stop(); } catch {}
    for (const t of this.textures) t.dispose();
    try { this.mindar.renderer.dispose(); } catch {}
    for (const el of this.elements) { el.removeAttribute('src'); el.load(); if (el.tagName === 'VIDEO') el.remove(); }
    this.elements = [];
    if (this.urlCibles) URL.revokeObjectURL(this.urlCibles);
    this.conteneur.innerHTML = '';
  }
}
