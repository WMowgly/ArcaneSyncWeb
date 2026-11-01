// Sorts reliés aux Données de jeu par leur identifiant (V2.3) : un sort
// renommé par le MJ reste relié à la fiche (plus de « hors base »).
module.exports = {
  nom: 'Sorts reliés par identifiant',
  async executer({ page, verifier, api, definirCodeMj, joueur, lireJson }) {
    const mj = await definirCodeMj();
    const PLAYER = joueur.id;
    const reference = (await api('GET', '/api/reference')).donnees;
    const sort = reference.sorts.find(s => s.niveau >= 1 && s.description && s.ecole !== 'imposition');
    verifier(sort && sort.id, `préparation : un sort de référence (${sort?.nom})`);

    // Fiche : ajouter ce sort et enregistrer.
    await page.ouvrir(`fiche_perso.html?PlayerId=${PLAYER}`);
    await page.attendre("document.getElementById('player_name').value !== ''", 40);
    const avant = await page.evaluer("document.querySelectorAll('#sorts-container .sort-row').length");
    await page.evaluer("document.getElementById('add-sort-btn').click()");
    await page.attendre(`document.querySelectorAll('#sorts-container .sort-row').length === ${avant + 1}`, 20);
    await page.evaluer(`(() => {
      const select = [...document.querySelectorAll('#sorts-container .spell_name')].pop();
      select.value = ${JSON.stringify(sort.nom)};
      select.dispatchEvent(new Event('change'));
    })()`);
    await page.naviguerPar("document.getElementById('save-data-btn').click()", "document.getElementById('player_name').value !== ''");
    const enregistre = (lireJson('data.json').find(j => j.id === PLAYER).spells || []).find(s => s.nom === sort.nom);
    verifier(enregistre?.refId === sort.id, `fiche : le sort est enregistré avec son identifiant (${enregistre?.refId})`);

    // Le MJ renomme le sort dans les Données de jeu.
    const nouveauNom = `${sort.nom} (renommé)`;
    const r = await api('PUT', `/api/reference/sorts/${encodeURIComponent(sort.id)}`, { ...sort, nom: nouveauNom }, mj);
    verifier(r.statut === 200, `Données de jeu : sort renommé (${r.statut} ${r.donnees?.message || ''})`);

    // Fiche rouverte : le sort est retrouvé sous son nouveau nom, pas « hors base ».
    await page.ouvrir(`fiche_perso.html?PlayerId=${PLAYER}`);
    await page.attendre("document.getElementById('player_name').value !== ''", 40);
    await page.attendre(`[...document.querySelectorAll('#sorts-container .spell_name')].some(s => s.value === ${JSON.stringify(nouveauNom)})`, 20);
    const etat = await page.evaluer(`(() => {
      const select = [...document.querySelectorAll('#sorts-container .spell_name')].find(s => s.value === ${JSON.stringify(nouveauNom)});
      return { trouve: !!select, horsBase: !!select?.selectedOptions[0]?.classList.contains('sort-hors-base') };
    })()`);
    verifier(etat.trouve && !etat.horsBase, 'fiche : le sort renommé reste relié (nouveau nom, pas « hors base »)');

    // Interface de Jeu : nom actuel et description de la référence.
    await page.ouvrir(`interface_jeu.html?PlayerId=${PLAYER}`);
    verifier(await page.attendre(`document.getElementById('sorts-contenu').textContent.includes(${JSON.stringify(nouveauNom)})`, 30),
      'Interface de Jeu : le sort affiche son nouveau nom');
    const texte = await page.evaluer("document.getElementById('sorts-contenu').textContent");
    verifier(texte.includes(sort.description.slice(0, 30)), 'Interface de Jeu : la description de la référence est retrouvée');

    // Anciennes fiches sans identifiant : toujours retrouvées par le nom.
    const ancien = reference.sorts.find(s => s.id !== sort.id && s.niveau >= 1 && s.description && s.ecole !== 'imposition');
    await api('POST', '/api/session/player', { id: PLAYER, nouvellesDonnees: { spells: [{ nom: ancien.nom, degats: '', niveau: 1 }] } }, mj);
    await page.ouvrir(`interface_jeu.html?PlayerId=${PLAYER}`);
    verifier(await page.attendre(`document.getElementById('sorts-contenu').textContent.includes(${JSON.stringify(ancien.description.slice(0, 30))})`, 30),
      'ancienne entrée sans identifiant : retrouvée par son nom');
  }
};
