// Studio son : sonothèque + montage (séquence, coupe, fond sonore, finitions)
import { $, toast, echapper, duree, horodatage, urlDe, telecharger, nomFichier, lierSortie, attente } from './outils.js';
import { etat, bus, ajouterMedia, majMedia, supprimerMedia, mediasDeType, utilisationsMedia } from './etat.js';
import { decoder, oublier, enregistrerMicro, rendreMontage, versWav, jouerTampon, arreterApercu, cretes } from './audio.js';

let montage = null;     // montage en cours
let choisi = 0;         // index du segment sélectionné
let lecteurListe = null; // <audio> pour écouter depuis la liste
let tete = null;         // tête de lecture (pour l'animation sur la forme d'onde)

const ORIGINES = { import: 'importé', enregistrement: 'enregistré', montage: 'monté' };

export function initStudio() {
  $('#btn-enregistrer').onclick = () => enregistrerEtMonter();
  $('#import-sons').onchange = async (e) => {
    const fichiers = [...e.target.files];
    e.target.value = '';
    for (const f of fichiers) await importerSon(f);
    if (fichiers.length) toast(fichiers.length > 1 ? `${fichiers.length} sons importés` : 'Son importé');
  };
  bus.addEventListener('medias', () => { rendreListe(); if (montage) rendreSelecteurs(); });

  // finitions
  for (const [id, cle, fmt] of [['#fondu-entree', 'fonduEntree', (v) => v.toFixed(1) + ' s'], ['#fondu-sortie', 'fonduSortie', (v) => v.toFixed(1) + ' s'], ['#gain', 'gain', (v) => Math.round(v * 100) + ' %']]) {
    const el = $(id);
    lierSortie(el, fmt);
    el.addEventListener('input', () => { if (montage) montage[cle] = parseFloat(el.value); });
  }
  $('#normaliser').onchange = (e) => montage && (montage.normaliser = e.target.checked);
  $('#fond-son').onchange = (e) => montage && (montage.fond.mediaId = e.target.value || null);
  $('#fond-volume').oninput = (e) => montage && (montage.fond.volume = parseFloat(e.target.value));
  $('#fond-boucle').onchange = (e) => montage && (montage.fond.boucle = e.target.checked);

  $('#segment-ajouter').onclick = async () => {
    const id = $('#segment-ajout').value;
    if (!id) return;
    const m = etat.medias.get(id);
    montage.segments.push({ mediaId: id, debut: 0, fin: m.duree || 0 });
    choisi = montage.segments.length - 1;
    await completerFins();
    rendreSegments();
  };
  $('#ecouter-segment').onclick = ecouterSegment;
  $('#montage-ecouter').onclick = ecouterResultat;
  $('#montage-enregistrer').onclick = enregistrerResultat;
  $('#montage-fermer').onclick = fermerMontage;
  $('#montage-nom').oninput = (e) => montage && (montage.nom = e.target.value);

  brancherOnde();
  window.addEventListener('resize', () => montage && dessinerOnde());
  rendreListe();
}

export async function importerSon(fichier) {
  const nom = fichier.name.replace(/\.[^.]+$/, '');
  return ajouterMedia({ blob: fichier, type: 'audio', nom, origine: 'import' });
}

/** Enregistre au micro et ajoute à la sonothèque. Renvoie le média ou null. */
export async function enregistrerSon() {
  const blob = await enregistrerMicro();
  if (!blob || blob.size < 500) return null;
  return ajouterMedia({ blob, type: 'audio', nom: `Enregistrement ${horodatage()}`, origine: 'enregistrement' });
}

async function enregistrerEtMonter() {
  const m = await enregistrerSon();
  if (m) { toast('Enregistrement ajouté à la sonothèque'); ouvrirMontage(m.id); }
}

// ---------- liste ----------
function rendreListe() {
  const ul = $('#liste-sons');
  const sons = mediasDeType('audio');
  if (!sons.length) {
    ul.innerHTML = '<li class="info">Aucun son pour l\'instant. Enregistrez votre voix ou importez des fichiers (MP3, WAV, OGG…).</li>';
    return;
  }
  ul.innerHTML = sons.map((s) => `
    <li data-id="${s.id}">
      <button class="icone-btn" data-a="ecouter" title="Écouter">▶</button>
      <div class="nom"><b title="${echapper(s.nom)}">${echapper(s.nom)}</b><span>${duree(s.duree)} · ${ORIGINES[s.origine] || ''}</span></div>
      <button class="icone-btn texte" data-a="monter" title="Couper, enchaîner, ajouter un fond">Monter</button>
      <button class="icone-btn" data-a="renommer" title="Renommer">✎</button>
      <button class="icone-btn" data-a="telecharger" title="Télécharger">⬇</button>
      <button class="icone-btn" data-a="supprimer" title="Supprimer">🗑</button>
    </li>`).join('');
  ul.onclick = async (e) => {
    const b = e.target.closest('button[data-a]');
    if (!b) return;
    const id = b.closest('li').dataset.id;
    const m = etat.medias.get(id);
    switch (b.dataset.a) {
      case 'ecouter':
        if (lecteurListe && !lecteurListe.paused && lecteurListe.dataset.id === id) { lecteurListe.pause(); b.textContent = '▶'; break; }
        lecteurListe?.pause();
        ul.querySelectorAll('[data-a=ecouter]').forEach((x) => (x.textContent = '▶'));
        lecteurListe = new Audio(urlDe(m.blob));
        lecteurListe.dataset.id = id;
        lecteurListe.onended = () => (b.textContent = '▶');
        lecteurListe.play();
        b.textContent = '■';
        break;
      case 'monter': ouvrirMontage(id); break;
      case 'renommer': {
        const nom = prompt('Nouveau nom :', m.nom);
        if (nom?.trim()) { m.nom = nom.trim(); await majMedia(m); }
        break;
      }
      case 'telecharger': {
        const ext = (m.mime.split('/')[1] || 'audio').split(';')[0].replace('mpeg', 'mp3').replace('x-wav', 'wav');
        telecharger(m.blob, `${nomFichier(m.nom)}.${ext}`);
        break;
      }
      case 'supprimer': {
        const us = utilisationsMedia(id);
        const msg = us.length
          ? `Ce son est utilisé par ${us.length} page(s) (${us.map((u) => `« ${u.page.titre} »`).join(', ')}). Le supprimer quand même ?`
          : `Supprimer « ${m.nom} » ?`;
        if (!confirm(msg)) break;
        await supprimerMedia(id);
        oublier(id);
        if (montage) {
          montage.segments = montage.segments.filter((s) => s.mediaId !== id);
          if (montage.fond.mediaId === id) montage.fond.mediaId = null;
          if (!montage.segments.length) fermerMontage(); else { choisi = 0; rendreSegments(); }
        }
        break;
      }
    }
  };
}

// ---------- montage ----------
export async function ouvrirMontage(mediaId) {
  arreterApercu();
  const m = etat.medias.get(mediaId);
  montage = {
    nom: `${m.nom} (monté)`,
    segments: [{ mediaId, debut: 0, fin: m.duree || 0 }],
    fond: { mediaId: null, volume: 0.35, boucle: true },
    fonduEntree: 0, fonduSortie: 0.3, gain: 1, normaliser: true,
  };
  choisi = 0;
  document.querySelector('.onglet[data-vue="sons"]')?.click();
  $('#montage-vide').hidden = true;
  $('#montage-editeur').hidden = false;
  $('#montage-nom').value = montage.nom;
  for (const [id, v] of [['#fondu-entree', 0], ['#fondu-sortie', 0.3], ['#gain', 1], ['#fond-volume', 0.35]]) { $(id).value = v; $(id).dispatchEvent(new Event('input')); }
  $('#normaliser').checked = true;
  $('#fond-boucle').checked = true;
  rendreSelecteurs();
  await completerFins();
  rendreSegments();
}

function fermerMontage() {
  arreterApercu();
  montage = null;
  $('#montage-editeur').hidden = true;
  $('#montage-vide').hidden = false;
}

// La durée des enregistrements webm est parfois inconnue avant décodage
async function completerFins() {
  for (const s of montage.segments) {
    if (!s.fin || !isFinite(s.fin)) {
      try { s.fin = (await decoder(etat.medias.get(s.mediaId))).duration; } catch (e) { toast(e.message, true); }
    }
  }
}

function rendreSelecteurs() {
  const sons = mediasDeType('audio');
  const opts = sons.map((s) => `<option value="${s.id}">${echapper(s.nom)} (${duree(s.duree)})</option>`).join('');
  $('#segment-ajout').innerHTML = opts;
  $('#fond-son').innerHTML = '<option value="">— Aucun fond sonore —</option>' + opts;
  $('#fond-son').value = montage.fond.mediaId || '';
}

function rendreSegments() {
  const ol = $('#segments');
  ol.innerHTML = montage.segments.map((s, i) => {
    const m = etat.medias.get(s.mediaId);
    return `<li data-i="${i}" class="${i === choisi ? 'choisi' : ''}">
      <span class="nom">${echapper(m?.nom || '(son supprimé)')}</span>
      <span class="t">${duree(s.debut)} → ${duree(s.fin)}</span>
      <button class="icone-btn" data-a="haut" title="Monter" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="icone-btn" data-a="bas" title="Descendre" ${i === montage.segments.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="icone-btn" data-a="dupliquer" title="Dupliquer">⧉</button>
      <button class="icone-btn" data-a="retirer" title="Retirer" ${montage.segments.length === 1 ? 'disabled' : ''}>✕</button>
    </li>`;
  }).join('');
  ol.onclick = (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const i = +li.dataset.i;
    const a = e.target.closest('button')?.dataset.a;
    const S = montage.segments;
    if (a === 'haut' && i > 0) { [S[i - 1], S[i]] = [S[i], S[i - 1]]; choisi = i - 1; }
    else if (a === 'bas' && i < S.length - 1) { [S[i + 1], S[i]] = [S[i], S[i + 1]]; choisi = i + 1; }
    else if (a === 'dupliquer') { S.splice(i + 1, 0, { ...S[i] }); choisi = i + 1; }
    else if (a === 'retirer' && S.length > 1) { S.splice(i, 1); choisi = Math.min(choisi, S.length - 1); }
    else choisi = i;
    rendreSegments();
  };
  const total = montage.segments.reduce((a, s) => a + (s.fin - s.debut), 0);
  $('#montage-duree').textContent = duree(total);
  $('#onde-titre').textContent = `Couper le morceau n°${choisi + 1} : faites glisser les poignées orange.`;
  chargerOnde();
}

// ---------- forme d'onde ----------
let tamponOnde = null, crOnde = null;
async function chargerOnde() {
  const s = montage?.segments[choisi];
  if (!s) return;
  try {
    tamponOnde = await decoder(etat.medias.get(s.mediaId));
    crOnde = null;
    dessinerOnde();
  } catch (e) { toast(e.message, true); }
}

function dessinerOnde() {
  const cv = $('#onde');
  const s = montage?.segments[choisi];
  if (!s || !tamponOnde) return;
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(200, cv.clientWidth) * dpr, H = 140 * dpr;
  if (cv.width !== W) { cv.width = W; crOnde = null; }
  cv.height = H;
  const g = cv.getContext('2d');
  if (!crOnde) crOnde = cretes(tamponOnde, Math.floor(W / dpr));
  const D = tamponOnde.duration;
  const xa = (s.debut / D) * W, xb = (s.fin / D) * W;
  g.clearRect(0, 0, W, H);
  const n = crOnde.length, pas = W / n;
  for (let i = 0; i < n; i++) {
    const x = i * pas;
    const h = Math.max(1 * dpr, crOnde[i] * (H * 0.9));
    g.fillStyle = x >= xa && x <= xb ? '#f6c8a8' : 'rgba(255,255,255,.22)';
    g.fillRect(x, (H - h) / 2, Math.max(1, pas - 0.5), h);
  }
  // poignées
  g.fillStyle = '#e0703a';
  for (const x of [xa, xb]) {
    g.fillRect(x - 1.5 * dpr, 0, 3 * dpr, H);
    g.beginPath(); g.arc(x, H / 2, 9 * dpr, 0, Math.PI * 2); g.fill();
  }
  if (tete != null) { g.fillStyle = '#fff'; g.fillRect((tete / D) * W - dpr, 0, 2 * dpr, H); }
  $('#onde-info').textContent = `Garde ${duree(s.fin - s.debut)} sur ${duree(D)}`;
}

function brancherOnde() {
  const cv = $('#onde');
  let poignee = null;
  const temps = (e) => {
    const b = cv.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)) * (tamponOnde?.duration || 0);
  };
  cv.onpointerdown = (e) => {
    const s = montage?.segments[choisi];
    if (!s || !tamponOnde) return;
    cv.setPointerCapture(e.pointerId);
    const t = temps(e);
    poignee = Math.abs(t - s.debut) <= Math.abs(t - s.fin) ? 'debut' : 'fin';
    cv.onpointermove(e);
  };
  cv.onpointermove = (e) => {
    if (!poignee) return;
    const s = montage.segments[choisi];
    const t = temps(e);
    if (poignee === 'debut') s.debut = Math.min(t, s.fin - 0.05);
    else s.fin = Math.max(t, s.debut + 0.05);
    dessinerOnde();
  };
  cv.onpointerup = () => { if (poignee) { poignee = null; rendreSegments(); } };
}

function animerTete(lecture) {
  const boucle = () => {
    if (tete === null) return;
    tete = lecture.position();
    dessinerOnde();
    requestAnimationFrame(boucle);
  };
  requestAnimationFrame(boucle);
}

async function ecouterSegment() {
  const s = montage.segments[choisi];
  const buf = await decoder(etat.medias.get(s.mediaId));
  tete = s.debut;
  const l = jouerTampon(buf, s.debut, s.fin, () => { tete = null; dessinerOnde(); });
  animerTete(l);
}

async function ecouterResultat() {
  try {
    attente('Préparation du mixage…');
    const rendu = await rendreMontage(montage, etat.medias);
    attente(false);
    tete = null;
    jouerTampon(rendu);
  } catch (e) { attente(false); toast(e.message, true); }
}

async function enregistrerResultat() {
  try {
    attente('Mixage et enregistrement…');
    const rendu = await rendreMontage(montage, etat.medias);
    const wav = versWav(rendu);
    const m = await ajouterMedia({ blob: wav, type: 'audio', nom: montage.nom?.trim() || `Montage ${horodatage()}`, origine: 'montage' });
    attente(false);
    toast(`« ${m.nom} » ajouté à la sonothèque`);
  } catch (e) { attente(false); toast(e.message, true); }
}
