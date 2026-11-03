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
  // Affichage : l'image est dessinée avec une marge autour, pour que les poignées
  // restent attrapables au doigt même quand le cadre touche le bord de la photo.
  const MARGE = 22;             // px CSS autour de l'image
  const PRISE_COIN = 34;        // rayon de prise d'un coin (px CSS, taille d'un doigt)
  const PRISE_BORD = 24;        // distance de prise d'un côté
  let ech = 1, cssL = 0, cssH = 0, dpr = 1;

  function preparer(garderCadre = false) {
    const zone = cv.parentElement;
    const dispoL = Math.max(200, Math.min(zone.clientWidth - 16 || window.innerWidth - 48, 940)) - 2 * MARGE;
    const dispoH = Math.max(200, window.innerHeight * 0.6) - 2 * MARGE;
    ech = Math.min(dispoL / toile.width, dispoH / toile.height);
    cssL = Math.round(toile.width * ech) + 2 * MARGE;
    cssH = Math.round(toile.height * ech) + 2 * MARGE;
    dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.style.width = cssL + 'px';
    cv.style.height = cssH + 'px';
    cv.width = Math.round(cssL * dpr);
    cv.height = Math.round(cssH * dpr);
    if (!garderCadre) {
      // cadre de départ légèrement en retrait : on voit tout de suite qu'il se déplace
      const mx = toile.width * 0.06, my = toile.height * 0.06;
      rect = { x: mx, y: my, l: toile.width - 2 * mx, h: toile.height - 2 * my };
    }
    dessiner();
  }

  // image -> écran (px CSS) et inverse
  const ex = (x) => MARGE + x * ech, ey = (y) => MARGE + y * ech;
  const ix = (x) => (x - MARGE) / ech, iy = (y) => (y - MARGE) / ech;

  function dessiner() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssL, cssH);
    ctx.drawImage(toile, MARGE, MARGE, toile.width * ech, toile.height * ech);
    const x0 = ex(rect.x), y0 = ey(rect.y), x1 = ex(rect.x + rect.l), y1 = ey(rect.y + rect.h);
    // voile hors du cadre
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.beginPath();
    ctx.rect(MARGE, MARGE, toile.width * ech, toile.height * ech);
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.fill('evenodd');
    // cadre + tiers
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
    for (const t of [1 / 3, 2 / 3]) {
      ctx.beginPath(); ctx.moveTo(x0 + (x1 - x0) * t, y0); ctx.lineTo(x0 + (x1 - x0) * t, y1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x0, y0 + (y1 - y0) * t); ctx.lineTo(x1, y0 + (y1 - y0) * t); ctx.stroke();
    }
    ctx.strokeStyle = '#e0703a'; ctx.lineWidth = 2;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    // poignées de coin en équerre, épaisses
    const L = Math.min(26, (x1 - x0) / 3, (y1 - y0) / 3);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y); ctx.stroke();
    }
    // poignées de côté
    ctx.lineWidth = 6;
    const mxC = (x0 + x1) / 2, myC = (y0 + y1) / 2, l2 = Math.min(14, (x1 - x0) / 6, (y1 - y0) / 6);
    for (const [ax, ay, bx, by] of [[mxC - l2, y0, mxC + l2, y0], [mxC - l2, y1, mxC + l2, y1], [x0, myC - l2, x0, myC + l2], [x1, myC - l2, x1, myC + l2]]) {
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  // Interaction pointeur (souris, doigt, stylet) — distances calculées en px CSS
  let mode = null, depart = null, rectDepart = null, bords = null;
  const posCss = (e) => { const b = cv.getBoundingClientRect(); return { x: (e.clientX - b.left) * (cssL / b.width), y: (e.clientY - b.top) * (cssH / b.height) }; };

  function cible(p) {
    const x0 = ex(rect.x), y0 = ey(rect.y), x1 = ex(rect.x + rect.l), y1 = ey(rect.y + rect.h);
    // coin le plus proche dans le rayon de prise
    const coins = [['g', 'h', x0, y0], ['d', 'h', x1, y0], ['g', 'b', x0, y1], ['d', 'b', x1, y1]]
      .map(([cx, cy, x, y]) => ({ cx, cy, d: Math.hypot(p.x - x, p.y - y) }))
      .filter((c) => c.d < PRISE_COIN).sort((a, b) => a.d - b.d);
    if (coins.length) return { mode: 'bords', bords: { [coins[0].cx]: 1, [coins[0].cy]: 1 } };
    const dansX = p.x > x0 - PRISE_BORD && p.x < x1 + PRISE_BORD, dansY = p.y > y0 - PRISE_BORD && p.y < y1 + PRISE_BORD;
    const b = {};
    if (dansY && Math.abs(p.x - x0) < PRISE_BORD) b.g = 1;
    else if (dansY && Math.abs(p.x - x1) < PRISE_BORD) b.d = 1;
    if (dansX && Math.abs(p.y - y0) < PRISE_BORD) b.h = 1;
    else if (dansX && Math.abs(p.y - y1) < PRISE_BORD) b.b = 1;
    if (Object.keys(b).length) return { mode: 'bords', bords: b };
    if (p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1) return { mode: 'deplacer' };
    return { mode: 'tracer' };
  }

  cv.onpointerdown = (e) => {
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    const p = posCss(e);
    const c = cible(p);
    mode = c.mode; bords = c.bords || null;
    depart = p; rectDepart = { ...rect };
  };
  cv.onpointermove = (e) => {
    if (!mode) {
      // curseur indicatif à la souris
      const c = cible(posCss(e));
      cv.style.cursor = c.mode === 'deplacer' ? 'move' : c.mode === 'bords' ? 'pointer' : 'crosshair';
      return;
    }
    const p = posCss(e);
    const W = toile.width, H = toile.height, MIN = 40 / ech; // 40 px CSS minimum
    const cl = (v, a, b) => Math.max(a, Math.min(b, v));
    const dx = (p.x - depart.x) / ech, dy = (p.y - depart.y) / ech;
    const r = rectDepart;
    if (mode === 'deplacer') {
      rect = { ...r, x: cl(r.x + dx, 0, W - r.l), y: cl(r.y + dy, 0, H - r.h) };
    } else if (mode === 'bords') {
      let gx = r.x, dX = r.x + r.l, hy = r.y, bY = r.y + r.h;
      if (bords.g) gx = cl(r.x + dx, 0, dX - MIN);
      if (bords.d) dX = cl(r.x + r.l + dx, gx + MIN, W);
      if (bords.h) hy = cl(r.y + dy, 0, bY - MIN);
      if (bords.b) bY = cl(r.y + r.h + dy, hy + MIN, H);
      rect = { x: gx, y: hy, l: dX - gx, h: bY - hy };
    } else if (mode === 'tracer') {
      // on ne trace un nouveau cadre qu'après un vrai glissement (un simple toucher ne casse rien)
      if (Math.hypot(p.x - depart.x, p.y - depart.y) < 12) return;
      const ax = cl(ix(depart.x), 0, W), ay = cl(iy(depart.y), 0, H);
      const bx = cl(ix(p.x), 0, W), by = cl(iy(p.y), 0, H);
      rect = { x: Math.min(ax, bx), y: Math.min(ay, by), l: Math.max(MIN, Math.abs(bx - ax)), h: Math.max(MIN, Math.abs(by - ay)) };
      rect.x = Math.min(rect.x, W - rect.l); rect.y = Math.min(rect.y, H - rect.h);
    }
    dessiner();
  };
  cv.onpointerup = cv.onpointercancel = () => { mode = null; bords = null; };
  const surResize = () => { if (dlg.open) preparer(true); };
  window.addEventListener('resize', surResize);

  return new Promise((ok) => {
    const fin = (v) => { window.removeEventListener('resize', surResize); dlg.close(); ok(v); };
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
    requestAnimationFrame(() => preparer()); // après affichage : la largeur disponible est connue
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
