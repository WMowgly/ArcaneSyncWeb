// tests/e2e/_outils.js
// ---------------------------------------------------------------------------
// Outils des contrôles de bout en bout (navigateur réel, sans interface).
//
//   - bac à sable : copie des données dans un dossier temporaire ;
//   - serveur : une instance dédiée (port 3100 par défaut), jamais celle de
//     la partie en cours ;
//   - navigateur : Edge ou Chrome sans interface, piloté par le protocole
//     DevTools (module ws, déjà installé avec socket.io).
// ---------------------------------------------------------------------------
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const RACINE = path.join(__dirname, '..', '..');
const PORT = Number(process.env.ARCANESYNC_E2E_PORT) || 3100;
const PORT_DEBUG = Number(process.env.ARCANESYNC_E2E_PORT_DEBUG) || 9290;
const BASE = `http://localhost:${PORT}`;
const pause = ms => new Promise(r => setTimeout(r, ms));

// --- Bac à sable -----------------------------------------------------------------
function creerBac() {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'arcanesync-e2e-'));
  ['data.json', 'session.json', 'maps.json', 'mob_templates.json', 'tableau.json'].forEach(nom => {
    const source = path.join(RACINE, nom);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(dossier, nom));
  });
  fs.mkdirSync(path.join(dossier, 'database'));
  ['game_database.json', 'sorts.json'].forEach(nom =>
    fs.copyFileSync(path.join(RACINE, 'database', nom), path.join(dossier, 'database', nom)));
  return dossier;
}

// --- Serveur -----------------------------------------------------------------------
async function demarrerServeur(dossierDonnees) {
  const env = { ...process.env, PORT: String(PORT), ARCANESYNC_DATA_DIR: dossierDonnees };
  delete env.ARCANESYNC_MJ_CODE;
  const processus = spawn(process.execPath, ['server.js'], { cwd: RACINE, env, stdio: ['ignore', 'ignore', 'pipe'] });
  let erreurs = '';
  processus.stderr.on('data', d => { erreurs += d; });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${BASE}/api/mj/statut`)).ok) return processus; } catch (_) { /* pas encore prêt */ }
    if (processus.exitCode !== null) break;
    await pause(150);
  }
  processus.kill();
  throw new Error(`Le serveur de test ne démarre pas sur le port ${PORT}.\n${erreurs}`);
}

async function arreterServeur(processus) {
  if (!processus || processus.exitCode !== null) return;
  const fin = new Promise(r => processus.once('exit', r));
  processus.kill();
  await Promise.race([fin, pause(3000)]);
}

// --- Navigateur ----------------------------------------------------------------------
function trouverNavigateur() {
  const candidats = [
    process.env.ARCANESYNC_NAVIGATEUR,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);
  return candidats.find(c => fs.existsSync(c)) || null;
}

async function lancerNavigateur() {
  const executable = trouverNavigateur();
  if (!executable) {
    throw new Error('Aucun navigateur Edge/Chrome trouvé (indiquer son chemin dans ARCANESYNC_NAVIGATEUR).');
  }
  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'arcanesync-e2e-profil-'));
  const processus = spawn(executable, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${PORT_DEBUG}`, `--user-data-dir=${profil}`, 'about:blank'
  ], { stdio: 'ignore' });

  let cible = null;
  for (let i = 0; i < 60 && !cible; i++) {
    try {
      cible = (await (await fetch(`http://localhost:${PORT_DEBUG}/json`)).json()).find(t => t.type === 'page');
    } catch (_) { /* pas encore prêt */ }
    if (!cible) await pause(250);
  }
  if (!cible) { processus.kill(); throw new Error('Le navigateur ne répond pas au protocole DevTools.'); }

  const ws = new WebSocket(cible.webSocketDebuggerUrl);
  await new Promise((ok, ko) => { ws.once('open', ok); ws.once('error', ko); });

  let numero = 0;
  const attente = new Map();
  const dialogues = [];
  let reponseInvite = '';
  ws.on('message', brut => {
    const message = JSON.parse(brut);
    if (message.id && attente.has(message.id)) {
      attente.get(message.id)(message);
      attente.delete(message.id);
    }
    // alert / confirm / prompt : acceptés, le texte est mémorisé.
    if (message.method === 'Page.javascriptDialogOpening') {
      dialogues.push(message.params.message);
      ws.send(JSON.stringify({
        id: ++numero, method: 'Page.handleJavaScriptDialog',
        params: { accept: true, promptText: reponseInvite }
      }));
    }
  });

  // Une évaluation interrompue par une navigation peut ne jamais répondre.
  const cdp = (method, params = {}) => new Promise(r => {
    const id = ++numero;
    attente.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (attente.has(id)) { attente.delete(id); r({}); } }, 10000);
  });

  const page = {
    BASE,
    dialogues,
    cdp,
    repondreAuxInvites: texte => { reponseInvite = texte; },
    async evaluer(expression) {
      const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) {
        throw new Error(r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails));
      }
      return r.result?.result?.value;
    },
    async attendre(expression, essais = 60) {
      for (let i = 0; i < essais; i++) {
        try { if (await page.evaluer(expression)) return true; } catch (_) { /* page en chargement */ }
        await pause(250);
      }
      return false;
    },
    async ouvrir(chemin) {
      await cdp('Page.navigate', { url: `${BASE}/${chemin}` });
      await page.attendre("document.readyState === 'complete'", 40);
    },
    /**
     * Exécute une action qui change de page, puis attend la NOUVELLE page :
     * un repère posé sur l'ancienne doit avoir disparu. Sans cela, une
     * condition déjà vraie sur l'ancienne page passerait avant le rechargement.
     */
    async naviguerPar(expressionAction, condition = 'true') {
      await page.evaluer('window.__ancienne_page = true');
      await page.evaluer(expressionAction);
      return page.attendre(`!window.__ancienne_page && document.readyState === 'complete' && (${condition})`, 80);
    },
    async largeur(pixels) {
      await cdp('Emulation.setDeviceMetricsOverride',
        { width: pixels, height: 1000, deviceScaleFactor: 1, mobile: pixels < 600 });
      await pause(400);
    },
    async souris(type, x, y) {
      await cdp('Input.dispatchMouseEvent',
        { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
    },
    /** Vrai clic souris au centre d'un élément. */
    async cliquer(selecteur) {
      const [x, y] = await page.evaluer(`(() => { const r = document.querySelector(${JSON.stringify(selecteur)}).getBoundingClientRect();
        return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
      await page.souris('mousePressed', x, y);
      await page.souris('mouseReleased', x, y);
    },
    async taper(selecteur, texte) {
      await page.cliquer(selecteur);
      await cdp('Input.insertText', { text: texte });
    },
    async capture(nom, selecteur) {
      if (!process.env.ARCANESYNC_E2E_CAPTURES) return;
      if (selecteur) await page.evaluer(`document.querySelector(${JSON.stringify(selecteur)})?.scrollIntoView({ block: 'start' })`);
      await pause(300);
      const image = await cdp('Page.captureScreenshot', { format: 'png' });
      const dossier = process.env.ARCANESYNC_E2E_CAPTURES;
      fs.mkdirSync(dossier, { recursive: true });
      fs.writeFileSync(path.join(dossier, nom), Buffer.from(image.result.data, 'base64'));
    }
  };

  await cdp('Page.enable');
  await page.largeur(1500);

  return {
    page,
    async fermer() {
      try { ws.close(); } catch (_) { /* déjà fermé */ }
      // Fermeture par DevTools : tuer le processus lancé ne suffit pas sous
      // Windows (le navigateur continue sous un autre processus).
      try {
        const version = await (await fetch(`http://localhost:${PORT_DEBUG}/json/version`)).json();
        const navigateurWs = new WebSocket(version.webSocketDebuggerUrl);
        await new Promise((ok, ko) => { navigateurWs.once('open', ok); navigateurWs.once('error', ko); });
        navigateurWs.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
        await pause(800);
      } catch (_) { /* déjà fermé */ }
      processus.kill();
      await pause(500);
      try { fs.rmSync(profil, { recursive: true, force: true }); } catch (_) { /* fichiers encore verrouillés */ }
    }
  };
}

// --- Appels directs à l'API ---------------------------------------------------------------
function api(methode, route, corps, { code, role } = {}) {
  const entetes = { 'Content-Type': 'application/json' };
  if (code) entetes['X-ArcaneSync-MJ'] = code;
  if (role) entetes['X-ArcaneSync-Role'] = role;
  return fetch(`${BASE}${route}`, { method: methode, headers: entetes, body: corps ? JSON.stringify(corps) : undefined })
    .then(async r => ({ statut: r.status, donnees: await r.json().catch(() => null) }));
}

module.exports = { BASE, PORT, pause, creerBac, demarrerServeur, arreterServeur, lancerNavigateur, api };
