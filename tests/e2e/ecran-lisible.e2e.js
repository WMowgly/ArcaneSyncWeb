// Écran partagé (V2.3) : créatures mortes masquées (option du MJ, active par
// défaut) ; étiquettes lisibles et sans chevauchement (captures).
module.exports = {
  nom: 'Écran : créatures mortes et étiquettes',
  async executer({ page, verifier, api, definirCodeMj }) {
    const mj = await definirCodeMj();
    const active = (await api('GET', '/api/map/active', null, mj)).donnees;
    verifier(active && active.activeMapId, 'préparation : une carte active');
    const mapId = active.activeMapId;

    // Deux créatures voisines aux noms longs, dont une morte.
    const poser = async (nom, x, y, hp) => {
      const r = await api('POST', `/api/maps/${encodeURIComponent(mapId)}/spawn-mob`, { mob: { nom, hp }, x, y }, mj);
      return r.donnees.mob;
    };
    const vivante = await poser('Gardien des ruines', 20, 20, { max: 12, current: 12 });
    const morte = await poser('Squelette brisé', 21, 20, { max: 8, current: 0 });
    verifier(morte?.statut === 'mort' && vivante?.statut === 'vivant', 'préparation : une créature vivante, une morte, côte à côte');

    // Ce que reçoit l'Écran : on écoute comme lui (rôle « ecran »).
    const nomsEcran = () => page.evaluer(`new Promise(resoudre => {
      const s = io({ query: { role: 'ecran' } });
      s.on('mapState', m => { resoudre(Object.values(m?.tokens || {}).map(t => t.entity?.nom || '')); s.close(); });
      s.emit('mapRequest');
      setTimeout(() => { resoudre(null); s.close(); }, 5000);
    })`);

    await page.ouvrir('ecran.html');
    await page.attendre("document.getElementById('ecran-statut').textContent.includes('Synchronisé')", 30);
    verifier((await api('GET', '/api/ecran')).donnees.masquerMorts === true, 'option : morts masqués par défaut');
    let noms = await nomsEcran();
    verifier(noms && noms.includes('Gardien des ruines') && !noms.includes('Squelette brisé'),
      `Écran : la créature morte est masquée (${JSON.stringify(noms)})`);
    await page.attendre('false', 4);
    await page.capture('ecran-morts-masques.png');

    // Le MJ décoche l'option depuis la carte.
    await page.ouvrir('map.html');
    await page.attendre("!!document.getElementById('opt-ecran-morts')", 30);
    await page.attendre('false', 2);
    verifier(await page.evaluer("document.getElementById('opt-ecran-morts').checked === true"), 'carte MJ : case cochée (état de la partie)');
    await page.evaluer("document.getElementById('opt-ecran-morts').click()");
    await page.attendre('false', 3);
    verifier((await api('GET', '/api/ecran')).donnees.masquerMorts === false, 'carte MJ : décocher enregistre l\'option');
    await page.capture('carte-mj-etiquettes.png');

    await page.ouvrir('ecran.html');
    await page.attendre("document.getElementById('ecran-statut').textContent.includes('Synchronisé')", 30);
    noms = await nomsEcran();
    verifier(noms && noms.includes('Squelette brisé'), 'Écran : option décochée → la créature morte est affichée');
    await page.attendre('false', 4);
    await page.capture('ecran-morts-visibles.png');

    // Réservé au MJ.
    const refus = await api('POST', '/api/ecran', { masquerMorts: true });
    verifier(refus.statut === 403, `option réservée au MJ (${refus.statut})`);
  }
};
