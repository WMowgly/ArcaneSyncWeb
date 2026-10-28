// Initiative : le MJ prépare et fait avancer le combat, l'Écran suit en direct.
module.exports = {
  nom: 'Initiative (MJ et Écran)',
  async executer({ page, verifier, api, definirCodeMj, lireJson }) {
    const mj = await definirCodeMj();
    await api('POST', '/api/mobs', { nom: 'Gobelin éclaireur', hp: { max: 8, current: 8 } }, mj);
    await api('POST', '/api/mobs', { nom: 'Ombre furtive', hp: { max: 8, current: 8 } }, mj);
    const joueurs = lireJson('data.json');

    // --- Préparation côté MJ ---------------------------------------------------------
    await page.ouvrir('mj.html');
    await page.attendre("document.querySelectorAll('#initiative-preparation-liste tr[data-kind]').length > 0", 40);
    const lignes = await page.evaluer("document.querySelectorAll('#initiative-preparation-liste tr[data-kind]').length");
    const vivants = (await api('GET', '/api/mobs', null, mj)).donnees.filter(m => (Number(m.hp?.current) || 0) > 0).length;
    verifier(lignes === joueurs.length + vivants, `MJ : ${lignes} combattants proposés (personnages + créatures vivantes)`);
    // Valeurs : l'ombre (cachée) joue en premier, puis le gobelin, puis les personnages.
    await page.evaluer(`(() => {
      document.querySelectorAll('#initiative-preparation-liste tr[data-kind]').forEach((ligne, i) => {
        const nom = ligne.dataset.nom;
        ligne.querySelector('[data-a="valeur"]').value = nom === 'Ombre furtive' ? 30 : nom === 'Gobelin éclaireur' ? 25 : 10 - i;
        if (nom === 'Ombre furtive') ligne.querySelector('[data-a="cache"]').checked = true;
      });
    })()`);
    await page.capture('initiative-preparation.png', '#initiative-management');
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

    // Fin du combat : le panneau disparaît.
    await api('POST', '/api/initiative/terminer', {}, mj);
    verifier(await page.attendre("document.getElementById('initiative').hidden", 20), 'Écran : panneau retiré à la fin du combat');
  }
};
