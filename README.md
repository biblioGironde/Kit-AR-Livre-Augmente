# Kit Livre Augmenté

Faire parler les illustrations d'un livre : on photographie une illustration, on lui associe une **vidéo en réalité augmentée** (qui vient se poser sur la page, fond vert transparent possible) ou un **son** (importé, enregistré au micro, monté dans l'appli). Pendant la lecture, il suffit de montrer le livre à la caméra.

- **Appli web** : https://bibliogironde.github.io/Kit-AR-Livre-Augmente/ (tablettes, téléphones, postes publics — https obligatoire pour la caméra)
- **Applis de bureau** (Electron) : macOS, Windows, Linux, dans les [releases](https://github.com/biblioGironde/Kit-AR-Livre-Augmente/releases)

Tout reste dans l'appareil (IndexedDB). Rien n'est envoyé sur Internet.

## Fonctionnalités

| | |
|---|---|
| **Livres et pages** | Une page = une illustration. Photo depuis la caméra de l'appli ou import d'image, recadrage, rotation. |
| **Vidéo AR** | Vidéo plaquée sur l'illustration et suivie en temps réel. Taille, décalage vertical, opacité, boucle, son, reprise au début, **incrustation fond vert** (couleur et tolérance réglables). |
| **Son** | Volume, boucle, arrêt quand l'illustration sort du champ ou lecture jusqu'au bout. |
| **Studio son** | Sonothèque (import MP3/WAV/OGG…, enregistrement micro avec vumètre), montage : enchaîner plusieurs morceaux, couper chaque morceau sur la forme d'onde, fond sonore mixé, fondus, volume, normalisation → export WAV dans la sonothèque. |
| **Partage** | Export d'un livre complet en `.zip` (illustrations, médias, cibles déjà analysées) et import sur un autre appareil. QR code de lecture directe vers un `.zip` publié en ligne. |
| **Hors ligne** | Service worker sur le web ; l'appli de bureau est entièrement autonome. |

## Utilisation

1. **Mes livres → Nouveau livre**, puis **+ Ajouter une page** pour chaque illustration.
2. **Photographier** l'illustration à plat, de près, sans reflet, puis recadrer sur l'image seule.
3. Choisir l'action : vidéo ou son.
4. **Lire en réalité augmentée** : la première fois, l'appli analyse les illustrations (quelques secondes chacune), puis la caméra s'allume.

Conseils : les illustrations riches en détails et contrastées sont les mieux reconnues ; éviter les aplats, les ciels unis et deux doubles pages trop semblables.

### Publier un livre avec un QR code

1. Exporter le livre (`.zip`) et le déposer dans `www/livres/` du dépôt.
2. Après publication sur GitHub Pages, coller l'adresse du `.zip` dans **Exporter / partager** : le QR code généré ouvre `…/Kit-AR-Livre-Augmente/?livre=<adresse>` qui installe le livre et lance la lecture.

## Développement

```bash
npm install
npm start        # appli de bureau
npm run web      # appli web sur http://localhost:8080 (localhost compte comme https pour la caméra)
```

Pas de bundler : `www/` est servi tel quel. Les librairies sont embarquées dans `www/vendor/` pour fonctionner hors ligne.

```
www/
  index.html, css/app.css, manifest.webmanifest, sw.js
  js/app.js        interface (livres, pages, export, lecture)
  js/etat.js       état partagé + modèle de données
  js/db.js         IndexedDB
  js/photo.js      prise de vue + recadrage
  js/audio.js      enregistrement, mixage hors ligne, export WAV
  js/studio.js     sonothèque et montage
  js/cibles.js     analyse des illustrations (compilateur MindAR)
  js/ar.js         lecture AR (MindAR + three.js, shader d'incrustation)
  js/archive.js    export / import .zip
  livres/          .zip publiés (QR codes)
  vendor/          MindAR 1.2.5, three.js r160, JSZip, qrcode-generator
electron/main.js   fenêtre, protocole app:// (origine stable + contexte sécurisé), autorisations caméra/micro
```

## Publication

- **GitHub Pages** : *Settings → Pages → Source : GitHub Actions*. Le workflow `pages.yml` publie `www/` à chaque push sur `main`.
- **Releases** : `git tag v1.0.0 && git push --tags` → le workflow `release.yml` construit et joint à la release : `.dmg` (Apple Silicon et Intel), installateur `.exe` + version portable Windows, `.AppImage` et `.deb` Linux.

Les applis ne sont pas signées :
- **macOS** : clic droit → *Ouvrir* la première fois (ou `xattr -cr "/Applications/Kit Livre Augmenté.app"`). Autoriser caméra et micro quand macOS le demande.
- **Windows** : SmartScreen → *Informations complémentaires* → *Exécuter quand même*.

## Licences

Code du kit : MIT. MindAR (MIT), three.js (MIT), JSZip (MIT/GPLv3), qrcode-generator (MIT).
