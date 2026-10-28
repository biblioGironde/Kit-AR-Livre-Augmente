// Plan vidéo posé sur l'illustration — partagé par la lecture AR et l'aperçu de l'éditeur,
// pour que l'aperçu soit exactement ce qu'on verra dans le livre.
// Repère : l'illustration fait 1 de large et `ratioCible` de haut, centrée sur l'origine.
import * as THREE from 'three';

const VERTEX = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Incrustation : distance en chrominance (Cb/Cr) à la couleur de fond, bord adouci, anti-débordement vert
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
    if (a < 1.0) { float m = (c.r + c.b) * 0.5; c.g = min(c.g, m + (c.g - m) * a); }
  }
  gl_FragColor = vec4(c.rgb, a * opacite);
}`;

export function hexVersVec3(hex) {
  const n = parseInt(String(hex || '#00ff00').replace('#', ''), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/**
 * @param {HTMLVideoElement} video
 * @param {{largeur:number,hauteur:number}} media  dimensions de la vidéo
 * @param {number} ratioCible  hauteur / largeur de l'illustration
 * @returns {{mesh, texture, maj:(opts)=>void, dispose:()=>void}}
 */
export function creerPlanVideo(video, media, ratioCible) {
  const texture = new THREE.VideoTexture(video);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const materiau = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      cle: { value: hexVersVec3('#00ff00') },
      tolerance: { value: 0.25 },
      douceur: { value: 0.08 },
      opacite: { value: 1 },
      chroma: { value: false },
    },
    vertexShader: VERTEX, fragmentShader: FRAGMENT,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), materiau);
  mesh.position.z = 0.01;

  // Taille 100 % = la vidéo tient entièrement dans l'illustration
  const ratioVideo = media?.largeur ? media.hauteur / media.largeur : 9 / 16;
  let l = 1, h = ratioVideo;
  if (h > ratioCible) { h = ratioCible; l = ratioCible / ratioVideo; }

  function maj(o) {
    const t = o.taille ?? 1;
    mesh.scale.set(l * t, h * t, 1);
    mesh.position.x = (o.decalageX || 0);
    mesh.position.y = (o.decalage || 0) * ratioCible;
    const u = materiau.uniforms;
    u.cle.value = hexVersVec3(o.chromaCouleur);
    u.tolerance.value = o.chromaTol ?? 0.25;
    u.opacite.value = o.opacite ?? 1;
    u.chroma.value = !!o.chroma;
  }

  return {
    mesh, texture, maj,
    taillePlan: () => ({ l: mesh.scale.x, h: mesh.scale.y }),
    dispose() { texture.dispose(); materiau.dispose(); mesh.geometry.dispose(); },
  };
}
