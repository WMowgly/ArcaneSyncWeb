// Carte MJ : les groupes PJ et MOB de la liste « Sur la carte » se replient.
module.exports = {
  nom: 'Carte MJ (groupes PJ / MOB repliables)',
  async executer({ page, verifier, api, definirCodeMj, joueur }) {
    const mj = await definirCodeMj();
    const creation = await api('POST', '/api/maps', { nom: 'Carte des groupes', force: true }, mj);
    const mapId = creation.donnees.map.id;
    await api('POST', `/api/maps/${mapId}/activate`, {}, mj);
    const mob = (await api('POST', '/api/mobs', { nom: 'Gobelin des groupes', hp: { max: 8, current: 8 } }, mj)).donnees;
    const mobId = mob?.mob?.id || mob?.id;
    await api('POST', `/api/maps/${mapId}/tokens`, { kind: 'player', entityId: joueur.id }, mj);
    await api('POST', `/api/maps/${mapId}/tokens`, { kind: 'mob', entityId: mobId }, mj);

    await page.ouvrir('map.html');
    const groupe = nom => `document.querySelector('#entity-list details[data-groupe="${nom}"]')`;
    verifier(await page.attendre(`${groupe('PJ')}?.open && ${groupe('MOB')}?.open && ${groupe('MOB')}.querySelectorAll('.entity-item').length === 1`, 60),
      'MJ : groupes PJ et MOB affichés, dépliés par défaut');

    // Replier le groupe PJ : ses cartes disparaissent, le groupe MOB reste ouvert.
    await page.cliquer('#entity-list details[data-groupe="PJ"] > summary');
    verifier(await page.attendre(`!${groupe('PJ')}.open && !${groupe('PJ')}.querySelector('.entity-item').checkVisibility() && ${groupe('MOB')}.open`, 20),
      'MJ : groupe PJ replié d\'un clic');
    await page.capture('carte-groupes-replie.png');

    // Un rafraîchissement de la liste (déplacement d'un pion) garde l'état.
    await api('PUT', `/api/maps/${mapId}/tokens/mob:${mobId}`, { visibleToPlayers: false }, mj);
    verifier(await page.attendre(`${groupe('MOB')}.textContent.includes('caché') && !${groupe('PJ')}.open`, 20),
      'MJ : groupe replié conservé quand la liste se rafraîchit');

    // Rechargement de la page : l'état est mémorisé dans le navigateur.
    await page.ouvrir('map.html');
    verifier(await page.attendre(`${groupe('PJ')} && !${groupe('PJ')}.open && ${groupe('MOB')}.open`, 60),
      'MJ : groupe replié mémorisé après rechargement');

    // Déplier à nouveau.
    await page.cliquer('#entity-list details[data-groupe="PJ"] > summary');
    verifier(await page.attendre(`${groupe('PJ')}.open`, 20), 'MJ : groupe PJ déplié d\'un clic');
  }
};
