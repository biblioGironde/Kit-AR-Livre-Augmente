// Petits utilitaires d'interface et de médias
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let minuterieToast;
export function toast(msg, erreur = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('erreur', erreur);
  t.classList.add('visible');
  clearTimeout(minuterieToast);
  minuterieToast = setTimeout(() => t.classList.remove('visible'), erreur ? 6000 : 3000);
}

export function attente(texte, progression = null) {
  const a = $('#attente');
  if (texte === false) { a.hidden = true; return; }
  a.hidden = false;
  $('#attente-texte').textContent = texte;
  const p = $('#attente-prog');
  p.hidden = progression === null;
  if (progression !== null) p.value = progression;
}

export function echapper(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function duree(s) {
  if (!isFinite(s)) return '–';
  if (s < 60) return s.toFixed(1).replace('.', ',') + ' s';
  const m = Math.floor(s / 60);
  return `${m} min ${String(Math.round(s % 60)).padStart(2, '0')}`;
}

export function horodatage() {
  return new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Cache d'URL objet pour éviter de recréer des blob: à chaque rendu
const urls = new WeakMap();
export function urlDe(blob) {
  if (!blob) return '';
  let u = urls.get(blob);
  if (!u) { u = URL.createObjectURL(blob); urls.set(blob, u); }
  return u;
}

export function chargerImage(src) {
  return new Promise((ok, ko) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => ko(new Error("Image illisible"));
    img.src = typeof src === 'string' ? src : URL.createObjectURL(src);
  });
}

export function canvasVersBlob(canvas, type = 'image/jpeg', qualite = 0.9) {
  return new Promise((ok) => canvas.toBlob(ok, type, qualite));
}

// Durée d'un média (audio/vidéo) à partir de son blob
export function dureeMedia(blob, type) {
  return new Promise((ok) => {
    const el = document.createElement(type === 'video' ? 'video' : 'audio');
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      if (el.duration === Infinity) { // webm enregistré : durée inconnue tant qu'on n'a pas cherché la fin
        el.currentTime = 1e7;
        el.ontimeupdate = () => { el.ontimeupdate = null; ok(el.duration); };
      } else ok(el.duration);
    };
    el.onerror = () => ok(NaN);
    el.src = URL.createObjectURL(blob);
  });
}

export function dimensionsVideo(blob) {
  return new Promise((ok) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => ok({ largeur: v.videoWidth, hauteur: v.videoHeight, duree: v.duration });
    v.onerror = () => ok({ largeur: 16, hauteur: 9, duree: NaN });
    v.src = URL.createObjectURL(blob);
  });
}

export function telecharger(blob, nom) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function nomFichier(s) {
  return (s || 'livre').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'livre';
}

// Lie un <input type=range> à son <output> voisin
export function lierSortie(input, format = (v) => v) {
  const out = input.parentElement.querySelector('output');
  const maj = () => { if (out) out.textContent = format(parseFloat(input.value)); };
  input.addEventListener('input', maj);
  maj();
  return maj;
}

export async function listerCameras() {
  try {
    const d = await navigator.mediaDevices.enumerateDevices();
    return d.filter((x) => x.kind === 'videoinput');
  } catch { return []; }
}
