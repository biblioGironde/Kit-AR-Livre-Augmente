// Moteur audio : enregistrement micro, décodage, rendu d'un montage, export WAV
import { $, toast } from './outils.js';

let ctxAudio = null;
export function contexteAudio() {
  if (!ctxAudio) ctxAudio = new (window.AudioContext || window.webkitAudioContext)();
  if (ctxAudio.state === 'suspended') ctxAudio.resume();
  return ctxAudio;
}

// ---------- décodage avec cache ----------
const cacheTampons = new Map(); // mediaId -> Promise<AudioBuffer>
export function decoder(media) {
  if (!cacheTampons.has(media.id)) {
    cacheTampons.set(media.id, media.blob.arrayBuffer().then((ab) => new Promise((ok, ko) => {
      // forme callback pour compatibilité Safari ancienne
      contexteAudio().decodeAudioData(ab, ok, () => ko(new Error(`Impossible de décoder « ${media.nom} »`)));
    })));
  }
  return cacheTampons.get(media.id).catch((e) => { cacheTampons.delete(media.id); throw e; });
}
export function oublier(id) { cacheTampons.delete(id); }

// ---------- enregistrement micro ----------
export function enregistrerMicro() {
  const dlg = $('#dlg-micro');
  const bouton = $('#micro-bouton');
  const temps = $('#micro-temps');
  const niveau = $('#micro-niveau');
  const choix = $('#micro-choix');
  const g = niveau.getContext('2d');

  return new Promise(async (ok) => {
    let flux = null, rec = null, morceaux = [], debut = 0, anim = 0, analyse = null, fini = false;

    const arreterFlux = () => { cancelAnimationFrame(anim); flux?.getTracks().forEach((t) => t.stop()); flux = null; };
    const terminer = (v) => { if (fini) return; fini = true; arreterFlux(); dlg.classList.remove('micro-enregistre'); dlg.close(); ok(v); };

    async function ouvrir(deviceId) {
      arreterFlux();
      flux = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: true } : { echoCancellation: false, noiseSuppression: true },
      });
      const ac = contexteAudio();
      analyse = ac.createAnalyser();
      analyse.fftSize = 1024;
      ac.createMediaStreamSource(flux).connect(analyse);
      dessinerNiveau();
    }
    const donnees = new Float32Array(1024);
    function dessinerNiveau() {
      analyse.getFloatTimeDomainData(donnees);
      let crete = 0;
      for (const v of donnees) crete = Math.max(crete, Math.abs(v));
      const W = niveau.width, H = niveau.height;
      g.clearRect(0, 0, W, H);
      g.fillStyle = crete > 0.95 ? '#b3261e' : crete > 0.6 ? '#e0703a' : '#2f7d63';
      g.fillRect(0, 0, Math.min(1, crete * 1.2) * W, H);
      if (rec?.state === 'recording') {
        const s = (performance.now() - debut) / 1000;
        temps.textContent = `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
      }
      anim = requestAnimationFrame(dessinerNiveau);
    }

    $('#micro-annuler').onclick = () => { if (rec?.state === 'recording') rec.onstop = null, rec.stop(); terminer(null); };
    dlg.oncancel = (e) => { e.preventDefault(); $('#micro-annuler').click(); };
    temps.textContent = '0:00';
    bouton.textContent = '● Commencer';
    dlg.showModal();

    try { await ouvrir(); } catch (e) { toast("Micro inaccessible : " + e.message, true); return terminer(null); }
    const micros = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    const actif = flux.getAudioTracks()[0]?.getSettings().deviceId;
    choix.innerHTML = micros.map((m, i) => `<option value="${m.deviceId}" ${m.deviceId === actif ? 'selected' : ''}>${m.label || 'Micro ' + (i + 1)}</option>`).join('');
    choix.hidden = micros.length < 2;
    choix.onchange = () => ouvrir(choix.value).catch((e) => toast(e.message, true));

    bouton.onclick = () => {
      if (!rec || rec.state === 'inactive') {
        const types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
        const mimeType = types.find((t) => window.MediaRecorder?.isTypeSupported?.(t));
        rec = new MediaRecorder(flux, mimeType ? { mimeType } : undefined);
        morceaux = [];
        rec.ondataavailable = (e) => e.data.size && morceaux.push(e.data);
        rec.onstop = () => terminer(new Blob(morceaux, { type: rec.mimeType || 'audio/webm' }));
        rec.start(250);
        debut = performance.now();
        dlg.classList.add('micro-enregistre');
        bouton.textContent = '■ Arrêter';
        choix.disabled = true;
      } else {
        rec.stop();
      }
    };
  });
}

// ---------- rendu d'un montage ----------
/**
 * montage = { segments:[{mediaId, debut, fin}], fond:{mediaId, volume, boucle}|null,
 *             fonduEntree, fonduSortie, gain, normaliser }
 * medias = Map id -> media
 */
export async function rendreMontage(montage, medias) {
  const SR = 44100;
  const segs = [];
  for (const s of montage.segments) {
    const m = medias.get(s.mediaId);
    if (!m) continue;
    const buf = await decoder(m);
    const debut = Math.max(0, Math.min(s.debut ?? 0, buf.duration));
    const fin = Math.max(debut, Math.min(s.fin ?? buf.duration, buf.duration));
    if (fin - debut > 0.01) segs.push({ buf, debut, fin });
  }
  if (!segs.length) throw new Error('Le montage est vide');
  let fondBuf = null;
  if (montage.fond?.mediaId && medias.get(montage.fond.mediaId)) fondBuf = await decoder(medias.get(montage.fond.mediaId));

  const total = segs.reduce((a, s) => a + (s.fin - s.debut), 0);
  const canaux = Math.max(...segs.map((s) => s.buf.numberOfChannels), fondBuf?.numberOfChannels || 1) > 1 ? 2 : 1;
  const off = new OfflineAudioContext(canaux, Math.ceil(total * SR), SR);

  const maitre = off.createGain();
  maitre.connect(off.destination);
  const g = montage.gain ?? 1;
  const fe = Math.min(montage.fonduEntree || 0, total / 2);
  const fs = Math.min(montage.fonduSortie || 0, total / 2);
  maitre.gain.setValueAtTime(fe > 0 ? 0 : g, 0);
  if (fe > 0) maitre.gain.linearRampToValueAtTime(g, fe);
  if (fs > 0) { maitre.gain.setValueAtTime(g, total - fs); maitre.gain.linearRampToValueAtTime(0, total); }

  // séquence, avec micro-fondus de 8 ms pour éviter les clics aux raccords
  let t = 0;
  const MICRO = 0.008;
  for (const s of segs) {
    const d = s.fin - s.debut;
    const src = off.createBufferSource();
    src.buffer = s.buf;
    const gs = off.createGain();
    gs.gain.setValueAtTime(0, t);
    gs.gain.linearRampToValueAtTime(1, t + Math.min(MICRO, d / 2));
    gs.gain.setValueAtTime(1, t + d - Math.min(MICRO, d / 2));
    gs.gain.linearRampToValueAtTime(0, t + d);
    src.connect(gs).connect(maitre);
    src.start(t, s.debut, d);
    t += d;
  }
  // fond sonore
  if (fondBuf) {
    const src = off.createBufferSource();
    src.buffer = fondBuf;
    src.loop = !!montage.fond.boucle;
    const gf = off.createGain();
    gf.gain.value = montage.fond.volume ?? 0.35;
    src.connect(gf).connect(maitre);
    src.start(0);
  }

  const rendu = await off.startRendering();
  if (montage.normaliser) {
    let crete = 0;
    for (let c = 0; c < rendu.numberOfChannels; c++) {
      const d = rendu.getChannelData(c);
      for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > crete) crete = a; }
    }
    if (crete > 0.0001) {
      const k = 0.95 / crete;
      for (let c = 0; c < rendu.numberOfChannels; c++) {
        const d = rendu.getChannelData(c);
        for (let i = 0; i < d.length; i++) d[i] *= k;
      }
    }
  }
  return rendu;
}

// ---------- encodage WAV 16 bits ----------
export function versWav(buffer) {
  const nc = buffer.numberOfChannels, sr = buffer.sampleRate, n = buffer.length;
  const octets = n * nc * 2;
  const ab = new ArrayBuffer(44 + octets);
  const v = new DataView(ab);
  const ecr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ecr(0, 'RIFF'); v.setUint32(4, 36 + octets, true); ecr(8, 'WAVE');
  ecr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * nc * 2, true); v.setUint16(32, nc * 2, true); v.setUint16(34, 16, true);
  ecr(36, 'data'); v.setUint32(40, octets, true);
  const canaux = [...Array(nc)].map((_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nc; c++) {
      const s = Math.max(-1, Math.min(1, canaux[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

// ---------- lecture d'aperçu ----------
let sourceApercu = null;
export function jouerTampon(buffer, debut = 0, fin = buffer.duration, surFin) {
  arreterApercu();
  const ac = contexteAudio();
  const src = ac.createBufferSource();
  src.buffer = buffer;
  src.connect(ac.destination);
  src.onended = () => { if (sourceApercu === src) { sourceApercu = null; surFin?.(); } };
  src.start(0, debut, Math.max(0, fin - debut));
  sourceApercu = src;
  const t0 = ac.currentTime;
  return { position: () => debut + (ac.currentTime - t0) };
}
export function arreterApercu() {
  if (sourceApercu) { const s = sourceApercu; sourceApercu = null; try { s.stop(); } catch {} }
}
export const apercuEnCours = () => !!sourceApercu;

// ---------- crêtes pour dessiner une forme d'onde ----------
export function cretes(buffer, nb) {
  const d = buffer.getChannelData(0);
  const d2 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const pas = Math.max(1, Math.floor(d.length / nb));
  const out = new Float32Array(nb);
  for (let i = 0; i < nb; i++) {
    let m = 0;
    const a = i * pas, b = Math.min(d.length, a + pas);
    for (let j = a; j < b; j += 4) {
      const x = Math.abs(d[j]) + (d2 ? Math.abs(d2[j]) : 0);
      if (x > m) m = x;
    }
    out[i] = d2 ? m / 2 : m;
  }
  return out;
}
