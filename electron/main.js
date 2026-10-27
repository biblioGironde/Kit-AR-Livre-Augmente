// Kit Livre Augmenté — application de bureau (Electron)
// L'appli web (dossier www/) est servie par un protocole interne app:// :
// origine stable (les livres restent en mémoire d'une session à l'autre) et contexte sécurisé (caméra, micro).
const { app, BrowserWindow, protocol, session, systemPreferences, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs/promises');

const RACINE = path.join(__dirname, '..', 'www');
const ORIGINE = 'app://kit';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.zip': 'application/zip',
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

// Le nom accentué de l'appli finit dans l'en-tête User-Agent, qui doit rester en ASCII
app.userAgentFallback = app.userAgentFallback.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '');

// Une seule instance à la fois
if (!app.requestSingleInstanceLock()) app.quit();

function creerFenetre() {
  const win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 720, minHeight: 560,
    title: 'Kit Livre Augmenté',
    backgroundColor: '#f7f2e8',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  // Liens externes (aide, GitHub…) dans le navigateur
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGINE)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
  win.loadURL(`${ORIGINE}/index.html`);
  return win;
}

app.whenReady().then(async () => {
  protocol.handle('app', async (requete) => {
    const url = new URL(requete.url);
    let chemin = decodeURIComponent(url.pathname);
    if (chemin === '/' || chemin === '') chemin = '/index.html';
    const fichier = path.normalize(path.join(RACINE, chemin));
    if (!fichier.startsWith(RACINE)) return new Response('Interdit', { status: 403 });
    try {
      const donnees = await fs.readFile(fichier);
      return new Response(donnees, { headers: { 'content-type': TYPES[path.extname(fichier).toLowerCase()] || 'application/octet-stream' } });
    } catch {
      return new Response('Introuvable', { status: 404 });
    }
  });

  // Caméra et micro autorisés uniquement pour l'appli elle-même
  const permises = new Set(['media', 'fullscreen', 'clipboard-sanitized-write', 'persistent-storage']);
  session.defaultSession.setPermissionRequestHandler((wc, permission, rappel, details) => {
    rappel(permises.has(permission) && (details.requestingUrl || '').startsWith(ORIGINE));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, origine) => permises.has(permission) && (origine || '').startsWith(ORIGINE));

  if (process.platform === 'darwin') {
    try {
      await systemPreferences.askForMediaAccess('camera');
      await systemPreferences.askForMediaAccess('microphone');
    } catch { /* l'utilisateur pourra autoriser plus tard dans les Réglages */ }
  } else {
    Menu.setApplicationMenu(null);
  }

  creerFenetre();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) creerFenetre(); });
});

app.on('second-instance', () => {
  const w = BrowserWindow.getAllWindows()[0];
  if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
