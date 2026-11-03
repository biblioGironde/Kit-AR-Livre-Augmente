// Aperçu en direct dans l'éditeur de page : illustration + vidéo posée dessus,
// rendu avec le même plan vidéo (et le même shader de transparence) que la lecture AR.
// Interactions : glisser = déplacer, molette / pincer = agrandir, double-clic = recentrer.
import * as THREE from 'three';
import { creerPlanVideo } from './plan-video.js';
import { urlDe, attacherVideo } from './outils.js';

const MARGE = 1.35; // l'illustration occupe ~75 % de la vue : on voit ce qui déborde

export class ApercuPage {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {(changements:object)=>void} surChangement  appelé quand l'utilisateur déplace / redimensionne
   */
  constructor(canvas, surChangement) {
    this.canvas = canvas;
    this.surChangement = surChangement;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
    this.ratio = 1;
    this.opts = null;
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.loop = true;
    this.video.playsInline = true;
    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('muted', '');
    attacherVideo(this.video);

    // Illustration
    this.matPage = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.page = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.matPage);
    this.scene.add(this.page);
    // Calque : l'illustration redessinée PAR-DESSUS la vidéo, en transparence, pour caler la vidéo
    // (aperçu uniquement, n'apparaît pas pendant la lecture AR)
    this.matCalque = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
    this.calque = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.matCalque);
    this.calque.renderOrder = 5;
    this.calque.position.z = 0.02;
    this.scene.add(this.calque);
    this.opaciteCalque = 0;      // réglée par l'utilisateur
    this.calqueManipulation = false; // forcé pendant un déplacement
    // Contour de l'illustration : 4 bandes dont l'épaisseur reste ~2 px à l'écran
    this.matCadre = new THREE.MeshBasicMaterial({ color: 0xe0703a, transparent: true, opacity: 0.95, depthTest: false });
    this.bords = [0, 1, 2, 3].map(() => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.matCadre); m.renderOrder = 10; this.scene.add(m); return m; });

    this.plan = null;
    this.actif = false;
    this.brancherInteractions();
    this.observateur = new ResizeObserver(() => this.redimensionner());
    this.observateur.observe(canvas);
  }

  /** Définit l'illustration (Blob) et ses dimensions */
  async definirPage(blob, largeur, hauteur) {
    this.ratio = largeur && hauteur ? hauteur / largeur : 1;
    this.page.scale.set(1, this.ratio, 1);
    this.calque.scale.set(1, this.ratio, 1);
    if (this.texPage) this.texPage.dispose();
    if (blob) {
      const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = urlDe(blob); });
      this.texPage = new THREE.Texture(img);
      this.texPage.colorSpace = THREE.SRGBColorSpace;
      this.texPage.needsUpdate = true;
      this.matPage.map = this.texPage;
      this.matCalque.map = this.texPage;
    } else {
      this.texPage = null;
      this.matPage.map = null;
      this.matCalque.map = null;
    }
    this.matPage.needsUpdate = true;
    this.matCalque.needsUpdate = true;
    this.reconstruirePlan();
    this.redimensionner();
  }

  /** Opacité du calque de la page dessiné au-dessus de la vidéo (0 = masqué) */
  definirCalque(opacite) {
    this.opaciteCalque = opacite;
    this.appliquerCalque();
  }
  appliquerCalque() {
    const o = Math.max(this.opaciteCalque, this.calqueManipulation ? 0.5 : 0);
    this.matCalque.opacity = o;
    this.calque.visible = o > 0;
    this.dessiner();
  }

  /** Définit la vidéo (média) — null pour aucune */
  definirVideo(media) {
    if (this.media?.id === media?.id) return;
    this.media = media;
    this.video.pause();
    if (media) { this.video.src = urlDe(media.blob); this.video.currentTime = 0; }
    else this.video.removeAttribute('src');
    this.reconstruirePlan();
  }

  /** Réglages vidéo courants (taille, décalages, opacité, fond vert) */
  definirOptions(opts) {
    this.opts = opts;
    this.plan?.maj(opts);
    this.dessiner();
  }

  reconstruirePlan() {
    if (this.plan) { this.scene.remove(this.plan.mesh); this.plan.dispose(); this.plan = null; }
    if (!this.media) return;
    this.plan = creerPlanVideo(this.video, this.media, this.ratio);
    if (this.opts) this.plan.maj(this.opts);
    this.scene.add(this.plan.mesh);
  }

  redimensionner() {
    const l = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!l || !h) return;
    this.renderer.setSize(l, h, false);
    // cadrage : l'illustration entière + marge, en gardant les proportions
    const aspect = l / h;
    let demiH = (Math.max(this.ratio, 1 / aspect) * MARGE) / 2;
    let demiL = demiH * aspect;
    if (demiL < MARGE / 2) { demiL = MARGE / 2; demiH = demiL / aspect; }
    Object.assign(this.camera, { left: -demiL, right: demiL, top: demiH, bottom: -demiH });
    this.camera.updateProjectionMatrix();
    const e = (2 * demiL / l) * 2; // 2 px en unités de scène
    const R = this.ratio;
    const [haut, bas, gauche, droite] = this.bords;
    haut.scale.set(1 + e, e, 1); haut.position.set(0, R / 2, 0.03);
    bas.scale.set(1 + e, e, 1); bas.position.set(0, -R / 2, 0.03);
    gauche.scale.set(e, R + e, 1); gauche.position.set(-0.5, 0, 0.03);
    droite.scale.set(e, R + e, 1); droite.position.set(0.5, 0, 0.03);
    this.dessiner();
  }

  dessiner() {
    if (this.canvas.clientWidth) this.renderer.render(this.scene, this.camera);
  }

  /** Lance l'animation (vidéo en lecture) */
  demarrer() {
    if (this.actif) return;
    this.actif = true;
    this.video.play().catch(() => {});
    const boucle = () => {
      if (!this.actif) return;
      this.dessiner();
      requestAnimationFrame(boucle);
    };
    requestAnimationFrame(boucle);
  }

  arreter() {
    this.actif = false;
    this.video.pause();
  }

  basculerLecture() {
    if (this.video.paused) this.video.play().catch(() => {}); else this.video.pause();
    return !this.video.paused;
  }

  // ---------- interactions directes ----------
  versScene(e) {
    const b = this.canvas.getBoundingClientRect();
    const x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
    return { x: this.camera.left + x * (this.camera.right - this.camera.left), y: this.camera.top - y * (this.camera.top - this.camera.bottom) };
  }

  brancherInteractions() {
    const c = this.canvas;
    const pointeurs = new Map();
    let depart = null;

    const emettre = (ch) => { Object.assign(this.opts, ch); this.plan?.maj(this.opts); this.dessiner(); this.surChangement(ch); };
    const borne = (v, a, b) => Math.max(a, Math.min(b, v));
    const arrondi = (v, pas) => Math.round(v / pas) * pas;

    c.addEventListener('pointerdown', (e) => {
      if (!this.plan || !this.opts) return;
      c.setPointerCapture(e.pointerId);
      pointeurs.set(e.pointerId, this.versScene(e));
      depart = {
        pts: new Map([...pointeurs].map(([k, v]) => [k, { ...v }])),
        dx: this.opts.decalageX || 0, dy: this.opts.decalage || 0, taille: this.opts.taille ?? 1,
      };
      c.classList.add('saisi');
      this.calqueManipulation = true; this.appliquerCalque();
    });
    c.addEventListener('pointermove', (e) => {
      if (!pointeurs.has(e.pointerId) || !depart) return;
      pointeurs.set(e.pointerId, this.versScene(e));
      const ids = [...pointeurs.keys()];
      if (ids.length >= 2 && depart.pts.size >= 2) {
        // pincer : rapport des écarts entre les deux doigts
        const [a, b] = ids;
        const d0 = Math.hypot(depart.pts.get(a).x - depart.pts.get(b).x, depart.pts.get(a).y - depart.pts.get(b).y);
        const d1 = Math.hypot(pointeurs.get(a).x - pointeurs.get(b).x, pointeurs.get(a).y - pointeurs.get(b).y);
        if (d0 > 0.01) emettre({ taille: arrondi(borne(depart.taille * (d1 / d0), 0.3, 2.5), 0.01) });
      } else {
        const id = ids[0];
        const p0 = depart.pts.get(id), p = pointeurs.get(id);
        if (!p0) return;
        emettre({
          decalageX: arrondi(borne(depart.dx + (p.x - p0.x), -1, 1), 0.01),
          decalage: arrondi(borne(depart.dy + (p.y - p0.y) / this.ratio, -1, 1), 0.01),
        });
      }
    });
    const fin = (e) => {
      pointeurs.delete(e.pointerId);
      // repartir d'un nouvel état pour le doigt restant
      if (pointeurs.size && this.opts) depart = { pts: new Map([...pointeurs].map(([k, v]) => [k, { ...v }])), dx: this.opts.decalageX || 0, dy: this.opts.decalage || 0, taille: this.opts.taille ?? 1 };
      else { depart = null; c.classList.remove('saisi'); this.calqueManipulation = false; this.appliquerCalque(); }
    };
    c.addEventListener('pointerup', fin);
    c.addEventListener('pointercancel', fin);
    c.addEventListener('wheel', (e) => {
      if (!this.plan || !this.opts) return;
      e.preventDefault();
      const k = Math.exp(-e.deltaY * 0.0015);
      this.calqueManipulation = true;
      this.appliquerCalque();
      clearTimeout(this.minuterieMolette);
      this.minuterieMolette = setTimeout(() => { this.calqueManipulation = false; this.appliquerCalque(); }, 700);
      emettre({ taille: arrondi(borne((this.opts.taille ?? 1) * k, 0.3, 2.5), 0.01) });
    }, { passive: false });
    c.addEventListener('dblclick', () => {
      if (this.plan && this.opts) emettre({ decalageX: 0, decalage: 0, taille: 1 });
    });
  }

  detruire() {
    this.arreter();
    this.observateur.disconnect();
    this.plan?.dispose();
    this.texPage?.dispose();
    this.matCadre.dispose();
    this.matCalque.dispose();
    this.renderer.dispose();
    this.video.remove();
  }
}
