// Données de jeu : onglet Métamorphoses, fiche des druides, dégâts simplifiés.
module.exports = {
  nom: 'Données de jeu (métamorphoses, dégâts)',
  async executer({ page, verifier, joueur, lireJson, definirCodeMj }) {
    await definirCodeMj();
    const formes = () => lireJson('database/sorts.json').metamorphoses.formes;
    const nbFormes = formes().length;

    // --- Onglet Métamorphoses ---------------------------------------------------------
    await page.ouvrir('modification.html');
    await page.attendre(`document.querySelector('[data-onglet="metamorphoses"] .compte')?.textContent === '(${nbFormes})'`);
    await page.evaluer("document.querySelector('[data-onglet=\"metamorphoses\"]').click()");
    verifier(await page.attendre(`document.querySelectorAll('#liste button[data-id]').length === ${nbFormes}`, 10),
      `Données de jeu : ${nbFormes} formes listées`);
    await page.evaluer("document.getElementById('btn-nouveau').click()");
    await page.evaluer(`(() => { const f = document.getElementById('editeur'); const v = (n, x) => { f.querySelector('[name="' + n + '"]').value = x; };
      v('nom', 'Sanglier navigateur'); v('niveau', '2'); v('for', '60'); v('dex', '30'); v('const', '70'); v('pv', '25');
      v('competence_nom', 'Défenses'); v('competence_effet', 'Renverse la cible.'); })()`);
    await page.evaluer("document.getElementById('btn-enregistrer').click()");
    await page.attendre('false', 6);
    const creee = formes().find(f => f.nom === 'Sanglier navigateur');
    verifier(creee && creee.for === 60 && creee.competence?.nom === 'Défenses', 'Données de jeu : forme créée');
    await page.capture('donnees-jeu-metamorphoses.png');
    await page.evaluer("document.getElementById('btn-supprimer').click()");
    await page.attendre('false', 6);
    verifier(!formes().some(f => f.nom === 'Sanglier navigateur'), 'Données de jeu : forme supprimée');

    // --- Fiche : métamorphoses des druides ----------------------------------------------
    await page.ouvrir(`fiche_perso.html?PlayerId=${joueur.id}`);
    await page.attendre("document.getElementById('player_name').value !== ''");
    if (!/druide/i.test(await page.evaluer("document.getElementById('player_class').value"))) {
      verifier(await page.evaluer("document.getElementById('metamorphoses-section').hidden"), 'fiche (non druide) : pas de métamorphoses');
    }
    await page.evaluer("(() => { const s = document.getElementById('player_class'); s.value = 'Druide'; s.dispatchEvent(new Event('change')); })()");
    verifier(await page.attendre(`!document.getElementById('metamorphoses-section').hidden && document.querySelectorAll('.forme').length === ${nbFormes}`, 20),
      'fiche (druide) : métamorphoses affichées');
    await page.evaluer("(() => { const l = document.getElementById('player_level'); l.value = '1'; l.dispatchEvent(new Event('input')); })()");
    verifier(await page.attendre("document.querySelectorAll('.forme.verrouillee').length > 0", 10), 'fiche (druide niv. 1) : formes supérieures atténuées');
    await page.evaluer("(() => { const l = document.getElementById('player_level'); l.value = '20'; l.dispatchEvent(new Event('input')); })()");
    verifier(await page.attendre("document.querySelectorAll('.forme.verrouillee').length === 0", 10), 'fiche (druide niv. 20) : toutes les formes accessibles');
    await page.capture('donnees-jeu-druide.png', '#metamorphoses-section');

    // --- Dégâts de référence simplifiés -----------------------------------------------------
    await page.ouvrir('create_player.html');
    await page.attendre("document.getElementById('player_class').options.length > 0");
    await page.evaluer("document.getElementById('add-sort-btn').click()");
    await page.attendre("document.querySelectorAll('#sorts-container .sort-row').length === 1");
    const degats = await page.evaluer(`(() => { const s = document.querySelector('#sorts-container select');
      s.value = 'Jugement dernier'; s.dispatchEvent(new Event('change')); return document.querySelector('#sorts-container .sort-degats').value; })()`);
    verifier(degats === '2d20+20', `création : Jugement dernier pré-remplit « ${degats} »`);
  }
};
