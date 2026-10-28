// Initiative : le MJ prépare et fait avancer le combat, l'Écran suit en direct ;
// l'ordre se change à la main (encoche ⠿ saisie à la souris, ou ▲ ▼).
module.exports = {
  nom: 'Initiative (MJ et Écran)',
  async executer({ page, verifier, api, definirCodeMj, lireJson }) {
    const mj = await definirCodeMj();
    await api('POST', '/api/mobs', { nom: 'Gobelin éclaireur', hp: { max: 8, current: 8 } }, mj);
    await api('POST', '/api/mobs', { nom: 'Ombre furtive', hp: { max: 8, current: 8 } }, mj);
    const joueurs = lireJson('data.json');
    const ordreServeur = () => lireJson('session.json').initiative.entrees.map(e => e.nom);
    const courantServeur = () => { const i = lireJson('session.json').initiative; return i.entrees[i.tour].nom; };

    /**
     * Vrai glisser à la souris : saisit l'encoche de la ligne `de` et la pose
     * sur le haut de la ligne `vers` (événements souris réels du navigateur).
     */
    async function glisser(selecteurLignes, de, vers) {
      await page.evaluer(`document.querySelector(${JSON.stringify(selecteurLignes)}).parentElement.scrollIntoView({ block: 'center' })`);
      const [x, y1, y2] = await page.evaluer(`(() => {
        const lignes = document.querySelectorAll(${JSON.stringify(selecteurLignes)});
        const p = lignes[${de}].querySelector('.poignee').getBoundingClientRect();
        const c = lignes[${vers}].getBoundingClientRect();
        return [p.x + p.width / 2, p.y + p.height / 2, c.top + 4];
      })()`);
      await page.souris('mousePressed', x, y1);
      for (let k = 1; k <= 6; k++) await page.souris('mouseMoved', x, y1 + (y2 - y1) * k / 6);
      await page.souris('mouseReleased', x, y2);
    }
    const nomsPreparation = () => page.evaluer("[...document.querySelectorAll('#initiative-preparation-liste tr[data-kind]')].map(l => l.dataset.nom)");

    // --- Préparation côté MJ ---------------------------------------------------------
    await page.ouvrir('mj.html');
    await page.attendre("document.querySelectorAll('#initiative-preparation-liste tr[data-kind]').length > 0", 40);
    const lignes = await page.evaluer("document.querySelectorAll('#initiative-preparation-liste tr[data-kind]').length");
    const vivants = (await api('GET', '/api/mobs', null, mj)).donnees.filter(m => (Number(m.hp?.current) || 0) > 0).length;
    verifier(lignes === joueurs.length + vivants, `MJ : ${lignes} combattants proposés (personnages + créatures vivantes)`);
    verifier(await page.evaluer("[...document.querySelectorAll('#initiative-preparation-liste tr[data-kind]')].every(l => l.querySelector('td:first-child .poignee'))"),
      'MJ : une encoche ⠿ à gauche de chaque ligne de préparation');
    // Valeurs : l'ombre (cachée) joue en premier, puis le gobelin, puis les personnages.
    await page.evaluer(`(() => {
      document.querySelectorAll('#initiative-preparation-liste tr[data-kind]').forEach((ligne, i) => {
        const nom = ligne.dataset.nom;
        ligne.querySelector('[data-a="valeur"]').value = nom === 'Ombre furtive' ? 30 : nom === 'Gobelin éclaireur' ? 25 : 10 - i;
        if (nom === 'Ombre furtive') ligne.querySelector('[data-a="cache"]').checked = true;
      });
    })()`);

    // Préparation : la dernière ligne glissée en tête ; l'ordre manuel est signalé.
    const avantPreparation = await nomsPreparation();
    await glisser('#initiative-preparation-liste tr[data-kind]', lignes - 1, 0);
    const apresPreparation = await nomsPreparation();
    verifier(apresPreparation[0] === avantPreparation[lignes - 1] && apresPreparation[1] === avantPreparation[0],
      `MJ : la ligne saisie par l'encoche passe en tête (${apresPreparation[0]})`);
    verifier(await page.evaluer("!document.getElementById('initiative-ordre-manuel').hidden"), 'MJ : « ordre manuel » signalé');
    await page.capture('initiative-preparation.png', '#initiative-management');
    // « Trier par initiative » : retour au classement par valeur.
    await page.evaluer("document.getElementById('initiative-trier').click()");
    const triee = await nomsPreparation();
    verifier(triee[0] === 'Ombre furtive' && triee[1] === 'Gobelin éclaireur' && await page.evaluer("document.getElementById('initiative-ordre-manuel').hidden"),
      'MJ : « Trier par initiative » reclasse la liste par valeur');

    await page.evaluer("document.getElementById('initiative-demarrer').click()");
    verifier(await page.attendre("!document.getElementById('initiative-combat').hidden", 20), 'MJ : combat lancé');
    const ordre = await page.evaluer("[...document.querySelectorAll('#initiative-ordre li .nom')].map(n => n.textContent.trim())");
    verifier(ordre[0].includes('Ombre furtive') && ordre[0].includes('(cachée)') && ordre[1].includes('Gobelin éclaireur'),
      `MJ : ordre trié par initiative (${ordre.slice(0, 2).join(' / ')})`);
    const combat = lireJson('session.json').initiative;
    verifier(combat?.actif === true, 'serveur : combat enregistré dans la partie');
    const nbCombattants = combat.entrees.length;
    await page.capture('initiative-combat-mj.png', '#initiative-management');

    // --- Écran : l'ombre cachée n'apparaît pas ---------------------------------------------
    await page.ouvrir('ecran.html');
    verifier(await page.attendre("!document.getElementById('initiative').hidden", 30), 'Écran : panneau d\'initiative affiché');
    const vu = await page.evaluer("[...document.querySelectorAll('#initiative-ordre li')].map(li => li.textContent)");
    verifier(!vu.some(t => t.includes('Ombre furtive')) && vu.length === nbCombattants - 1,
      'Écran : la créature cachée n\'est pas montrée');
    verifier(await page.evaluer("!document.getElementById('initiative-cache').hidden && !document.querySelector('#initiative-ordre li.courant')"),
      'Écran : « Un adversaire agit… » pendant le tour de la créature cachée');

    // Le MJ avance : l'Écran suit en direct.
    await api('POST', '/api/initiative/suivant', {}, mj);
    verifier(await page.attendre("document.querySelector('#initiative-ordre li.courant')?.textContent.includes('Gobelin éclaireur')", 20),
      'Écran : le tour du gobelin s\'affiche en direct');
    for (let i = 0; i < nbCombattants - 1; i++) await api('POST', '/api/initiative/suivant', {}, mj);
    verifier(await page.attendre("document.getElementById('initiative-round').textContent === '2'", 20), 'Écran : passage au round 2');
    await page.capture('initiative-ecran.png');

    // --- Pendant le combat : ordre changé à la main ---------------------------------------------
    await page.ouvrir('mj.html');
    await page.attendre("document.querySelectorAll('#initiative-ordre li').length > 1", 30);
    const avant = ordreServeur();
    const joue = courantServeur();
    // ▼ sur le premier : il passe deuxième.
    await page.evaluer("document.querySelector('#initiative-ordre li [data-a=\"descendre\"]').click()");
    await page.attendre('false', 4);
    let apres = ordreServeur();
    verifier(apres[0] === avant[1] && apres[1] === avant[0], `MJ : ▼ fait descendre d'une place (${apres.slice(0, 2).join(' / ')})`);
    verifier(courantServeur() === joue, 'MJ : changer l\'ordre ne change pas qui joue');
    // L'encoche du dernier, glissée à la souris sur le premier : il passe en tête.
    const dernier = apres[apres.length - 1];
    await glisser('#initiative-ordre li', apres.length - 1, 0);
    await page.attendre('false', 4);
    apres = ordreServeur();
    verifier(apres[0] === dernier, `MJ : l'encoche glissée à la souris place le dernier en tête (${apres[0]})`);
    verifier(await page.attendre(`document.querySelector('#initiative-ordre li .nom').textContent.includes(${JSON.stringify(dernier)})`, 20),
      'MJ : la liste affiche le nouvel ordre');
    await page.capture('initiative-ordre-manuel.png', '#initiative-management');

    // L'Écran suit le nouvel ordre.
    await page.ouvrir('ecran.html');
    verifier(await page.attendre(`!document.getElementById('initiative').hidden && document.querySelector('#initiative-ordre li')?.textContent.includes(${JSON.stringify(dernier)})`, 30),
      'Écran : le nouvel ordre est affiché');

    // Fin du combat : le panneau disparaît.
    await api('POST', '/api/initiative/terminer', {}, mj);
    verifier(await page.attendre("document.getElementById('initiative').hidden", 20), 'Écran : panneau retiré à la fin du combat');

    // --- Combat lancé dans l'ordre manuel de la préparation -------------------------------------
    await page.ouvrir('mj.html');
    await page.attendre("document.querySelectorAll('#initiative-preparation-liste tr[data-kind]').length > 1", 40);
    await glisser('#initiative-preparation-liste tr[data-kind]', 1, 0);
    const manuel = await nomsPreparation();
    await page.evaluer("document.getElementById('initiative-demarrer').click()");
    await page.attendre("!document.getElementById('initiative-combat').hidden", 20);
    verifier(JSON.stringify(ordreServeur()) === JSON.stringify(manuel), 'MJ : le combat suit l\'ordre manuel de la préparation');
    await api('POST', '/api/initiative/terminer', {}, mj);
  }
};
