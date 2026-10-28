// Code MJ : choix au premier clic, saisie sur un autre navigateur, routes et
// sockets protégés, joueurs sans code.
module.exports = {
  nom: 'Code MJ',
  async executer({ page, verifier, session, joueur, fichierExiste, BASE }) {
    const PLAYER = joueur.id;
    const carte = `#joueurs-list .card[data-id="${PLAYER}"]`;

    // Accueil : premier clic sur MJ → choix du code.
    await page.ouvrir('index.html');
    await page.evaluer('localStorage.clear()');
    await page.cliquer('#btn_mj');
    verifier(await page.attendre("!!document.querySelector('.mjc-fond input[name=\"confirmation\"]')", 20),
      'accueil : premier clic sur MJ → fenêtre « Choisir le code MJ »');
    await page.capture('code-mj-creation.png');
    await page.taper('.mjc-fond input[name="nouveau"]', 'dragon');
    await page.taper('.mjc-fond input[name="confirmation"]', 'dragonne');
    await page.cliquer('.mjc-fond button[type="submit"]');
    verifier(await page.attendre("document.querySelector('.mjc-erreur').textContent.includes('correspondent')", 10),
      'accueil : confirmation différente refusée');
    await page.evaluer("document.querySelector('.mjc-fond input[name=\"confirmation\"]').value = ''");
    await page.taper('.mjc-fond input[name="confirmation"]', 'dragon');
    await page.cliquer('.mjc-fond button[type="submit"]');
    verifier(await page.attendre("location.pathname.endsWith('mj.html')", 20), 'accueil : code choisi → interface MJ');
    verifier(fichierExiste('mj.json'), 'serveur : mj.json créé');

    // Commandes MJ avec le code mémorisé.
    await page.attendre(`!!document.querySelector('${carte} [data-a="damage-hp"]')`);
    const avant = session(PLAYER).hp.current;
    await page.evaluer(`document.querySelector('${carte} [data-a="hp-amount"]').value = '2'`);
    await page.evaluer(`document.querySelector('${carte} [data-a="damage-hp"]').click()`);
    await page.attendre('false', 6);
    verifier(session(PLAYER).hp.current === Math.max(0, avant - 2), 'MJ : « − 2 » appliqué avec le code');

    // Autre navigateur (code oublié) : page MJ bloquée jusqu'au code.
    await page.evaluer("localStorage.removeItem('arcanesync-code-mj')");
    await page.ouvrir('mj.html');
    verifier(await page.attendre("!!document.querySelector('.mjc-fond input[name=\"code\"]')", 30),
      'MJ sans code : fenêtre « Code MJ » à l\'ouverture');
    verifier(await page.evaluer("document.querySelector('.mjc-fond [data-annuler]').textContent") === "Retour à l'accueil",
      'MJ sans code : pas d\'annulation possible, seulement le retour à l\'accueil');
    const brut = (await fetch(`${BASE}/api/mobs`, { headers: { 'X-ArcaneSync-Role': 'mj' } })).status;
    verifier(brut === 403, `serveur : /api/mobs sans code → ${brut}`);
    await page.taper('.mjc-fond input[name="code"]', 'mauvais');
    await page.cliquer('.mjc-fond button[type="submit"]');
    verifier(await page.attendre("document.querySelector('.mjc-erreur').textContent === 'Code incorrect.'", 10), 'MJ : mauvais code refusé');
    await page.evaluer("document.querySelector('.mjc-fond input[name=\"code\"]').value = ''");
    await page.taper('.mjc-fond input[name="code"]', 'dragon');
    verifier(await page.naviguerPar("setTimeout(() => document.querySelector('.mjc-fond button[type=\"submit\"]').click(), 0)",
      `!!document.querySelector('${carte} [data-a="damage-hp"]') && !document.querySelector('.mjc-fond')`),
      'MJ : bon code accepté, page rechargée');

    // Sockets : rôle MJ seulement avec le code.
    const roleSocket = () => page.evaluer(`new Promise(r => { const s = io({ query: { role: 'mj' } });
      s.on('stateSync', x => { r(x.role); s.close(); }); setTimeout(() => r('aucun'), 4000); })`);
    verifier(await roleSocket() === 'mj', 'socket MJ avec le code : rôle MJ');
    await page.evaluer("localStorage.removeItem('arcanesync-code-mj')");
    verifier(await roleSocket() === 'player', 'socket MJ sans code : traité comme un joueur');

    // Joueur : aucun code demandé.
    await page.ouvrir(`interface_jeu.html?PlayerId=${PLAYER}`);
    await page.attendre("document.getElementById('player_hp').value !== ''");
    await page.evaluer(`document.querySelector('input[name="survie3"][value="echec"]').click()`);
    await page.attendre('false', 5);
    verifier(session(PLAYER).survie?.echec?.[2] === true, 'joueur sans code : jets de survie enregistrés');

    // Suppression d'un personnage : code demandé ; annuler ne supprime rien.
    await page.ouvrir('selecte_player.html');
    await page.attendre("!!document.querySelector('.delete-btn')");
    await page.evaluer("document.querySelector('.delete-btn').click()");
    verifier(await page.attendre("!!document.querySelector('.mjc-fond input[name=\"code\"]')", 20), 'sélection : suppression → code MJ demandé');
    await page.evaluer("document.querySelector('.mjc-fond [data-annuler]').click()");
    await page.attendre('false', 3);
    verifier(!!session(PLAYER), 'sélection : annuler → personnage conservé');

    // Navigateur qui connaît le code : l'accueil ouvre l'interface MJ directement.
    await page.ouvrir('index.html');
    await page.evaluer("localStorage.setItem('arcanesync-code-mj', 'dragon')");
    await page.cliquer('#btn_mj');
    verifier(await page.attendre("location.pathname.endsWith('mj.html')", 20), 'accueil : code connu → interface MJ sans fenêtre');
  }
};
