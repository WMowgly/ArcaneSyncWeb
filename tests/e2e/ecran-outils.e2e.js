// Outils de l'Écran (V2.4) : rideau baissé par le MJ, « ping » (Alt + clic
// sur la carte MJ), créatures mortes sautées et barrées dans l'initiative.
module.exports = {
  nom: 'Écran : rideau, ping, créatures mortes dans l\'initiative',
  async executer({ page, verifier, api, definirCodeMj, lireJson }) {
    const mj = await definirCodeMj();
    const [premier, second] = lireJson('data.json');
    const mapId = (await api('GET', '/api/map/active', null, mj)).donnees.activeMapId;

    // --- Rideau ------------------------------------------------------------------------------
    await page.ouvrir('ecran.html');
    await page.attendre("document.getElementById('ecran-statut').textContent.includes('Synchronisé')", 30);
    verifier(await page.evaluer("document.getElementById('rideau').hidden"), 'rideau : levé par défaut');
    await api('POST', '/api/ecran', { rideau: true }, mj);
    verifier(await page.attendre("!document.getElementById('rideau').hidden", 20), 'rideau : baissé par le MJ, l\'Écran masque tout');
    verifier(await page.evaluer(`(() => { const r = document.getElementById('rideau').getBoundingClientRect();
        return r.width >= innerWidth - 1 && r.height >= innerHeight - 1 && getComputedStyle(document.getElementById('rideau')).zIndex >= 100; })()`),
      'rideau : couvre toute la fenêtre (nom de la carte compris)');
    await page.capture('ecran-rideau.png');
    verifier((await api('POST', '/api/ecran', { rideau: false })).statut === 403, 'rideau : réservé au MJ');

    // Bouton du sélecteur commun (carte MJ) : lève le rideau.
    await page.ouvrir('map.html');
    await page.attendre("document.querySelector('#choix-ecran [data-ecran-rideau]')?.getAttribute('aria-pressed') === 'true'", 30);
    await page.cliquer('#choix-ecran [data-ecran-rideau]');
    await page.attendre('false', 2);
    verifier((await api('GET', '/api/ecran')).donnees.rideau === false, 'carte MJ : « 🎭 Rideau » lève le rideau');
    await page.cliquer('#choix-ecran [data-ecran-rideau]');
    await page.attendre('false', 2);
    verifier((await api('GET', '/api/ecran')).donnees.rideau === true
      && await page.evaluer("document.querySelector('#choix-ecran [data-ecran-rideau]').textContent.includes('baissé')"),
      'carte MJ : « 🎭 Rideau » le rebaisse, le bouton l\'indique');
    await api('POST', '/api/ecran', { rideau: false }, mj);

    // --- Ping : Alt + clic sur la carte MJ ---------------------------------------------------------
    await page.attendre('!!window.ArcaneRendu?.state.map', 30);
    const [px, py] = await page.evaluer(`(() => {
      const r = window.ArcaneRendu; const g = r.state.map.grid; const rect = r.canvas.getBoundingClientRect();
      const echelle = rect.width / (g.cols * g.cellSize + 22);
      return [rect.left + (22 + 6.5 * g.cellSize) * echelle, rect.top + (22 + 4.5 * g.cellSize) * echelle]; })()`);
    await page.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'left', buttons: 1, clickCount: 1, modifiers: 1 });
    await page.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px, y: py, button: 'left', buttons: 0, clickCount: 1, modifiers: 1 });
    verifier(await page.attendre('window.ArcaneRendu.state.pings.length === 1', 10), 'carte MJ : Alt + clic montre le ping sur la carte du MJ');
    const ping = await page.evaluer('window.ArcaneRendu.state.pings[0]');
    verifier(Math.abs(ping.x - 6.5) < 0.6 && Math.abs(ping.y - 4.5) < 0.6, `ping : à l'endroit cliqué (${ping.x.toFixed(1)}, ${ping.y.toFixed(1)})`);
    verifier(await page.attendre('window.ArcaneRendu.state.pings.length === 0', 30), 'ping : s\'efface après quelques secondes');

    // L'Écran le reçoit ; un joueur ne peut pas en envoyer.
    await page.ouvrir('ecran.html');
    await page.attendre('!!window.ArcaneRendu?.state.map', 30);
    const envoyer = (role, auth) => page.evaluer(`new Promise(resoudre => {
      const s = io({ query: { role: '${role}' }${auth ? `, auth: rappel => rappel({ mjCode: '${mj.code}' })` : ''} });
      s.on('connect', () => { s.emit('mapPing', { x: 3.5, y: 2.5 }); setTimeout(() => { s.close(); resoudre(true); }, 300); });
    })`);
    await envoyer('player', false);
    await page.attendre('false', 2);
    verifier(await page.evaluer('window.ArcaneRendu.state.pings.length === 0'), 'ping : refusé à un joueur');
    await envoyer('mj', true);
    verifier(await page.attendre('window.ArcaneRendu.state.pings.length === 1', 10), 'Écran : le ping du MJ apparaît (cercle pulsant)');
    await page.attendre('false', 3);
    await page.capture('ecran-ping.png');

    // --- Initiative : créature morte sautée et barrée ---------------------------------------------
    const mort = (await api('POST', '/api/mobs', { nom: 'Squelette brisé', hp: { max: 8, current: 0 } }, mj)).donnees.mob;
    await api('POST', '/api/initiative/demarrer', { entrees: [
      { kind: 'player', entityId: premier.id, nom: premier.nom, valeur: 20 },
      { kind: 'mob', entityId: mort.id, nom: mort.nom, valeur: 15 },
      { kind: 'player', entityId: second.id, nom: second.nom, valeur: 10 }
    ] }, mj);
    verifier(await page.attendre("[...document.querySelectorAll('#initiative-ordre li.hors-jeu')].some(li => li.textContent.includes('Squelette brisé'))", 20),
      'Écran : la créature morte est barrée dans l\'initiative');
    await api('POST', '/api/initiative/suivant', {}, mj);
    verifier(await page.attendre(`window.ArcaneRendu.state.actifId === 'player:${second.id}'`, 20), 'Écran : « Suivant » saute la créature morte');

    await page.ouvrir('mj.html');
    verifier(await page.attendre("[...document.querySelectorAll('#initiative-ordre li.hors-jeu')].some(li => li.textContent.includes('Squelette brisé') && li.textContent.includes('💀'))", 30),
      'page MJ : la créature morte est barrée (💀) dans l\'ordre');
    await api('POST', '/api/initiative/terminer', {}, mj);

    // --- Confidentialité : une page non-MJ ne reçoit jamais la fiche d'une créature ---------------
    // Une connexion « joueur » note tout ce qu'elle reçoit pendant que le MJ
    // crée, modifie, duplique créatures et modèles du bestiaire.
    await page.ouvrir('ecran.html');
    await page.attendre("document.getElementById('ecran-statut').textContent.includes('Synchronisé')", 30);
    await page.evaluer(`new Promise(resoudre => {
      window.__recus = [];
      const s = io({ query: { role: 'player' } });
      s.onAny((nom, ...args) => window.__recus.push([nom, args]));
      s.on('connect', () => resoudre(true));
      window.__espion = s;
    })`);
    const secret = { description: 'SECRET-description', notes: 'SECRET-notes' };
    const liche = (await api('POST', '/api/mobs', { nom: 'Liche', ...secret }, mj)).donnees.mob;
    await api('PUT', `/api/mobs/${liche.id}`, { notes: 'SECRET-notes-2' }, mj);
    await api('POST', `/api/mobs/${liche.id}/statuses`, { statutId: 'poison' }, mj);
    await api('POST', `/api/mobs/${liche.id}/duplicate`, {}, mj);
    const modele = (await api('POST', '/api/mob-templates', { nom: 'Spectre', ...secret }, mj)).donnees.template;
    await api('PUT', `/api/mob-templates/${modele.id}`, { notes: 'SECRET-notes-3' }, mj);
    await api('POST', `/api/mob-templates/${modele.id}/duplicate`, {}, mj);
    await api('POST', `/api/mob-templates/${modele.id}/spawn`, {}, mj);
    await api('POST', `/api/maps/${encodeURIComponent(mapId)}/spawn-mob`, { templateId: modele.id }, mj);
    await api('POST', `/api/mob-templates/from-mob/${liche.id}`, { nom: 'Liche (modèle)' }, mj);
    await page.attendre('false', 4);
    const recus = await page.evaluer('JSON.stringify(window.__recus)');
    const evenements = new Set(JSON.parse(recus).map(([nom]) => nom));
    verifier(evenements.has('mobUpdated') && evenements.has('mobTemplateUpdated'),
      `confidentialité : les signaux de mise à jour arrivent bien (${[...evenements].join(', ')})`);
    verifier(!recus.includes('SECRET'), 'confidentialité : aucune note ni description de créature ou de modèle n\'est envoyée à une page non-MJ');
    await page.evaluer('window.__espion.close()');
  }
};
