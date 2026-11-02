// Rencontres préparées (V2.4) : créées dans Données de jeu, déployées d'un
// clic sur la carte MJ, initiative pré-remplie dans la préparation du combat.
module.exports = {
  nom: 'Rencontres préparées (Données de jeu → carte MJ)',
  async executer({ page, verifier, api, definirCodeMj, lireJson }) {
    const mj = await definirCodeMj();
    const gobelin = (await api('POST', '/api/mob-templates', { nom: 'Gobelin', hp: { max: 7, current: 7 } }, mj)).donnees.template;
    const chef = (await api('POST', '/api/mob-templates', { nom: 'Chef gobelin', hp: { max: 15, current: 15 } }, mj)).donnees.template;

    // --- Données de jeu : création --------------------------------------------------------
    await page.ouvrir('modification.html#rencontres');
    verifier(await page.attendre("document.querySelector('#onglets button.actif')?.dataset.onglet === 'rencontres'", 30),
      'Données de jeu : onglet Rencontres (lien direct #rencontres)');
    await page.evaluer("document.getElementById('btn-nouveau').click()");
    await page.attendre("!!document.querySelector('#rencontre-lignes .rencontre-ligne')", 10);
    await page.evaluer(`(() => {
      const f = document.getElementById('editeur');
      f.querySelector('[name="nom"]').value = 'Embuscade du pont';
      f.querySelector('[name="notes"]').value = 'Sous le vieux pont';
      const premiere = f.querySelector('#rencontre-lignes .rencontre-ligne');
      premiere.querySelector('[data-r="modele"]').value = '${gobelin.id}';
      premiere.querySelector('[data-r="quantite"]').value = '2';
      premiere.querySelector('[data-r="initiative"]').value = '13';
      document.getElementById('rencontre-ajouter').click();
      const seconde = [...f.querySelectorAll('#rencontre-lignes .rencontre-ligne')].pop();
      seconde.querySelector('[data-r="modele"]').value = '${chef.id}';
    })()`);
    await page.evaluer("document.getElementById('btn-enregistrer').click()");
    await page.attendre('false', 6);
    const enregistrees = lireJson('rencontres.json');
    verifier(enregistrees.length === 1 && enregistrees[0].nom === 'Embuscade du pont'
      && JSON.stringify(enregistrees[0].groupes) === JSON.stringify([
        { templateId: gobelin.id, quantite: 2, initiative: 13 }, { templateId: chef.id, quantite: 1, initiative: null }]),
    `Données de jeu : rencontre enregistrée (${JSON.stringify(enregistrees[0]?.groupes)})`);
    verifier(await page.evaluer("document.getElementById('liste').textContent.includes('2 × Gobelin')"), 'Données de jeu : résumé « 2 × Gobelin · 1 × Chef gobelin »');
    await page.capture('rencontres-donnees.png');

    // --- Carte MJ : déploiement d'un clic -------------------------------------------------------
    await page.ouvrir('map.html');
    await page.attendre('!!window.ArcaneRendu?.state.map', 30);
    await page.cliquer('.onglet[data-onglet="rencontres"]');
    verifier(await page.attendre("document.getElementById('renc-list').textContent.includes('Embuscade du pont')", 20),
      'carte MJ : onglet Rencontres, rencontre listée');
    verifier(await page.evaluer("document.getElementById('renc-list').textContent.includes('2 × Gobelin (init. 13)')"), 'carte MJ : composition et initiative affichées');
    const avant = (await api('GET', '/api/mobs', null, mj)).donnees.length;
    await page.cliquer('#renc-list button[data-renc="deployer"]');
    verifier(await page.evaluer("document.getElementById('tool-title').textContent === 'Déployer une rencontre'"), 'carte MJ : « Déployer » attend le clic sur la carte');
    const [px, py] = await page.evaluer(`(() => {
      const r = window.ArcaneRendu; const g = r.state.map.grid; const rect = r.canvas.getBoundingClientRect();
      const echelle = rect.width / (g.cols * g.cellSize + 22);
      return [rect.left + (22 + 30.5 * g.cellSize) * echelle, rect.top + (22 + 20.5 * g.cellSize) * echelle]; })()`);
    await page.souris('mousePressed', px, py);
    await page.souris('mouseReleased', px, py);
    await page.attendre('false', 6);
    const mobs = (await api('GET', '/api/mobs', null, mj)).donnees;
    const nouveaux = mobs.slice(avant);
    verifier(mobs.length === avant + 3 && nouveaux.filter(m => m.nom.startsWith('Gobelin')).length === 2, `carte MJ : 3 créatures créées (${nouveaux.map(m => m.nom)})`);
    const jetons = Object.values(window_tokens(lireJson('maps.json'), lireJson('session.json').activeMapId))
      .filter(t => nouveaux.some(m => `mob:${m.id}` === t.id));
    verifier(jetons.length === 3 && jetons.every(t => Math.max(Math.abs(t.x - 30), Math.abs(t.y - 20)) <= 1),
      `carte MJ : groupe placé autour de la case cliquée (${jetons.map(t => `${t.x},${t.y}`).join(' ')})`);
    verifier(await page.evaluer("document.getElementById('tool-title').textContent === 'Sélection'"), 'carte MJ : retour à l\'outil Sélection');

    // Sous-liste nommée comme la rencontre, dans MOB (carte MJ puis tableau blanc).
    const sousListe = conteneur => `(() => {
      const groupes = [...document.querySelectorAll('${conteneur} details[data-groupe="MOB"] details.sous-groupe')];
      return groupes.map(g => g.querySelector('summary .groupe-nom').textContent + ' ' + g.querySelector('summary .badge').textContent
        + '=' + g.querySelectorAll('.entity-item').length).join('|');
    })()`;
    verifier(await page.attendre(`${sousListe('#entity-list')} === '⚔️ Embuscade du pont 3=3'`, 20),
      `carte MJ : créatures de la rencontre dans la sous-liste « Embuscade du pont » (${await page.evaluer(sousListe('#entity-list'))})`);
    verifier(await page.evaluer(`[...document.querySelectorAll('#entity-list details.sous-groupe .entity-item')].map(f => f.dataset.id).sort().join() === '${nouveaux.map(m => `mob:${m.id}`).sort().join()}'`),
      'carte MJ : la sous-liste contient exactement les créatures déployées');
    await page.capture('rencontres-carte.png');

    // Second déploiement de la même rencontre : seconde sous-liste « #2 ».
    const carteId = lireJson('session.json').activeMapId;
    const rencontreId = lireJson('rencontres.json')[0].id;
    await api('POST', `/api/maps/${encodeURIComponent(carteId)}/rencontres/${rencontreId}/deployer`, { x: 10, y: 10 }, mj);
    verifier(await page.attendre(`${sousListe('#entity-list')} === '⚔️ Embuscade du pont 3=3|⚔️ Embuscade du pont #2 3=3'`, 20),
      `carte MJ : second déploiement dans sa propre sous-liste « #2 » (${await page.evaluer(sousListe('#entity-list'))})`);
    await page.cliquer('.onglet[data-onglet="carte"]');
    await page.capture('rencontres-sous-listes-carte.png', '#entity-list details.sous-groupe');

    // Boutons de la sous-liste « #2 » : tout cacher, puis tout montrer (carte).
    const secondes = (await api('GET', '/api/mobs', null, mj)).donnees.filter(m => m.rencontre && !nouveaux.some(n => n.id === m.id));
    const visibilitesCarte = () => secondes.map(m => window_tokens(lireJson('maps.json'), carteId)[`mob:${m.id}`]?.visibleToPlayers).join();
    const boutonGroupe = (conteneur, rang, act) => `[...document.querySelectorAll('${conteneur} details.sous-groupe')][${rang}].querySelector('[data-groupe-act="${act}"]')`;
    await page.evaluer(`${boutonGroupe('#entity-list', 1, 'visibilite')}.click()`);
    verifier(await page.attendre(`${boutonGroupe('#entity-list', 1, 'visibilite')}?.textContent.trim() === 'Montrer'`, 20)
      && visibilitesCarte() === 'false,false,false',
    `carte MJ : « Cacher » cache d'un coup les 3 créatures de la sous-liste (${visibilitesCarte()})`);
    verifier(await page.evaluer("[...document.querySelectorAll('#entity-list details.sous-groupe')][1].open === true"),
      'carte MJ : un bouton de l\'en-tête ne replie pas la sous-liste');
    await page.evaluer(`${boutonGroupe('#entity-list', 1, 'visibilite')}.click()`);
    verifier(await page.attendre(`${boutonGroupe('#entity-list', 1, 'visibilite')}?.textContent.trim() === 'Cacher'`, 20)
      && visibilitesCarte() === 'true,true,true', `carte MJ : « Montrer » les montre de nouveau (${visibilitesCarte()})`);

    // Repliée, la sous-liste le reste après un rafraîchissement.
    await page.evaluer("document.querySelector('#entity-list details.sous-groupe summary').click()");
    await page.ouvrir('map.html');
    await page.attendre('!!window.ArcaneRendu?.state.map', 30);
    verifier(await page.attendre("document.querySelectorAll('#entity-list details.sous-groupe').length === 2", 20)
      && await page.evaluer("[...document.querySelectorAll('#entity-list details.sous-groupe')].map(g => g.open).join() === 'false,true'"),
    'carte MJ : sous-liste repliée mémorisée');

    await page.ouvrir('tableau.html?role=mj');
    verifier(await page.attendre(`${sousListe('#scene-token-list')} === '⚔️ Embuscade du pont 3=3|⚔️ Embuscade du pont #2 3=3'`, 30),
      `tableau blanc : mêmes sous-listes de rencontre (${await page.evaluer(sousListe('#scene-token-list'))})`);
    await page.capture('rencontres-tableau.png', '#scene-token-list details.sous-groupe');

    // Tableau blanc : tout cacher puis tout montrer (pions cachés de nouveau montrables).
    const visibilitesTableau = () => secondes.map(m => lireJson('session.json').scene.tokens[`mob:${m.id}`]?.visibleToPlayers).join();
    await page.evaluer(`${boutonGroupe('#scene-token-list', 1, 'visibilite')}.click()`);
    verifier(await page.attendre(`${boutonGroupe('#scene-token-list', 1, 'visibilite')}?.textContent.trim() === 'Montrer'`, 20)
      && visibilitesTableau() === 'false,false,false', `tableau blanc : « Cacher » cache la sous-liste (${visibilitesTableau()})`);
    await page.evaluer(`${boutonGroupe('#scene-token-list', 1, 'visibilite')}.click()`);
    verifier(await page.attendre(`${boutonGroupe('#scene-token-list', 1, 'visibilite')}?.textContent.trim() === 'Cacher'`, 20)
      && visibilitesTableau() === 'true,true,true', `tableau blanc : « Montrer » la montre de nouveau (${visibilitesTableau()})`);

    // Tableau blanc : retirer une créature de la partie (✖ de sa fiche, après confirmation).
    const cible = secondes[0];
    const nbDialogues = page.dialogues.length;
    await page.evaluer(`setTimeout(() => document.querySelector('#scene-token-list .entity-item[data-id="mob:${cible.id}"] [data-act="retirer"]').click(), 0)`);
    verifier(await page.attendre(`!document.querySelector('#scene-token-list .entity-item[data-id="mob:${cible.id}"]')`, 20)
      && !(await api('GET', '/api/mobs', null, mj)).donnees.some(m => m.id === cible.id),
    'tableau blanc : ✖ retire la créature de la partie');
    verifier(String(page.dialogues[nbDialogues] || '').includes(`Retirer « ${cible.nom} » de la partie`), `tableau blanc : confirmation demandée (${page.dialogues[nbDialogues]})`);

    // Tableau blanc : retirer toute la sous-liste « #2 » (✖ de l'en-tête).
    await page.evaluer(`setTimeout(() => ${boutonGroupe('#scene-token-list', 1, 'supprimer')}.click(), 0)`);
    verifier(await page.attendre(`${sousListe('#scene-token-list')} === '⚔️ Embuscade du pont 3=3'`, 20)
      && !(await api('GET', '/api/mobs', null, mj)).donnees.some(m => secondes.some(s => s.id === m.id)),
    `tableau blanc : ✖ de la sous-liste retire ses créatures de la partie (${await page.evaluer(sousListe('#scene-token-list'))})`);
    verifier(String(page.dialogues[nbDialogues + 1] || '').includes('les 2 créature(s) de « Embuscade du pont #2 »'),
      `tableau blanc : confirmation nommant la rencontre (${page.dialogues[nbDialogues + 1]})`);
    verifier(lireJson('rencontres.json').length === 1, 'la rencontre préparée reste dans Données de jeu');

    // --- Page MJ : initiative pré-remplie dans la préparation --------------------------------------
    await page.ouvrir('mj.html');
    const ligne = id => `#initiative-preparation-liste tr[data-entity="${id}"] [data-a="valeur"]`;
    const gobelinDeploye = nouveaux.find(m => m.nom.startsWith('Gobelin'));
    const chefDeploye = nouveaux.find(m => m.nom.startsWith('Chef'));
    verifier(await page.attendre(`document.querySelector('${ligne(gobelinDeploye.id)}')?.value === '13'`, 30),
      'page MJ : initiative de la rencontre pré-remplie dans la préparation du combat');
    verifier(await page.evaluer(`document.querySelector('${ligne(chefDeploye.id)}')?.value === ''`), 'page MJ : sans valeur prévue, le champ reste à saisir');

    // Mobs de la partie active : ceux de la rencontre sont regroupés dans un bloc nommé.
    const blocsMobs = `[...document.querySelectorAll('#active-mobs-list details.mobs-rencontre')].map(b =>
      b.querySelector('.mobs-rencontre-nom').textContent.trim() + '=' + [...b.querySelectorAll('.active-mob-card')].map(c => c.dataset.id).sort().join(',')).join('|')`;
    verifier(await page.attendre(`${blocsMobs} === '⚔️ Embuscade du pont=${nouveaux.map(m => m.id).sort().join(',')}'`, 20),
      `page MJ : mobs de la rencontre regroupés dans « ⚔️ Embuscade du pont » (${await page.evaluer(blocsMobs)})`);
    verifier(await page.evaluer(`!document.querySelector('#active-mobs-list > .mobs-grille .active-mob-card[data-id="${gobelinDeploye.id}"]')`),
      'page MJ : ils ne sont plus mêlés aux mobs isolés');

    // Initiative : étiquette de la rencontre sur ses créatures, pas sur les personnages.
    const etiquette = id => `document.querySelector('#initiative-preparation-liste tr[data-entity="${id}"] .etiquette-rencontre')?.textContent.trim()`;
    verifier(await page.evaluer(`${etiquette(gobelinDeploye.id)} === '⚔️ Embuscade du pont'`), 'initiative (préparation) : étiquette « ⚔️ Embuscade du pont »');
    const premierJoueur = lireJson('data.json')[0];
    verifier(await page.evaluer(`${etiquette(premierJoueur.id)} === undefined`), 'initiative (préparation) : pas d\'étiquette sur un personnage');

    // Une créature modifiée recharge la préparation sans effacer les saisies en cours.
    await page.evaluer(`(() => { const champ = document.querySelector('${ligne(premierJoueur.id)}'); champ.value = '17'; champ.focus(); })()`);
    await page.evaluer(`document.querySelector('#initiative-preparation-liste tr[data-entity="${chefDeploye.id}"] [data-a="participe"]').checked = false`);
    await api('PUT', `/api/mobs/${chefDeploye.id}`, { hp: { current: 9 } }, mj);
    await page.attendre('false', 6);
    verifier(await page.evaluer(`document.querySelector('${ligne(premierJoueur.id)}').value === '17'
        && document.querySelector('#initiative-preparation-liste tr[data-entity="${chefDeploye.id}"] [data-a="participe"]').checked === false
        && document.activeElement === document.querySelector('${ligne(premierJoueur.id)}')`),
    'initiative (préparation) : une créature modifiée ne fait pas perdre les valeurs tapées ni le champ actif');
    await page.capture('rencontres-mj.png', '#active-mobs-list');

    // En combat : l'étiquette suit la créature dans l'ordre de jeu.
    await api('POST', '/api/initiative/demarrer', { entrees: [
      { kind: 'player', entityId: premierJoueur.id, nom: premierJoueur.nom, valeur: 17 },
      { kind: 'mob', entityId: gobelinDeploye.id, nom: gobelinDeploye.nom, valeur: 13 }
    ] }, mj);
    verifier(await page.attendre(`[...document.querySelectorAll('#initiative-ordre li')].find(li => li.dataset.id === 'mob:${gobelinDeploye.id}')
        ?.querySelector('.etiquette-rencontre')?.textContent.trim() === '⚔️ Embuscade du pont'`, 20),
    'initiative (combat) : étiquette de la rencontre dans l\'ordre de jeu');
    verifier(await page.evaluer(`!document.querySelector('#initiative-ordre li[data-id="player:${premierJoueur.id}"] .etiquette-rencontre')`),
      'initiative (combat) : pas d\'étiquette sur un personnage');
    await page.capture('rencontres-initiative.png', '#initiative-ordre');
    await api('POST', '/api/initiative/terminer', {}, mj);
    await page.ouvrir('ecran.html');
    await api('POST', '/api/initiative/demarrer', { entrees: [{ kind: 'mob', entityId: gobelinDeploye.id, nom: gobelinDeploye.nom, valeur: 13 }] }, mj);
    await page.attendre("document.querySelectorAll('#initiative-ordre li').length === 1", 20);
    verifier(await page.evaluer("!document.body.innerHTML.includes('Embuscade')"), 'Écran : le nom de la rencontre n\'apparaît jamais');
    await api('POST', '/api/initiative/terminer', {}, mj);

    // --- Carte MJ : retirer toute une sous-liste de la partie (✖ de l'en-tête) --------------------
    await page.ouvrir('map.html');
    await page.attendre("document.querySelectorAll('#entity-list details.sous-groupe').length === 1", 30);
    const nbAvant = page.dialogues.length;
    await page.evaluer(`setTimeout(() => ${boutonGroupe('#entity-list', 0, 'supprimer')}.click(), 0)`);
    verifier(await page.attendre("document.querySelectorAll('#entity-list details.sous-groupe').length === 0", 20)
      && !(await api('GET', '/api/mobs', null, mj)).donnees.some(m => nouveaux.some(n => n.id === m.id)),
    'carte MJ : ✖ de la sous-liste retire ses créatures de la partie');
    verifier(String(page.dialogues[nbAvant] || '').includes('les 3 créature(s) de « Embuscade du pont »'),
      `carte MJ : confirmation nommant la rencontre (${page.dialogues[nbAvant]})`);

    function window_tokens(maps, mapId) {
      return (maps.maps || maps)[mapId]?.tokens || {};
    }
  }
};
