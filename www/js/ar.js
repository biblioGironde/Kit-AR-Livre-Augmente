// Lecture en réalité augmentée : reconnaissance des illustrations (MindAR) + vidéos plaquées + sons
import * as THREE from 'three';
import { MindARThree } from '../vendor/mindar/mindar-image-three.prod.js';
import { urlDe } from './outils.js';

const VERTEX = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Incrustation : distance en chrominance (Cb/Cr) à la couleur de fond, avec bord adouci et anti-débordement
const FRAGMENT = `
uniform sampler2D map;
uniform vec3 cle;
uniform float tolerance;
uniform float douceur;
uniform float opacite;
uniform bool chroma;
varying vec2 vUv;
vec2 cbcr(vec3 c) {
  return vec2(-0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b, 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b);
}
void main() {
  vec4 c = texture2D(map, vUv);
  float a = 1.0;
  if (chroma) {
    float d = distance(cbcr(c.rgb), cbcr(cle));
    a = smoothstep(tolerance * 0.5, tolerance * 0.5 + douceur, d);
    // réduit le liseré vert sur les bords
    if (a < 1.0) { float m = (c.r + c.b) * 0.5; c.g = min(c.g, m + (c.g - m) * a); }
  }
  gl_FragColor = vec4(c.rgb, a * opacite);
}`;

function hexVersVec3(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

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
  }

  async preparer() {
    const { livre } = this;
    this.urlCibles = URL.createObjectURL(livre.cible.blob);
    this.mindar = new MindARThree({
      container: this.conteneur,
      imageTargetSrc: this.urlCibles,
      maxTrack: 1,
      uiLoading: 'no', uiScanning: 'no', uiError: 'no',
      filterMinCF: 0.0001, filterBeta: 0.001, // stabilise l'image (moins de tremblements)
      warmupTolerance: 3, missTolerance: 8,
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
        this.elements.push(v);

        const tex = new THREE.VideoTexture(v);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        this.textures.push(tex);
        const mat = new THREE.ShaderMaterial({
          uniforms: {
            map: { value: tex },
            cle: { value: hexVersVec3(o.chromaCouleur || '#00ff00') },
            tolerance: { value: o.chromaTol ?? 0.25 },
            douceur: { value: 0.08 },
            opacite: { value: o.opacite ?? 1 },
            chroma: { value: !!o.chroma },
          },
          vertexShader: VERTEX, fragmentShader: FRAGMENT,
          transparent: true, depthWrite: false, side: THREE.DoubleSide,
        });
        const ratioVideo = media.largeur ? media.hauteur / media.largeur : 9 / 16;
        // largeur 1 = largeur de l'illustration ; la vidéo est contenue dans l'illustration puis mise à l'échelle
        let l = 1, h = ratioVideo;
        if (h > ratioCible) { h = ratioCible; l = ratioCible / ratioVideo; }
        const plan = new THREE.Mesh(new THREE.PlaneGeometry(l * o.taille, h * o.taille), mat);
        plan.position.set(0, (o.decalage || 0) * ratioCible, 0.01);
        ancre.group.add(plan);

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
    for (const el of this.elements) { el.removeAttribute('src'); el.load(); }
    this.elements = [];
    if (this.urlCibles) URL.revokeObjectURL(this.urlCibles);
    this.conteneur.innerHTML = '';
  }
}
