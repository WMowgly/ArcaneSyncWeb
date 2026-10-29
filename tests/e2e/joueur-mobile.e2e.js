// Joueur sur téléphone : grands boutons PV / mana enregistrés aussitôt, sorts
// d'un coup d'œil, notification quand le MJ (ou un repos) modifie le
// personnage ; repos côté MJ ; accueil avec l'adresse et le QR code.
module.exports = {
  nom: 'Joueur sur téléphone, notifications, repos, rejoindre',
  async executer({ page, verifier, api, definirCodeMj, joueur, session }) {
    const mj = await definirCodeMj();
    const PLAYER = joueur.id;
    await api('GET', `/api/session/player/${PLAYER}`);
    const max = session(PLAYER).hp.max;
    const lirePv = async () => (await api('GET', `/api/session/player/${PLAYER}`)).donnees.hp.current;
    await api('POST', '/api/session/player', { id: PLAYER, nouvellesDonnees: { hp: { current: max - 5 } } }, mj);

    // --- Interface de jeu à 390 px --------------------------------------------------------
    await page.largeur(390);
    await page.ouvrir(`interface_jeu.html?PlayerId=${PLAYER}`);
    await page.attendre(`document.getElementById('player_hp_current').value === '${max - 5}'`, 40);
    verifier(await page.evaluer('document.documentElement.scrollWidth <= window.innerWidth'), 'téléphone : aucun défilement horizontal');
    const hauteurBouton = await page.evaluer(`document.querySelector('[data-ressource="hp"] [data-delta="-1"]').getBoundingClientRect().height`);
    verifier(hauteurBouton >= 44, `téléphone : boutons PV assez grands pour le doigt (${Math.round(hauteurBouton)} px)`);
    verifier(await page.evaluer(`document.querySelector('[data-ressource="hp"] .ressource-texte').textContent === '${max - 5} / ${max}'`),
      'téléphone : jauge PV à jour');

    // Trois appuis rapides : un seul envoi, la bonne valeur au bout.
    await page.cliquer('[data-ressource="hp"] [data-delta="-1"]');
    await page.cliquer('[data-ressource="hp"] [data-delta="-1"]');
    await page.cliquer('[data-ressource="hp"] [data-delta="1"]');
    verifier(await page.attendre("document.getElementById('etat-enregistrement').textContent.includes('Enregistré')", 30),
      'téléphone : enregistrement immédiat confirmé');
    verifier(await lirePv() === max - 6, 'téléphone : −1, −1, +1 enregistrés dans la partie');
    await page.cliquer('[data-ressource="hp"] [data-max]');
    await page.attendre('false', 5);
    verifier(await lirePv() === max, 'téléphone : « Max » remet les PV au maximum');
    verifier(await page.evaluer("document.getElementById('notification-jeu').hidden"),
      'notification : aucune pour un changement fait par le joueur lui-même');

    // Sorts : autant de cartes que d'entrées nommées sur le personnage.
    const attendus = ['spells', 'sorts_mineurs', 'attaques_speciales']
      .reduce((n, cle) => n + (session(PLAYER)[cle] || []).filter(e => e && String(e.nom || '').trim()).length, 0);
    const cartes = await page.evaluer("document.querySelectorAll('#sorts-contenu .sort').length");
    verifier(cartes === attendus, `sorts : ${cartes} sorts et attaques affichés (attendu ${attendus})`);
    await page.capture('joueur-mobile-haut.png');
    await page.capture('joueur-mobile-sorts.png', '#sorts-panel');

    // Statistiques : sous les sorts sur téléphone, en colonne à droite sur PC.
    const dispositionStats = `(() => {
      const stats = document.querySelector('.player-stats-section').getBoundingClientRect();
      const sorts = document.getElementById('sorts-panel').getBoundingClientRect();
      const identite = document.querySelector('.identite').getBoundingClientRect();
      const puces = [...document.querySelectorAll('#player-stats .stat-chip')].map(p => p.getBoundingClientRect());
      return {
        sousLesSorts: stats.top >= sorts.bottom,
        aDroite: stats.left >= sorts.right && stats.left >= identite.right,
        enHautDeLaCarte: Math.abs(stats.top - document.querySelector('.legende-champs').getBoundingClientRect().top) < 20,
        colonnes: new Set(puces.map(p => Math.round(p.left))).size,
        puces: puces.length
      };
    })()`;
    // Intoxication : « x / Constitution », comme la durabilité.
    const constitution = Number(session(PLAYER).stats?.constitution) || 0;
    verifier(await page.evaluer(`(() => { const max = document.getElementById('player_intox_max');
        return max.readOnly && max.value === '${constitution > 0 ? constitution : ''}'
          && !document.getElementById('player_intox').readOnly
          && max.closest('.dual-input') === document.getElementById('player_intox').closest('.dual-input'); })()`),
      `jeu : intoxication affichée « x / Constitution » (${constitution})`);
    let dispo = await page.evaluer(dispositionStats);
    verifier(dispo.puces === 8 && dispo.sousLesSorts && !dispo.aDroite && dispo.colonnes === 2,
      `téléphone : statistiques sous les sorts, sur deux colonnes (${JSON.stringify(dispo)})`);
    await page.largeur(1500);
    await page.evaluer('window.scrollTo(0, 0)');
    dispo = await page.evaluer(dispositionStats);
    verifier(dispo.aDroite && dispo.enHautDeLaCarte && dispo.colonnes === 1,
      `PC : statistiques en colonne à droite, en haut de la carte (${JSON.stringify(dispo)})`);
    verifier(await page.evaluer('document.documentElement.scrollWidth <= window.innerWidth'), 'PC : aucun défilement horizontal');
    await page.capture('joueur-pc.png');
    await page.largeur(390);

    // --- Fiche et choix du personnage à 390 px --------------------------------------------------
    await page.ouvrir(`fiche_perso.html?PlayerId=${PLAYER}`);
    await page.attendre("document.getElementById('player_name').value !== '' && document.querySelectorAll('.competences-table tbody tr').length > 0", 40);
    verifier(await page.evaluer('document.documentElement.scrollWidth <= window.innerWidth'), 'fiche : aucun défilement horizontal');
    verifier(await page.evaluer(`[...document.querySelectorAll('.section > h2')].every(h2 => {
        const suivant = h2.nextElementSibling;
        return !suivant || h2.getBoundingClientRect().bottom <= suivant.getBoundingClientRect().top + 1;
      })`), 'fiche : les titres de section ne recouvrent plus le contenu');
    verifier(await page.evaluer(`[...document.querySelectorAll('.competences-table .comp_effet')].every(z => z.scrollHeight <= z.clientHeight + 2)`),
      'fiche : effet des compétences affiché en entier');
    verifier(await page.evaluer(`getComputedStyle(document.getElementById('stat_force').closest('.grid')).gridTemplateColumns.split(' ').length === 2`),
      'fiche : caractéristiques sur deux colonnes');
    verifier(await page.evaluer(`getComputedStyle(document.getElementById('save-data-btn')).position === 'fixed'`),
      'fiche : « Sauvegarder » toujours à portée de pouce');
    // Filtre « Type » des sorts : les autres écoles sont retirées de la liste
    // (la liste native des téléphones montre les groupes seulement masqués).
    await page.evaluer("document.getElementById('add-sort-btn').click()");
    await page.attendre("document.querySelectorAll('#sorts-container .sort-row').length > 0 && document.querySelectorAll('.filtre-type')[0].options.length > 1", 30);
    const filtreFiche = await page.evaluer(`(() => {
      const f = document.querySelectorAll('.filtre-type')[0];
      f.value = f.options[f.options.length - 1].value;
      f.dispatchEvent(new Event('change'));
      const lignes = [...document.querySelectorAll('#sorts-container .sort-row select')];
      const nouvelle = lignes[lignes.length - 1];
      return { type: f.value, groupes: [...nouvelle.querySelectorAll('optgroup')].map(g => g.label) };
    })()`);
    verifier(filtreFiche.groupes.length === 1 && filtreFiche.groupes[0] === filtreFiche.type,
      `fiche : le filtre « Type » ne laisse que « ${filtreFiche.type} » dans la liste d'un nouveau sort`);
    await page.capture('fiche-mobile.png');
    await page.capture('fiche-mobile-competences.png', '#competences-container');

    // Téléphone d'un joueur : aucun code MJ mémorisé.
    await page.evaluer(`localStorage.removeItem('arcanesync-code-mj')`);
    await page.ouvrir('selecte_player.html');
    await page.attendre("document.querySelectorAll('#joueurs-list .card').length > 0", 30);
    verifier(await page.evaluer("!document.querySelector('.delete-btn') && document.querySelector('.carte-perso').getAttribute('href').startsWith('interface_jeu.html?PlayerId=')"),
      'choix du personnage : carte = lien vers le jeu, pas de « Supprimer » chez un joueur');
    verifier(await page.evaluer('document.documentElement.scrollWidth <= window.innerWidth'), 'choix du personnage : aucun défilement horizontal');
    await page.capture('selection-mobile.png');
    await page.evaluer(`localStorage.setItem('arcanesync-code-mj', ${JSON.stringify(mj.code)})`);
    await page.ouvrir(`interface_jeu.html?PlayerId=${PLAYER}`);
    await page.attendre(`document.getElementById('player_hp_current').value !== ''`, 40);

    // --- Notification : le MJ modifie les PV ------------------------------------------------
    await page.evaluer('window.scrollTo(0, 0)');
    await api('POST', '/api/session/player', { id: PLAYER, nouvellesDonnees: { hp: { current: max - 4 } } }, mj);
    verifier(await page.attendre("!document.getElementById('notification-jeu').hidden", 20), 'notification : affichée quand le MJ modifie les PV');
    const texte = await page.evaluer("document.getElementById('notification-jeu').textContent");
    verifier(texte.includes('Le MJ') && texte.includes(`PV : ${max} → ${max - 4} (−4)`), `notification : détail du changement (${texte.replace(/\s+/g, ' ').trim()})`);
    verifier(await page.evaluer("document.getElementById('notification-jeu').classList.contains('perte')"), 'notification : marquée comme une perte de PV');
    await page.capture('joueur-mobile-notification.png');
    await page.evaluer("document.getElementById('notification-jeu').click()");
    verifier(await page.evaluer("document.getElementById('notification-jeu').hidden"), 'notification : se ferme d\'un appui');

    // --- Repos long lancé par le MJ : notifié aussi ----------------------------------------------
    await api('POST', '/api/session/repos/long', {}, mj);
    verifier(await page.attendre("document.getElementById('notification-jeu').textContent.includes('Repos long')", 20),
      'notification : repos long signalé au joueur');
    verifier(await page.attendre(`document.getElementById('player_hp_current').value === '${max}'`, 20), 'repos : PV remis au maximum en direct');

    // --- Repos court depuis l'interface MJ ----------------------------------------------------------
    await api('POST', '/api/session/player', { id: PLAYER, nouvellesDonnees: { hp: { current: 1 } } }, mj);
    await page.largeur(1500);
    await page.ouvrir('mj.html');
    await page.attendre("!!document.querySelector('[data-repos=\"court\"]')", 30);
    await page.evaluer("document.querySelector('[data-repos=\"court\"]').click()");
    verifier(await page.attendre("document.querySelectorAll('#repos-regles tr').length === 3 && document.querySelectorAll('#repos-joueurs input').length > 0", 30),
      'MJ : panneau du repos court (règles et personnages)');
    // Règle choisie : +2 PV, rien d'autre ; seul le personnage testé est coché.
    await page.evaluer(`(() => {
      const ligne = r => document.querySelector('#repos-regles tr[data-ressource="' + r + '"]');
      const choisir = (r, mode) => {
        const liste = ligne(r).querySelector('[data-a="mode"]');
        liste.value = mode;
        liste.dispatchEvent(new Event('change'));
      };
      choisir('hp', 'valeur');
      ligne('hp').querySelector('[data-a="valeur"]').value = 2;
      choisir('mana', 'aucun');
      choisir('protection', 'aucun');
      document.querySelectorAll('#repos-joueurs input').forEach(c => { c.checked = c.value === ${JSON.stringify(PLAYER)}; });
    })()`);
    await page.capture('repos-mj.png', '#players-management');
    await page.evaluer("document.getElementById('repos-appliquer').click()");
    verifier(await page.attendre("document.getElementById('repos-resultat').textContent.includes('PV 1 → 3')", 20), 'MJ : résultat du repos affiché');
    verifier(await lirePv() === 3, 'MJ : repos court appliqué selon la règle choisie');
    const regles = (await api('GET', '/api/session/repos', null, mj)).donnees.regles;
    verifier(regles.court.hp.mode === 'valeur' && regles.court.hp.valeur === 2, 'MJ : règle du repos court enregistrée pour la prochaine fois');
    await page.capture('repos-mj-resultat.png', '#players-management');

    // --- Accueil : adresse et QR code ---------------------------------------------------------------------
    await page.largeur(390);
    await page.ouvrir('index.html');
    verifier(await page.attendre("!document.getElementById('rejoindre').hidden && !!document.querySelector('#rejoindre-qr svg')", 30),
      'accueil : encart « Rejoindre la partie » avec QR code');
    const lien = await page.evaluer("document.getElementById('rejoindre-lien').href");
    verifier(/^http:\/\/\d+\.\d+\.\d+\.\d+:\d+\/selecte_player\.html$/.test(lien) && lien.includes(`:${new URL(page.BASE).port}/`),
      `accueil : adresse réseau du serveur (${lien})`);
    verifier(await page.evaluer("document.getElementById('rejoindre-qr').dataset.url === document.getElementById('rejoindre-lien').href"),
      'accueil : le QR code porte la même adresse');
    verifier(await page.evaluer("/^\\d+\\.\\d+\\.\\d+\\.\\d+:\\d+$/.test(document.getElementById('rejoindre-lien').textContent)"),
      'accueil : adresse courte affichée, facile à taper');
    verifier(await page.evaluer('document.documentElement.scrollWidth <= window.innerWidth'), 'accueil : aucun défilement horizontal sur téléphone');
    await page.capture('accueil-rejoindre.png', '#rejoindre');
    await page.largeur(1500);
  }
};
