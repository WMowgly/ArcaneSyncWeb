// Tableau blanc au style de la carte MJ, et choix de l'Écran depuis la carte
// et le tableau blanc (V2.4).
module.exports = {
  nom: 'Tableau blanc (style carte MJ) et choix de l\'Écran',
  async executer({ page, verifier, api, definirCodeMj, lireJson }) {
    const mj = await definirCodeMj();
    const [premier] = lireJson('data.json');
    const vue = async () => (await api('GET', '/api/ecran')).donnees.vue;

    // --- Carte MJ : choix de l'Écran -------------------------------------------------------
    await api('POST', '/api/ecran', { vue: 'carte' }, mj);
    await page.ouvrir('map.html');
    verifier(await page.attendre("document.querySelector('#choix-ecran [data-ecran-vue=\"carte\"]')?.getAttribute('aria-pressed') === 'true'", 30),
      'carte MJ : sélecteur de l\'Écran, sur la vue en cours');
    verifier(await page.evaluer("!!document.querySelector('.map-header #choix-ecran.choix-ecran')"),
      'carte MJ : sélecteur en haut de la page, comme sur le tableau blanc');
    await page.capture('carte-mj-entete.png');
    await page.cliquer('#choix-ecran [data-ecran-vue="tableau"]');
    await page.attendre('false', 2);
    verifier(await vue() === 'tableau', 'carte MJ : « Tableau blanc » bascule l\'Écran');

    // --- Tableau blanc MJ : choix de l'Écran, fiches des participants -------------------------
    await api('POST', '/api/initiative/demarrer', { entrees: [{ kind: 'player', entityId: premier.id, nom: premier.nom, valeur: 18 }] }, mj);
    await page.ouvrir('tableau.html?role=mj');
    verifier(await page.attendre("document.querySelector('#choix-ecran [data-ecran-vue=\"tableau\"]')?.getAttribute('aria-pressed') === 'true'", 30),
      'tableau MJ : sélecteur de l\'Écran, sur la vue en cours');
    await page.cliquer('#choix-ecran [data-ecran-vue="carte"]');
    await page.attendre('false', 2);
    verifier(await vue() === 'carte', 'tableau MJ : « Carte » bascule l\'Écran');

    const fiche = `#scene-token-list .entity-item[data-id="player:${premier.id}"]`;
    await page.attendre(`!!document.querySelector('${fiche}')`, 20);
    const sess = lireJson('session.json').players[premier.id];
    const textes = await page.evaluer(`(() => { const f = document.querySelector('${fiche}');
      return { pv: f.querySelector('.jauge-pv .jauge-texte')?.textContent, mana: f.querySelector('.jauge-mana .jauge-texte')?.textContent }; })()`);
    verifier(textes.pv === `${sess.hp.current} / ${sess.hp.max}` && textes.mana === (sess.mana?.max > 0 ? `${sess.mana.current} / ${sess.mana.max}` : '—'),
      `tableau MJ : fiches avec jauges PV et Mana (${JSON.stringify(textes)})`);
    verifier(await page.attendre(`document.querySelector('${fiche}').classList.contains('actif') && actifId === 'player:${premier.id}'`, 20),
      'tableau MJ : combattant actif mis en avant (fiche et anneau doré)');
    verifier(await page.evaluer("[...document.querySelectorAll('.tool-btn')].length === 4 && document.querySelectorAll('#nuancier button').length === 6"),
      'tableau MJ : outils et nuancier au style de la carte MJ');
    verifier(await page.evaluer("getComputedStyle(document.body).fontFamily.includes('Segoe') && getComputedStyle(document.querySelector('h1')).fontFamily.includes('Uncial')"),
      'tableau MJ : texte lisible, titres en Uncial Antiqua (comme la carte MJ)');

    // Nuancier : la couleur choisie sert au tracé.
    await page.cliquer('#nuancier button[data-couleur="#9b2c2c"]');
    verifier(await page.evaluer("selectedColor === '#9b2c2c' && document.getElementById('tool-draw').classList.contains('active')"),
      'tableau : une couleur du nuancier passe en mode dessin avec cette couleur');
    await page.capture('tableau-mj-style.png');

    // --- Sélection : clic sur un pion → fiche soulignée dans la liste (comme la carte) -------
    await page.cliquer('#tool-move');
    const versPion = id => page.evaluer(`(() => { const t = scene.tokens['${id}']; const r = document.getElementById('scene-canvas').getBoundingClientRect();
      return [r.x + t.x * r.width, r.y + t.y * r.height]; })()`);
    const [px, py] = await versPion(`player:${premier.id}`);
    await page.souris('mousePressed', px, py);
    await page.souris('mouseReleased', px, py);
    verifier(await page.attendre(`selectionId === 'player:${premier.id}' && document.querySelector('${fiche}').classList.contains('selection')`, 10),
      'tableau MJ : clic sur un pion → sa fiche est sélectionnée dans la liste');

    // « Voir » depuis la liste : sélectionne le pion sur le tableau.
    const second = lireJson('data.json')[1];
    const ficheSecond = `#scene-token-list .entity-item[data-id="player:${second.id}"]`;
    await page.evaluer(`document.querySelector('${ficheSecond} [data-act="focus"]').click()`);
    verifier(await page.attendre(`selectionId === 'player:${second.id}' && document.querySelector('${ficheSecond}').classList.contains('selection')`, 10),
      'tableau MJ : « Voir » sélectionne le pion');

    // « PV / PM » : la même fenêtre que sur la carte ; −1 PV appliqué.
    const pvAvant = lireJson('session.json').players[second.id].hp.current;
    await page.evaluer(`document.querySelector('${ficheSecond} [data-act="stats"]').click()`);
    verifier(await page.attendre("!document.getElementById('entity-modal').hidden && !!document.getElementById('mod-hp-cur') && !!document.getElementById('mod-mana-cur')", 10),
      'tableau MJ : « PV / PM » ouvre la fenêtre PV et Mana');
    await page.evaluer(`document.querySelector('#entity-modal [data-res="hp"][data-delta="-1"]').click()`);
    await page.capture('tableau-mj-pvpm.png');
    await page.evaluer("document.getElementById('mod-apply').click()");
    verifier(await page.attendre("document.getElementById('entity-modal').hidden", 10), 'fenêtre PV / PM : fermée après « Appliquer »');
    await page.attendre('false', 2);
    verifier(lireJson('session.json').players[second.id].hp.current === Math.max(0, pvAvant - 1),
      `fenêtre PV / PM : PV enregistrés (${pvAvant} → ${lireJson('session.json').players[second.id].hp.current})`);

    // Créature : statut appliqué depuis la fenêtre.
    const mob = (await api('POST', '/api/mobs', { nom: 'Loup du tableau', hp: { max: 12, current: 12 } }, mj)).donnees.mob;
    await page.attendre(`!!scene.tokens['mob:${mob.id}']`, 20);
    await page.evaluer(`ouvrirModale('mob:${mob.id}')`);
    await page.attendre("!!document.querySelector('#entity-modal [data-statut=\"poison\"]')", 10);
    await page.evaluer(`document.querySelector('#entity-modal [data-statut="poison"]').click()`);
    await page.attendre('false', 2);
    const statuts = (await api('GET', '/api/mobs', null, mj)).donnees.find(m => m.id === mob.id)?.statuts || [];
    verifier(statuts.some(s => s.id === 'poison'), 'fenêtre PV / PM : statut d\'une créature appliqué');
    await page.evaluer("document.getElementById('mod-cancel')?.click()");

    // « Cacher » un personnage : retiré de la vue des autres joueurs, pas de la sienne.
    await page.evaluer(`document.querySelector('${ficheSecond} [data-scene-visibility]').click()`);
    await page.attendre(`scene.tokens['player:${second.id}']?.visibleToPlayers === false`, 20);
    const vueAutre = (await api('GET', `/api/session/scene?role=player&playerId=${encodeURIComponent(premier.id)}`)).donnees;
    const vueSienne = (await api('GET', `/api/session/scene?role=player&playerId=${encodeURIComponent(second.id)}`)).donnees;
    verifier(!vueAutre.tokens[`player:${second.id}`] && !vueAutre.entities.players.some(p => p.id === second.id)
      && !!vueSienne.tokens[`player:${second.id}`],
    'tableau MJ : « Cacher » un personnage le retire de la vue des autres, pas de la sienne');
    verifier(await page.evaluer(`document.querySelector('${ficheSecond}').classList.contains('cache')`), 'tableau MJ : fiche du personnage caché marquée');

    // Groupes PJ / MOB dépliants, comme sur la carte MJ.
    const groupe = nom => `document.querySelector('#scene-token-list details[data-groupe="${nom}"]')`;
    verifier(await page.evaluer(`${groupe('PJ')}?.open && ${groupe('MOB')}?.open`), 'tableau MJ : groupes PJ et MOB dépliés par défaut');
    await page.evaluer("document.querySelector('#scene-token-list details[data-groupe=\"PJ\"] > summary').scrollIntoView({ block: 'center' })");
    await page.cliquer('#scene-token-list details[data-groupe="PJ"] > summary');
    verifier(await page.attendre(`!${groupe('PJ')}.open && !${groupe('PJ')}.querySelector('.entity-item').checkVisibility() && ${groupe('MOB')}.open`, 10),
      'tableau MJ : groupe PJ replié d\'un clic, MOB reste ouvert');
    await api('PUT', `/api/mobs/${encodeURIComponent(mob.id)}`, { hp: { current: 10 } }, mj);
    await page.attendre('false', 2);
    verifier(await page.evaluer(`!${groupe('PJ')}.open && ${groupe('MOB')}.open`), 'tableau MJ : groupe replié conservé quand la liste se rafraîchit');
    await page.ouvrir('tableau.html?role=mj');
    verifier(await page.attendre(`${groupe('PJ')} && !${groupe('PJ')}.open && ${groupe('MOB')}.open`, 30), 'tableau MJ : groupe replié mémorisé après rechargement');
    await page.capture('tableau-mj-groupes.png');
    await page.evaluer("document.querySelector('#scene-token-list details[data-groupe=\"PJ\"] > summary').scrollIntoView({ block: 'center' })");
    await page.cliquer('#scene-token-list details[data-groupe="PJ"] > summary');
    verifier(await page.attendre(`${groupe('PJ')}.open`, 10), 'tableau MJ : groupe PJ déplié d\'un clic');

    // --- Carte MJ : la fiche du pion sélectionné est aussi soulignée ------------------------
    await page.ouvrir('map.html');
    await page.attendre('!!window.ArcaneRendu?.state.map', 30);
    await page.attendre(`!!document.querySelector('#entity-list .entity-item[data-id="player:${premier.id}"]')`, 20);
    await page.evaluer(`document.querySelector('#entity-list .entity-item[data-id="player:${premier.id}"] [data-act="focus"]').click()`);
    verifier(await page.attendre(`document.querySelector('#entity-list .entity-item[data-id="player:${premier.id}"]').classList.contains('selection')`, 10),
      'carte MJ : la fiche du pion sélectionné est soulignée dans la liste');

    // --- Joueur : pas de sélecteur d'Écran, pas de mana transmis ----------------------------
    await page.ouvrir(`tableau.html?role=player&PlayerId=${encodeURIComponent(premier.id)}`);
    await page.attendre("document.getElementById('scene-canvas').width > 0", 30);
    verifier(await page.evaluer("document.getElementById('choix-ecran').hidden"), 'tableau joueur : pas de sélecteur d\'Écran');
    const sceneJoueur = (await api('GET', `/api/session/scene?role=player&playerId=${encodeURIComponent(premier.id)}`)).donnees;
    verifier(![...sceneJoueur.entities.players, ...sceneJoueur.entities.mobs].some(e => 'mana' in e),
      'scène côté joueur : le mana n\'est pas transmis');
    await page.capture('tableau-joueur-style.png');
  }
};
