// Prise de vue de l'illustration + recadrage
import { $, toast, chargerImage, canvasVersBlob, listerCameras } from './outils.js';

const TAILLE_MAX = 1024; // côté max de l'image cible : suffisant pour MindAR, léger à stocker

// ---------- Caméra ----------
let flux = null;

async function ouvrirFlux(deviceId) {
  fermerFlux();
  const contraintes = { audio: false, video: deviceId
    ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    : { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } };
  flux = await navigator.mediaDevices.getUserMedia(contraintes);
  $('#camera-video').srcObject = flux;
}
function fermerFlux() {
  if (flux) flux.getTracks().forEach((t) => t.stop());
  flux = null;
}

/** Ouvre la caméra et renvoie un Blob image (ou null si annulé) */
export function photographier() {
  const dlg = $('#dlg-camera');
  return new Promise(async (ok) => {
    let fini = false;
    const terminer = (val) => {
      if (fini) return; fini = true;
      fermerFlux(); dlg.close(); ok(val);
    };
    $('#camera-fermer').onclick = () => terminer(null);
    dlg.oncancel = (e) => { e.preventDefault(); terminer(null); };
    dlg.showModal();
    try {
      await ouvrirFlux();
    } catch (e) {
      toast("Impossible d'accéder à la caméra : " + e.message, true);
      return terminer(null);
    }
    const choix = $('#camera-choix');
    const cams = await listerCameras();
    const actif = flux?.getVideoTracks()[0]?.getSettings().deviceId;
    choix.innerHTML = cams.map((c, i) => `<option value="${c.deviceId}" ${c.deviceId === actif ? 'selected' : ''}>${c.label || 'Caméra ' + (i + 1)}</option>`).join('');
    choix.hidden = cams.length < 2;
    choix.onchange = () => ouvrirFlux(choix.value).catch((e) => toast(e.message, true));
    $('#camera-declencher').onclick = async () => {
      const v = $('#camera-video');
      if (!v.videoWidth) return;
      const c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      terminer(await canvasVersBlob(c, 'image/jpeg', 0.95));
    };
  });
}

// ---------- Recadrage ----------
/**
 * Affiche l'outil de recadrage. Renvoie { blob, largeur, hauteur } ou null.
 */
export async function recadrer(source) {
  let img = await chargerImage(source);
  let toile = versCanvas(img, 0);
  const dlg = $('#dlg-recadrage');
  const cv = $('#recadrage-canvas');
  const ctx = cv.getContext('2d');
  let rect; // en coordonnées image
  let echelle = 1;

  function preparer() {
    const maxL = Math.min(window.innerWidth - 80, 940);
    const maxH = window.innerHeight * 0.62;
    echelle = Math.min(maxL / toile.width, maxH / toile.height, 1);
    cv.width = Math.round(toile.width * echelle);
    cv.height = Math.round(toile.height * echelle);
    rect = { x: 0, y: 0, l: toile.width, h: toile.height };
    dessiner();
  }

  function dessiner() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(toile, 0, 0, cv.width, cv.height);
    const r = versEcran(rect);
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.beginPath();
    ctx.rect(0, 0, cv.width, cv.height);
    ctx.rect(r.x, r.y, r.l, r.h);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#e0703a'; ctx.lineWidth = 3;
    ctx.strokeRect(r.x, r.y, r.l, r.h);
    ctx.fillStyle = '#fff';
    for (const [x, y] of coins(r)) { ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  }
  const versEcran = (r) => ({ x: r.x * echelle, y: r.y * echelle, l: r.l * echelle, h: r.h * echelle });
  const coins = (r) => [[r.x, r.y], [r.x + r.l, r.y], [r.x, r.y + r.h], [r.x + r.l, r.y + r.h]];

  // Interaction pointeur
  let mode = null, depart = null, rectDepart = null, coin = -1;
  const pos = (e) => {
    const b = cv.getBoundingClientRect();
    return { x: (e.clientX - b.left) * (cv.width / b.width) / echelle, y: (e.clientY - b.top) * (cv.height / b.height) / echelle };
  };
  cv.onpointerdown = (e) => {
    cv.setPointerCapture(e.pointerId);
    const p = pos(e);
    const tol = 18 / echelle;
    coin = coins(rect).findIndex(([x, y]) => Math.hypot(x - p.x, y - p.y) < tol);
    depart = p; rectDepart = { ...rect };
    if (coin >= 0) mode = 'coin';
    else if (p.x > rect.x && p.x < rect.x + rect.l && p.y > rect.y && p.y < rect.y + rect.h) mode = 'deplacer';
    else { mode = 'tracer'; }
  };
  cv.onpointermove = (e) => {
    if (!mode) return;
    const p = pos(e);
    const W = toile.width, H = toile.height;
    const cl = (v, a, b) => Math.max(a, Math.min(b, v));
    if (mode === 'deplacer') {
      rect.x = cl(rectDepart.x + p.x - depart.x, 0, W - rect.l);
      rect.y = cl(rectDepart.y + p.y - depart.y, 0, H - rect.h);
    } else {
      let ax, ay;
      if (mode === 'tracer') { ax = depart.x; ay = depart.y; }
      else { // coin opposé fixe
        const c = coins(rectDepart)[3 - coin]; ax = c[0]; ay = c[1];
      }
      const bx = cl(p.x, 0, W), by = cl(p.y, 0, H);
      rect = { x: Math.min(ax, bx), y: Math.min(ay, by), l: Math.max(20, Math.abs(bx - ax)), h: Math.max(20, Math.abs(by - ay)) };
    }
    dessiner();
  };
  cv.onpointerup = () => { mode = null; };

  return new Promise((ok) => {
    const fin = (v) => { dlg.close(); ok(v); };
    $('#recadrage-tout').onclick = () => { rect = { x: 0, y: 0, l: toile.width, h: toile.height }; dessiner(); };
    $('#recadrage-rotation').onclick = () => { toile = versCanvas(toile, 90); preparer(); };
    $('#recadrage-annuler').onclick = () => fin(null);
    dlg.oncancel = (e) => { e.preventDefault(); fin(null); };
    $('#recadrage-ok').onclick = async () => {
      const k = Math.min(1, TAILLE_MAX / Math.max(rect.l, rect.h));
      const c = document.createElement('canvas');
      c.width = Math.round(rect.l * k); c.height = Math.round(rect.h * k);
      const cx = c.getContext('2d');
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(toile, rect.x, rect.y, rect.l, rect.h, 0, 0, c.width, c.height);
      fin({ blob: await canvasVersBlob(c, 'image/jpeg', 0.92), largeur: c.width, hauteur: c.height });
    };
    dlg.showModal();
    preparer();
  });
}

function versCanvas(source, rotation) {
  const l = source.naturalWidth || source.width, h = source.naturalHeight || source.height;
  // On limite la taille de travail pour rester fluide sur tablette
  const k = Math.min(1, 2400 / Math.max(l, h));
  const c = document.createElement('canvas');
  const L = Math.round(l * k), H = Math.round(h * k);
  if (rotation === 90) { c.width = H; c.height = L; } else { c.width = L; c.height = H; }
  const ctx = c.getContext('2d');
  if (rotation === 90) { ctx.translate(H, 0); ctx.rotate(Math.PI / 2); }
  ctx.drawImage(source, 0, 0, L, H);
  return c;
}
