// Kit Livre Augmenté — interface principale
import { $, $$, toast, attente, echapper, duree, urlDe, telecharger, nomFichier, lierSortie, listerCameras } from './outils.js';
import { stockagePersistant, uid } from './db.js';
import {
  etat, bus, chargerTout, ajouterMedia, mediasDeType, nouveauLivre, enregistrerLivre, supprimerLivre,
  livreParId, nouvellePage, OPTIONS_DEFAUT, ciblesAJour,
} from './etat.js';
import { photographier, recadrer } from './photo.js';
import { initStudio, importerSon, enregistrerSon } from './studio.js';
import { analyserCibles } from './cibles.js';
import { exporterLivre, importerLivre } from './archive.js';

// Adresse publique (GitHub Pages) utilisée pour les QR codes, y compris depuis l'appli Electron
const ADRESSE_PUBLIQUE = 'https://bibliogironde.github.io/Kit-AR-Livre-Augmente/';

let livreCourant = null;

// =============== Navigation ===============
function afficherVue(nom) {
  $$('.vue').forEach((v) => v.classList.toggle('active', v.id === 'vue-' + nom));
  $$('.onglet').forEach((o) => o.classList.toggle('actif', o.dataset.vue === nom || (nom === 'livre' && o.dataset.vue === 'livres')));
  window.scrollTo(0, 0);
}
$$('.onglet').forEach((o) => (o.onclick = () => {
  afficherVue(o.dataset.vue);
  if (o.dataset.vue === 'livres') livreCourant = null;
}));

// =============== Liste des livres ===============
function rendreLivres() {
  const el = $('#liste-livres');
  if (!etat.livres.length) {
    el.innerHTML = `<div class="vide"><b>Aucun livre pour l'instant</b>Créez un livre, photographiez ses illustrations et associez-leur une vidéo ou un son.</div>`;
    return;
  }
  el.innerHTML = etat.livres.map((l) => {
    const couv = l.pages.find((p) => p.image)?.image;
    const n = l.pages.length;
    const actives = l.pages.filter((p) => p.image && p.action?.type !== 'aucune' && p.action?.mediaId).length;
    return `<article class="carte-livre" data-id="${l.id}">
      <div class="couv" style="${couv ? `background-image:url('${urlDe(couv)}')` : ''}">${couv ? '' : '📖'}</div>
      <div class="corps"><b>${echapper(l.titre)}</b><span>${n} page${n > 1 ? 's' : ''} · ${actives} animée${actives > 1 ? 's' : ''}</span></div>
      <div class="pied"><button class="btn primaire petit" data-a="lire">▶ Lire</button><button class="btn secondaire petit" data-a="ouvrir">Modifier</button></div>
    </article>`;
  }).join('');
}
$('#liste-livres').onclick = (e) => {
  const carte = e.target.closest('.carte-livre');
  if (!carte) return;
  const livre = livreParId(carte.dataset.id);
  if (e.target.closest('[data-a=lire]')) lire(livre);
  else ouvrirLivre(livre);
};
$('#nouveau-livre').onclick = async () => {
  const l = nouveauLivre();
  await enregistrerLivre(l);
  ouvrirLivre(l);
  $('#titre-livre').select();
};
$('#import-livre').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    attente('Import du livre…', 0);
    const { livre, remplace } = await importerLivre(f, (p) => attente('Import du livre…', p));
    attente(false);
    toast(remplace ? `« ${livre.titre} » mis à jour` : `« ${livre.titre} » importé`);
  } catch (err) { attente(false); toast(err.message, true); }
};

// =============== Un livre ===============
function ouvrirLivre(livre) {
  livreCourant = livre;
  $('#titre-livre').value = livre.titre;
  rendrePages();
  afficherVue('livre');
}
$('#retour-livres').onclick = () => { livreCourant = null; afficherVue('livres'); };
$('#titre-livre').onchange = async (e) => {
  livreCourant.titre = e.target.value.trim() || 'Sans titre';
  await enregistrerLivre(livreCourant);
};
$('#supprimer-livre').onclick = async () => {
  if (!confirm(`Supprimer le livre « ${livreCourant.titre} » et ses pages ?\nLes vidéos et sons restent dans la sonothèque.`)) return;
  await supprimerLivre(livreCourant.id);
  livreCourant = null;
  afficherVue('livres');
};
$('#lire-livre').onclick = () => lire(livreCourant);
$('#exporter-livre').onclick = () => ouvrirExport(livreCourant);

function rendrePages() {
  const l = livreCourant;
  if (!l) return;
  const pages = l.pages;
  $('#liste-pages').innerHTML = pages.map((p, i) => {
    const a = p.action || {};
    const m = a.mediaId ? etat.medias.get(a.mediaId) : null;
    let badge;
    if (!p.image) badge = '<span class="badge manque">Illustration à prendre</span>';
    else if (a.type === 'video') badge = m ? `<span class="badge">🎬 ${echapper(m.nom)}</span>` : '<span class="badge manque">🎬 vidéo manquante</span>';
    else if (a.type === 'son') badge = m ? `<span class="badge">🔊 ${echapper(m.nom)}</span>` : '<span class="badge manque">🔊 son manquant</span>';
    else badge = '<span class="badge manque">Aucune action</span>';
    return `<article class="carte-page" data-id="${p.id}">
      <div class="vignette" data-a="ouvrir" style="${p.image ? `background-image:url('${urlDe(p.image)}')` : ''}">
        <span class="num">${i + 1}</span>${badge}
      </div>
      <div class="corps">
        <b title="${echapper(p.titre)}">${echapper(p.titre)}</b>
        <button class="fleche" data-a="avant" title="Déplacer avant" ${i === 0 ? 'disabled' : ''}>←</button>
        <button class="fleche" data-a="apres" title="Déplacer après" ${i === pages.length - 1 ? 'disabled' : ''}>→</button>
      </div>
    </article>`;
  }).join('') + '<button class="ajout-page" id="ajouter-page">+ Ajouter une page</button>';

  const n = pages.length;
  const sansImage = pages.filter((p) => !p.image).length;
  let etatTxt = n ? `${n} page${n > 1 ? 's' : ''}. ` : 'Ajoutez une page par illustration à animer. ';
  if (pages.some((p) => p.image)) etatTxt += ciblesAJour(l) ? 'Illustrations analysées ✓' : 'Les illustrations seront analysées au lancement de la lecture.';
  if (sansImage) etatTxt += ` ${sansImage} page${sansImage > 1 ? 's' : ''} sans illustration.`;
  $('#etat-cibles').textContent = etatTxt;
}

$('#liste-pages').onclick = async (e) => {
  if (e.target.closest('#ajouter-page')) {
    const p = nouvellePage(livreCourant.pages.length + 1);
    editerPage(p, true);
    return;
  }
  const carte = e.target.closest('.carte-page');
  if (!carte) return;
  const i = livreCourant.pages.findIndex((p) => p.id === carte.dataset.id);
  const a = e.target.closest('[data-a]')?.dataset.a;
  const P = livreCourant.pages;
  if (a === 'avant' && i > 0) { [P[i - 1], P[i]] = [P[i], P[i - 1]]; await enregistrerLivre(livreCourant); }
  else if (a === 'apres' && i < P.length - 1) { [P[i + 1], P[i]] = [P[i], P[i + 1]]; await enregistrerLivre(livreCourant); }
  else if (a === 'ouvrir') editerPage(P[i], false);
};

// =============== Éditeur de page ===============
let brouillon = null, estNouvelle = false;
const dlgPage = $('#dlg-page');

function editerPage(page, nouvelle) {
  estNouvelle = nouvelle;
  brouillon = structuredClone(page);
  brouillon.action ||= { type: 'aucune', mediaId: null };
  brouillon.action.video = { ...OPTIONS_DEFAUT.video, ...(brouillon.action.video || {}) };
  brouillon.action.son = { ...OPTIONS_DEFAUT.son, ...(brouillon.action.son || {}) };
  $('#page-titre').value = brouillon.titre;
  $('#page-supprimer').hidden = nouvelle;
  apercuImageVersion = null;
  rendreApercuImage();
  $$('input[name=action]').forEach((r) => (r.checked = r.value === brouillon.action.type));
  // réglages vidéo
  const o = brouillon.action.video;
  $('#v-taille').value = o.taille; $('#v-decalage').value = o.decalage; $('#v-decalage-x').value = o.decalageX || 0; $('#v-opacite').value = o.opacite;
  $('#v-boucle').checked = o.boucle; $('#v-son').checked = o.son; $('#v-debut').checked = o.debut;
  $('#v-chroma').checked = o.chroma; $('#v-chroma-couleur').value = o.chromaCouleur; $('#v-chroma-tol').value = o.chromaTol;
  // réglages son
  const s = brouillon.action.son;
  $('#s-volume').value = s.volume; $('#s-boucle').checked = s.boucle; $('#s-arret').checked = s.arret; $('#s-debut').checked = s.debut;
  $$('#dlg-page input[type=range]').forEach((r) => r.dispatchEvent(new Event('input')));
  rendreSelecteursMedias();
  majReglagesVisibles();
  dlgPage.showModal();
}

function rendreApercuImage() {
  const z = $('#page-apercu');
  z.innerHTML = brouillon.image ? `<img src="${urlDe(brouillon.image)}" alt="Illustration">` : '<span>Aucune illustration</span>';
  $('#page-recadrer').hidden = !brouillon.image;
  majComposite();
}

// ---------- aperçu vidéo posée sur l'illustration ----------
let apercu = null, apercuImageVersion = null;
async function majComposite() {
  if (!brouillon) return;
  const a = brouillon.action;
  const media = a.type === 'video' && a.mediaId ? etat.medias.get(a.mediaId) : null;
  const visible = !!(media && brouillon.image);
  $('#page-composite').hidden = !visible;
  $('#page-apercu').hidden = visible;
  $('#page-video-apercu').hidden = true; // remplacé par l'aperçu composite
  if (!visible) { apercu?.arreter(); if (a.type === 'video' && media) $('#page-video-apercu').hidden = false; return; }
  try {
    if (!apercu) {
      const { ApercuPage } = await import('./apercu.js');
      apercu = new ApercuPage($('#composite-canvas'), (ch) => {
        // l'utilisateur a déplacé / redimensionné la vidéo dans l'aperçu : on synchronise les curseurs
        const ids = { taille: '#v-taille', decalage: '#v-decalage', decalageX: '#v-decalage-x' };
        for (const [k, v] of Object.entries(ch)) { const el = $(ids[k]); if (el) { el.value = v; el.dispatchEvent(new Event('input')); } }
      });
    }
    if (apercuImageVersion !== brouillon.imageVersion + ':' + brouillon.id) {
      apercuImageVersion = brouillon.imageVersion + ':' + brouillon.id;
      await apercu.definirPage(brouillon.image, brouillon.largeur, brouillon.hauteur);
    }
    apercu.definirOptions(brouillon.action.video);
    apercu.definirVideo(media);
    apercu.definirOptions(brouillon.action.video);
    apercu.demarrer();
    $('#composite-lecture').textContent = '❚❚';
  } catch (e) {
    console.error(e);
    $('#page-composite').hidden = true; $('#page-apercu').hidden = false; $('#page-video-apercu').hidden = false;
  }
}
$('#composite-lecture').onclick = () => {
  if (!apercu) return;
  const lit = apercu.basculerLecture();
  $('#composite-lecture').textContent = lit ? '❚❚' : '▶';
  $('#composite-lecture').setAttribute('aria-label', lit ? 'Pause' : 'Lecture');
};

function rendreSelecteursMedias() {
  const remplir = (sel, type, vide) => {
    const liste = mediasDeType(type);
    sel.innerHTML = `<option value="">${vide}</option>` + liste.map((m) => `<option value="${m.id}">${echapper(m.nom)} (${duree(m.duree)})</option>`).join('');
  };
  remplir($('#page-video'), 'video', '— Choisir une vidéo —');
  remplir($('#page-son'), 'audio', '— Choisir un son —');
  const a = brouillon.action;
  if (a.type === 'video') $('#page-video').value = a.mediaId || '';
  if (a.type === 'son') $('#page-son').value = a.mediaId || '';
  majApercuMedia();
}

function majApercuMedia() {
  const a = brouillon.action;
  const v = $('#page-video-apercu'), s = $('#page-son-apercu');
  const m = a.mediaId ? etat.medias.get(a.mediaId) : null;
  v.pause(); s.pause();
  v.hidden = !(a.type === 'video' && m);
  s.hidden = !(a.type === 'son' && m);
  if (a.type === 'video' && m) v.src = urlDe(m.blob);
  if (a.type === 'son' && m) s.src = urlDe(m.blob);
  majComposite();
}

function majReglagesVisibles() {
  const t = brouillon.action.type;
  $('#reglages-video').hidden = t !== 'video';
  $('#reglages-son').hidden = t !== 'son';
}

$$('input[name=action]').forEach((r) => (r.onchange = () => {
  brouillon.action.type = r.value;
  brouillon.action.mediaId = r.value === 'video' ? $('#page-video').value || null : r.value === 'son' ? $('#page-son').value || null : null;
  majReglagesVisibles();
  majApercuMedia();
}));
$('#page-video').onchange = (e) => { brouillon.action.mediaId = e.target.value || null; majApercuMedia(); };
$('#page-son').onchange = (e) => { brouillon.action.mediaId = e.target.value || null; majApercuMedia(); };

// options vidéo / son
const pct = (v) => Math.round(v * 100) + ' %';
const lierOption = (id, groupe, cle, fmt) => {
  const el = $(id);
  if (el.type === 'range') {
    lierSortie(el, fmt);
    el.addEventListener('input', () => { if (brouillon) { brouillon.action[groupe][cle] = parseFloat(el.value); majOptionsApercu(groupe); } });
  } else if (el.type === 'checkbox') el.addEventListener('change', () => { brouillon.action[groupe][cle] = el.checked; majOptionsApercu(groupe); });
  else el.addEventListener('input', () => { brouillon.action[groupe][cle] = el.value; majOptionsApercu(groupe); });
};
const majOptionsApercu = (groupe) => { if (groupe === 'video' && apercu && !$('#page-composite').hidden) apercu.definirOptions(brouillon.action.video); };
lierOption('#v-taille', 'video', 'taille', pct);
lierOption('#v-decalage', 'video', 'decalage', (v) => (v > 0 ? '+' : '') + Math.round(v * 100) + ' %');
lierOption('#v-decalage-x', 'video', 'decalageX', (v) => (v > 0 ? '+' : '') + Math.round(v * 100) + ' %');
lierOption('#v-opacite', 'video', 'opacite', pct);
lierOption('#v-boucle', 'video', 'boucle');
lierOption('#v-son', 'video', 'son');
lierOption('#v-debut', 'video', 'debut');
lierOption('#v-chroma', 'video', 'chroma');
lierOption('#v-chroma-couleur', 'video', 'chromaCouleur');
lierOption('#v-chroma-tol', 'video', 'chromaTol', (v) => v.toFixed(2));
lierOption('#s-volume', 'son', 'volume', pct);
lierOption('#s-boucle', 'son', 'boucle');
lierOption('#s-arret', 'son', 'arret');
lierOption('#s-debut', 'son', 'debut');

// image
async function definirImage(source) {
  const r = await recadrer(source);
  if (!r) return;
  brouillon.image = r.blob;
  brouillon.largeur = r.largeur;
  brouillon.hauteur = r.hauteur;
  brouillon.imageVersion = uid();
  rendreApercuImage();
}
$('#page-photo').onclick = async () => {
  if (!navigator.mediaDevices?.getUserMedia) return toast('Caméra non disponible sur cet appareil : importez une image.', true);
  const b = await photographier();
  if (b) definirImage(b);
};
$('#page-fichier-image').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) definirImage(f); };
$('#page-recadrer').onclick = () => brouillon.image && definirImage(brouillon.image);

// médias depuis l'éditeur de page
$('#page-fichier-video').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  attente('Import de la vidéo…');
  try {
    const m = await ajouterMedia({ blob: f, type: 'video', nom: f.name.replace(/\.[^.]+$/, '') });
    brouillon.action.mediaId = m.id;
    rendreSelecteursMedias();
  } catch (err) { toast(err.message, true); }
  attente(false);
};
$('#page-fichier-son').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  const m = await importerSon(f);
  brouillon.action.mediaId = m.id;
  rendreSelecteursMedias();
};
$('#page-enregistrer-son').onclick = async () => {
  const m = await enregistrerSon();
  if (!m) return;
  brouillon.action.mediaId = m.id;
  rendreSelecteursMedias();
};

$('#page-titre').oninput = (e) => (brouillon.titre = e.target.value);
$('#page-supprimer').onclick = async () => {
  if (!confirm(`Supprimer la page « ${brouillon.titre} » ?`)) return;
  livreCourant.pages = livreCourant.pages.filter((p) => p.id !== brouillon.id);
  await enregistrerLivre(livreCourant);
  dlgPage.close('supprime');
};
dlgPage.addEventListener('close', async () => {
  $('#page-video-apercu').pause(); $('#page-son-apercu').pause(); apercu?.arreter();
  if (dlgPage.returnValue !== 'ok' || !brouillon) return;
  brouillon.titre = brouillon.titre.trim() || 'Sans titre';
  const P = livreCourant.pages;
  const i = P.findIndex((p) => p.id === brouillon.id);
  if (i >= 0) P[i] = brouillon; else P.push(brouillon);
  await enregistrerLivre(livreCourant);
  if (brouillon.image && brouillon.action.type !== 'aucune' && !brouillon.action.mediaId) toast('Page enregistrée, mais aucun média choisi pour l\'action.');
  brouillon = null;
});

// =============== Export / partage ===============
let livreExport = null;
function ouvrirExport(livre) {
  livreExport = livre;
  $('#export-etat').textContent = '';
  $('#export-url').value = livre.urlPublique || '';
  majQR();
  $('#dlg-export').showModal();
}
$('#export-fermer').onclick = () => $('#dlg-export').close();
$('#export-zip').onclick = async () => {
  const l = livreExport;
  try {
    if (l.pages.some((p) => p.image) && !ciblesAJour(l)) {
      await preparerCibles(l, (p) => ($('#export-etat').textContent = `Analyse des illustrations… ${Math.round(p)} %`));
    }
    const blob = await exporterLivre(l, (p) => ($('#export-etat').textContent = `Compression… ${Math.round(p)} %`));
    telecharger(blob, `${nomFichier(l.titre)}.zip`);
    $('#export-etat').textContent = `Fichier prêt (${(blob.size / 1e6).toFixed(1).replace('.', ',')} Mo).`;
  } catch (e) { $('#export-etat').textContent = ''; toast(e.message, true); }
};
$('#export-url').oninput = async () => {
  majQR();
  livreExport.urlPublique = $('#export-url').value.trim();
  await enregistrerLivre(livreExport);
};
let qrcode = null;
async function majQR() {
  const url = $('#export-url').value.trim();
  const zone = $('#qr-zone'), lien = $('#qr-telecharger');
  if (!/^https?:\/\/.+/i.test(url)) { zone.innerHTML = ''; lien.hidden = true; return; }
  qrcode ||= (await import('../vendor/qrcode.mjs')).default;
  const base = location.protocol === 'https:' ? location.origin + location.pathname : ADRESSE_PUBLIQUE;
  const cible = `${base}?livre=${encodeURIComponent(url)}`;
  const q = qrcode(0, 'M');
  q.addData(cible);
  q.make();
  const svg = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  zone.innerHTML = svg + `<p class="info" style="word-break:break-all">${echapper(cible)}</p>`;
  lien.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  lien.download = `qr-${nomFichier(livreExport.titre)}.svg`;
  lien.hidden = false;
}

// =============== Lecture AR ===============
async function preparerCibles(livre, surProgression) {
  livre.cible = await analyserCibles(livre, surProgression);
  await enregistrerLivre(livre);
}

let lecteur = null;
async function lire(livre) {
  if (!livre.pages.some((p) => p.image)) return toast('Ajoutez au moins une page avec une illustration.', true);
  if (!navigator.mediaDevices?.getUserMedia) return toast('Caméra indisponible. Sur le web, l\'appli doit être ouverte en https.', true);
  const L = $('#lecture');
  L.hidden = false;
  $('#lecture-titre').textContent = livre.titre;
  $('#viseur').classList.remove('cache');
  $('#bulle-page').hidden = true;
  $('#lecture-camera').hidden = true;
  const btn = $('#demarrer'), prog = $('#demarrage-progression');
  $('#demarrage').hidden = false;
  btn.hidden = true;

  try {
    if (!ciblesAJour(livre)) {
      $('#demarrage-titre').textContent = 'Analyse des illustrations';
      $('#demarrage-texte').textContent = 'Cette étape n\'a lieu qu\'une fois (quelques secondes par illustration).';
      prog.hidden = false; prog.value = 0;
      await preparerCibles(livre, (p) => (prog.value = p));
    }
    prog.hidden = true;
    const { LecteurAR } = await import('./ar.js');
    lecteur = new LecteurAR($('#ar-scene'), livre, etat.medias, {
      surDetection: (page) => {
        $('#viseur').classList.add('cache');
        const b = $('#bulle-page'); b.textContent = page.titre; b.hidden = false;
      },
      surPerte: () => {
        if (!lecteur?.visibles.size) { $('#viseur').classList.remove('cache'); $('#bulle-page').hidden = true; }
      },
    });
    const camMemo = localStorageLire('camera-lecture');
    if (camMemo) lecteur.cameraId = camMemo;
    await lecteur.preparer();
    $('#demarrage-titre').textContent = 'Prêt !';
    $('#demarrage-texte').textContent = 'La caméra va s\'allumer. Montrez ensuite une illustration du livre.';
    btn.hidden = false;
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await lecteur.debloquer();
        try {
          await lecteur.demarrer();
        } catch (e) {
          if (!lecteur.cameraId) throw e;
          lecteur.cameraId = null; // caméra mémorisée absente : on reprend celle par défaut
          lecteur.detruire(); await lecteur.preparer(); await lecteur.demarrer();
        }
        $('#demarrage').hidden = true;
        remplirCameras();
      } catch (e) {
        toast(e.message, true);
      } finally { btn.disabled = false; }
    };
  } catch (e) {
    console.error(e);
    toast('Erreur : ' + e.message, true);
    quitterLecture();
  }
}

async function remplirCameras() {
  const cams = await listerCameras();
  const sel = $('#lecture-camera');
  if (cams.length < 2) { sel.hidden = true; return; }
  const actif = lecteur?.mindar?.video?.srcObject?.getVideoTracks()[0]?.getSettings().deviceId;
  sel.innerHTML = cams.map((c, i) => `<option value="${c.deviceId}" ${c.deviceId === actif ? 'selected' : ''}>${echapper(c.label || 'Caméra ' + (i + 1))}</option>`).join('');
  sel.hidden = false;
  sel.onchange = async () => {
    try { await lecteur.changerCamera(sel.value); localStorageEcrire('camera-lecture', sel.value); }
    catch (e) { toast(e.message, true); }
  };
}

function quitterLecture() {
  try { lecteur?.detruire(); } catch (e) { console.warn(e); }
  lecteur = null;
  $('#lecture').hidden = true;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (livreCourant) rendrePages();
}
$('#lecture-quitter').onclick = quitterLecture;
$('#lecture-plein').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else $('#lecture').requestFullscreen?.().catch(() => {});
};
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#lecture').hidden && !document.fullscreenElement) quitterLecture(); });

function localStorageLire(k) { try { return localStorage.getItem('kla-' + k); } catch { return null; } }
function localStorageEcrire(k, v) { try { localStorage.setItem('kla-' + k, v); } catch { /* ignoré */ } }

// =============== Rafraîchissements ===============
bus.addEventListener('livres', () => { rendreLivres(); if (livreCourant) { livreCourant = livreParId(livreCourant.id) || livreCourant; rendrePages(); } });
bus.addEventListener('medias', () => { if (livreCourant) rendrePages(); if (brouillon && dlgPage.open) rendreSelecteursMedias(); });

// =============== Démarrage ===============
async function demarrer() {
  stockagePersistant();
  await chargerTout();
  initStudio();
  rendreLivres();

  // Ouverture directe : ?livre=<adresse d'un .zip publié>  ou  ?lire=<identifiant local>
  const params = new URLSearchParams(location.search);
  const urlZip = params.get('livre');
  const idLocal = params.get('lire');
  if (urlZip) {
    try {
      attente('Téléchargement du livre…');
      const r = await fetch(urlZip, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`Livre introuvable (${r.status})`);
      const blob = await r.blob();
      const { livre } = await importerLivre(blob, (p) => attente('Installation du livre…', p));
      attente(false);
      history.replaceState(null, '', location.pathname);
      lire(livre);
    } catch (e) {
      attente(false);
      toast(`Impossible d'ouvrir le livre en ligne : ${e.message}`, true);
    }
  } else if (idLocal && livreParId(idLocal)) {
    lire(livreParId(idLocal));
  }
}
demarrer().catch((e) => { console.error(e); toast('Erreur au démarrage : ' + e.message, true); });

// Hors ligne sur le web (pas dans Electron)
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
