// Préparation des vidéos importées : les vidéos de téléphone (HEVC, HDR, 4K, .mov)
// sont souvent noires une fois plaquées en 3D, surtout sur mobile.
// On les ré-encode dans le navigateur : 720p max, couleurs standard (SDR), MP4 H.264 si possible, sinon WebM.
import { contexteAudio } from './audio.js';

const COTE_MAX = 1280;          // plus grand côté après conversion
const DEBIT_VIDEO = 2_500_000;  // 2,5 Mbit/s : suffisant pour l'incrustation fond vert en 720p

/** Faut-il convertir cette vidéo ? Renvoie une raison (texte) ou null */
export async function raisonConversion(fichier) {
  const type = (fichier.type || '').toLowerCase();
  if (!/^video\/(mp4|webm)$/.test(type)) return 'format';
  if (fichier.size > 30e6) return 'poids';
  const d = await lireDimensions(fichier).catch(() => null);
  if (!d) return 'illisible';
  if (Math.max(d.largeur, d.hauteur) > 1920) return 'taille';
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform))) {
    if (Math.max(d.largeur, d.hauteur) > COTE_MAX) return 'mobile';
  }
  return null;
}

function lireDimensions(blob) {
  return new Promise((ok, ko) => {
    const v = document.createElement('video');
    v.preload = 'metadata'; v.muted = true; v.playsInline = true;
    const minuterie = setTimeout(() => ko(new Error('délai')), 10000);
    v.onloadedmetadata = () => { clearTimeout(minuterie); ok({ largeur: v.videoWidth, hauteur: v.videoHeight, duree: v.duration }); };
    v.onerror = () => { clearTimeout(minuterie); ko(new Error('illisible')); };
    v.src = URL.createObjectURL(blob);
  });
}

function typeSortie() {
  const types = [
    'video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E', 'video/mp4',
    'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm',
  ];
  return types.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || null;
}

export const ERREUR_ILLISIBLE = "Ce téléphone ou ce navigateur ne sait pas lire cette vidéo (souvent une vidéo HEVC/H.265 d'iPhone). "
  + "Sur iPhone : Réglages → Appareil photo → Formats → « Le plus compatible », ou partagez la vidéo par e-mail/AirDrop pour l'obtenir en MP4. "
  + "Sinon convertissez-la en MP4 H.264 sur un ordinateur.";

/**
 * Ré-encode la vidéo en temps réel (la durée de la conversion = la durée de la vidéo).
 * @returns {Promise<{blob:Blob, largeur:number, hauteur:number, duree:number, sansSon:boolean}>}
 */
export function convertirVideo(fichier, surProgression = () => {}) {
  return new Promise((ok, ko) => {
    const mime = typeSortie();
    if (!mime || !HTMLCanvasElement.prototype.captureStream) {
      ko(new Error("Ce navigateur ne sait pas convertir les vidéos. Utilisez une vidéo MP4 (H.264) en 720p ou 1080p."));
      return;
    }
    const url = URL.createObjectURL(fichier);
    const v = document.createElement('video');
    v.playsInline = true; v.setAttribute('playsinline', '');
    v.preload = 'auto';
    // vidéo présente dans la page (invisible) : nécessaire sur certains mobiles pour décoder
    Object.assign(v.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0.01', pointerEvents: 'none', zIndex: '-1' });
    document.body.appendChild(v);

    let rec = null, fini = false, anim = 0, audioSrc = null;
    const nettoyer = () => {
      cancelAnimationFrame(anim);
      try { v.pause(); } catch {}
      try { audioSrc?.disconnect(); } catch {}
      v.remove();
      URL.revokeObjectURL(url);
    };
    const echec = (e) => { if (fini) return; fini = true; try { rec?.state !== 'inactive' && rec?.stop(); } catch {} nettoyer(); ko(e); };
    const minuterie = setTimeout(() => echec(new Error(ERREUR_ILLISIBLE)), 15000);

    v.onerror = () => { clearTimeout(minuterie); echec(new Error(ERREUR_ILLISIBLE)); };
    v.onloadeddata = async () => {
      clearTimeout(minuterie);
      if (!v.videoWidth) return echec(new Error(ERREUR_ILLISIBLE));
      const k = Math.min(1, COTE_MAX / Math.max(v.videoWidth, v.videoHeight));
      const L = Math.round(v.videoWidth * k / 2) * 2, H = Math.round(v.videoHeight * k / 2) * 2;
      const toile = document.createElement('canvas');
      toile.width = L; toile.height = H;
      const g = toile.getContext('2d');
      g.drawImage(v, 0, 0, L, H);

      const flux = toile.captureStream(30);
      // Son : on le fait passer par Web Audio, sans le brancher sur les haut-parleurs
      let sansSon = false;
      try {
        const ac = contexteAudio();
        audioSrc = ac.createMediaElementSource(v);
        const dest = ac.createMediaStreamDestination();
        audioSrc.connect(dest);
        dest.stream.getAudioTracks().forEach((t) => flux.addTrack(t));
      } catch { sansSon = true; }

      try {
        rec = new MediaRecorder(flux, { mimeType: mime, videoBitsPerSecond: DEBIT_VIDEO, audioBitsPerSecond: 128_000 });
      } catch {
        rec = new MediaRecorder(flux);
      }
      const morceaux = [];
      rec.ondataavailable = (e) => e.data.size && morceaux.push(e.data);
      rec.onstop = () => {
        if (fini) return;
        fini = true;
        nettoyer();
        const type = (rec.mimeType || mime).split(';')[0];
        const blob = new Blob(morceaux, { type });
        if (blob.size < 1000) return ko(new Error('La conversion a échoué (vidéo vide).'));
        ok({ blob, largeur: L, hauteur: H, duree: v.duration, sansSon });
      };

      const peindre = () => {
        g.drawImage(v, 0, 0, L, H);
        if (v.duration) surProgression(Math.min(99, (v.currentTime / v.duration) * 100));
        if (!v.ended && !fini) anim = requestAnimationFrame(peindre);
      };
      v.onended = () => { g.drawImage(v, 0, 0, L, H); setTimeout(() => rec.state !== 'inactive' && rec.stop(), 150); };

      v.currentTime = 0;
      rec.start(500);
      try {
        await v.play();
      } catch {
        // lecture avec son refusée (pas de geste utilisateur) : on convertit sans le son
        v.muted = true; sansSon = true;
        try { await v.play(); } catch (e) { return echec(new Error(ERREUR_ILLISIBLE)); }
      }
      peindre();
    };
    v.src = url;
    v.load();
  });
}
