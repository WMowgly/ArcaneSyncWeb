// Un seul bestiaire (V2.3) : les modèles de créatures se créent, se
// modifient et se suppriment dans Données de jeu ; la page MJ et la carte
// s'en servent pour ajouter des créatures à la partie.
module.exports = {
  nom: 'Bestiaire unique (Données de jeu)',
  async executer({ page, verifier, api, definirCodeMj, lireJson }) {
    const mj = await definirCodeMj();
    const modeles = () => lireJson('mob_templates.json');

    // --- Données de jeu : formulaire complet, lien direct vers l'onglet ----------------
    await page.ouvrir('modification.html#bestiaire');
    verifier(await page.attendre("document.querySelector('#onglets button.actif')?.dataset.onglet === 'bestiaire'", 30),
      'Données de jeu : le lien #bestiaire ouvre l\'onglet Bestiaire');
    await page.evaluer("document.getElementById('btn-nouveau').click()");
    await page.attendre("!!document.querySelector('#editeur input[name=\"armure_type\"]')", 10);
    const champs = ['nom', 'hp', 'mana', 'armure_type', 'armure_resistance', 'durabilite', 'protection', 'bonus_vie', 'intox', 'stat_force'];
    verifier(await page.evaluer(`${JSON.stringify(champs)}.every(n => !!document.querySelector('#editeur [name="' + n + '"]'))`),
      'Données de jeu : le formulaire reprend armure, vie bonus et intoxication');
    verifier(await page.evaluer("document.querySelector('#editeur [name=\"hp\"]').value") === '10',
      'Données de jeu : un nouveau modèle propose 10 PV');
    await page.evaluer(`(() => {
      const f = document.getElementById('editeur');
      const remplir = (n, v) => { f.querySelector('[name="' + n + '"]').value = v; };
      remplir('nom', 'Gobelin cuirassé'); remplir('hp', '14'); remplir('armure_type', 'Cuir');
      remplir('durabilite', '6'); remplir('protection', '2'); remplir('bonus_vie', '3'); remplir('intox', '1');
    })()`);
    await page.evaluer("document.getElementById('btn-enregistrer').click()");
    await page.attendre('false', 6);
    const cree = modeles().find(m => m.nom === 'Gobelin cuirassé');
    verifier(cree && cree.hp.max === 14 && cree.armure.type === 'Cuir' && cree.armure.durabilite.max === 6
      && cree.armure.protection.max === 2 && cree.bonus_vie === 3 && cree.intox === 1,
    `Données de jeu : modèle enregistré avec son armure (${JSON.stringify(cree?.armure)})`);

    // --- Page MJ : utiliser le bestiaire, sans le modifier --------------------------------
    await page.ouvrir('mj.html');
    await page.attendre("document.querySelectorAll('#mob-templates-list .mob-template-card').length > 0", 30);
    verifier(await page.evaluer("!document.getElementById('new-mob-template-btn') && !document.getElementById('save-mob-template-btn')"),
      'page MJ : plus de création de modèle');
    verifier(await page.evaluer("!!document.querySelector('#mob-management a[href=\"modification.html#bestiaire\"]')"),
      'page MJ : lien « Gérer le bestiaire » vers Données de jeu');
    verifier(await page.evaluer(`[...document.querySelectorAll('#mob-templates-list .mob-template-card')].every(c =>
        c.querySelectorAll('button').length === 1 && c.querySelector('[data-a="spawn"]'))`),
      'page MJ : chaque modèle propose seulement « Créer dans la partie »');
    const avant = (await api('GET', '/api/mobs', null, mj)).donnees.length;
    await page.evaluer(`[...document.querySelectorAll('#mob-templates-list .mob-template-card')]
      .find(c => c.textContent.includes('Gobelin cuirassé')).querySelector('[data-a="spawn"]').click()`);
    await page.attendre('false', 5);
    const mobs = (await api('GET', '/api/mobs', null, mj)).donnees;
    verifier(mobs.length === avant + 1 && mobs.some(m => m.nom.startsWith('Gobelin cuirassé') && m.armure?.type === 'Cuir'),
      'page MJ : « Créer dans la partie » ajoute la créature depuis le modèle');
    verifier(await page.evaluer("!!document.getElementById('new-mob-btn')"), 'page MJ : « Créer un mob » (en jeu) est conservé');

    // --- Carte : ajouter et placer, sans éditeur de modèle --------------------------------
    await page.ouvrir('map.html');
    await page.attendre("!!document.getElementById('best-list')", 30);
    await page.evaluer("document.querySelector('.onglet[data-onglet=\"bestiaire\"]')?.click()");
    await page.attendre("document.querySelectorAll('#best-list .best-item').length > 0", 20);
    verifier(await page.evaluer("!document.getElementById('best-editeur') && !document.getElementById('best-nouveau')"),
      'carte : plus d\'éditeur de modèle');
    verifier(await page.evaluer("document.getElementById('best-gerer')?.getAttribute('href') === 'modification.html#bestiaire'"),
      'carte : lien « Gérer » vers Données de jeu');
    verifier(await page.evaluer(`[...document.querySelectorAll('#best-list .best-item')].every(c =>
        [...c.querySelectorAll('button[data-best]')].map(b => b.dataset.best).join() === 'ajouter,placer')`),
      'carte : chaque modèle propose « ajouter » et « placer »');
  }
};
