// Écran enrichi (V2.4) : bandeau des PV du groupe, combattant actif mis en
// avant (Écran et carte MJ), zoom et cadrage pilotés par le MJ.
module.exports = {
  nom: 'Écran enrichi : bandeau, combattant actif, cadrage',
  async executer({ page, verifier, api, definirCodeMj, lireJson }) {
    const mj = await definirCodeMj();
    const joueurs = lireJson('data.json');
    const [premier, second] = joueurs;
    const pv = id => lireJson('session.json').players[id].hp;
    const mapId = (await api('GET', '/api/map/active', null, mj)).donnees.activeMapId;
    const mob = (await api('POST', `/api/maps/${encodeURIComponent(mapId)}/spawn-mob`,
      { mob: { nom: 'Ogre lointain', hp: { max: 30, current: 30 } }, x: 40, y: 28 }, mj)).donnees.mob;

    // --- Bandeau des PV du groupe ---------------------------------------------------------
    await page.ouvrir('ecran.html');
    await page.attendre("document.getElementById('ecran-statut').textContent.includes('Synchronisé')", 30);
    verifier(await page.attendre(`document.querySelectorAll('#groupe .pj').length === ${joueurs.length}`, 30),
      `bandeau : une case par personnage (${joueurs.length})`);
    const hp = pv(premier.id);
    const caseDe = id => `#groupe .pj[data-id="${id}"]`;

    // Barre de vie au-dessus d'un jeton : on lit le pixel au centre de son
    // emplacement (vert pour des PV pleins).
    const pleinsPv = joueurs.find(j => { const h = pv(j.id); return h.max > 0 && h.current === h.max; });
    const barreVerte = ecran => page.evaluer(`(() => {
      const r = window.ArcaneRendu, carte = r.state.map, t = carte?.tokens['player:${pleinsPv.id}'];
      if (!t) return null;
      const g = carte.grid, taille = t.size || 1;
      const cx = 22 + (t.x + taille / 2) * g.cellSize, cy = 22 + (t.y + taille / 2) * g.cellSize;
      const rayon = (taille * g.cellSize) / 2 - (${ecran} ? 1 : 3);
      const y = cy - rayon - (${ecran} ? 6 : 4.5);
      const m = r.ctx.getTransform();
      const [R, G, B] = r.ctx.getImageData(Math.round(m.a * cx + m.e), Math.round(m.d * y + m.f), 1, 1).data;
      return G - R > 40 && G - B > 25;
    })()`);
    verifier(await page.evaluer(`document.querySelector('${caseDe(premier.id)} .pj-texte').textContent === '${hp.current} / ${hp.max}'`),
      'bandeau : barres et chiffres (« PV / max »)');
    verifier(await page.evaluer(`!document.querySelector('#groupe').textContent.includes('Ogre lointain')`), 'bandeau : personnages seulement');
    verifier(await barreVerte(true) === false, `Écran : pas de barre de vie au-dessus des jetons (${pleinsPv.nom})`);
    verifier(await page.evaluer(`(() => {
        const carte = document.getElementById('vue-carte').getBoundingClientRect();
        const groupe = document.getElementById('groupe').getBoundingClientRect();
        return groupe.left >= carte.right - 1 && groupe.top < carte.bottom && groupe.bottom > carte.top;
      })()`), 'PV du groupe : en colonne à droite de la carte, pas en dessous');

    const nouveau = Math.max(0, hp.current - 3);
    await api('POST', '/api/session/player', { id: premier.id, nouvellesDonnees: { hp: { current: nouveau } } });
    verifier(await page.attendre(`document.querySelector('${caseDe(premier.id)} .pj-texte').textContent === '${nouveau} / ${hp.max}'`, 20),
      'bandeau : mis à jour en direct');

    await api('POST', '/api/ecran', { groupe: false }, mj);
    verifier(await page.attendre("document.getElementById('groupe').hidden", 20), 'bandeau : masqué par le MJ');
    await api('POST', '/api/ecran', { groupe: true }, mj);
    verifier(await page.attendre("!document.getElementById('groupe').hidden", 20), 'bandeau : réaffiché par le MJ');

    // --- Combattant actif ------------------------------------------------------------------
    const r = await api('POST', '/api/initiative/demarrer', { entrees: [
      { kind: 'player', entityId: premier.id, nom: premier.nom, valeur: 20 },
      { kind: 'mob', entityId: mob.id, nom: mob.nom, valeur: 15 },
      { kind: 'player', entityId: second.id, nom: second.nom, valeur: 10 }
    ] }, mj);
    verifier(r.statut === 200, `préparation : combat lancé (${r.statut})`);
    verifier(await page.attendre(`window.ArcaneRendu.state.actifId === 'player:${premier.id}'`, 20),
      'Écran : anneau doré sur le combattant actif');
    verifier(await page.attendre(`document.querySelector('${caseDe(premier.id)}').classList.contains('actif')`, 10),
      'bandeau : case du combattant actif mise en avant');
    verifier(await page.attendre(`(() => {
        const ini = document.getElementById('initiative');
        return !ini.hidden && ini.getBoundingClientRect().right <= document.getElementById('groupe').getBoundingClientRect().left;
      })()`, 10), 'initiative : le panneau ne recouvre pas la colonne du groupe');
    await page.capture('ecran-enrichi-combat.png');

    await api('POST', '/api/initiative/suivant', {}, mj);
    verifier(await page.attendre(`window.ArcaneRendu.state.actifId === 'mob:${mob.id}' && !document.querySelector('#groupe .pj.actif')`, 20),
      'tour suivant : l\'anneau passe à la créature, le bandeau n\'a plus de case active');

    // Créature cachée : jamais signalée à la table.
    await api('POST', '/api/initiative/cacher', { id: `mob:${mob.id}` }, mj);
    verifier(await page.attendre('window.ArcaneRendu.state.actifId === null', 20), 'créature cachée : aucun anneau sur l\'Écran');
    await api('POST', '/api/initiative/cacher', { id: `mob:${mob.id}` }, mj);

    // --- Cadrage ----------------------------------------------------------------------------
    const echelle = () => page.evaluer('window.ArcaneRendu.ctx.getTransform().a');
    const entiere = await echelle();
    await api('POST', '/api/ecran', { cadrage: { x: 2, y: 2, w: 8, h: 5 } }, mj);
    verifier(await page.attendre("JSON.stringify(window.ArcaneRendu.state.cadrage) === JSON.stringify({ x: 2, y: 2, w: 8, h: 5 })", 20),
      'cadrage : reçu par l\'Écran');
    await page.attendre('false', 2);
    const zoom = await echelle();
    verifier(zoom > entiere * 2, `cadrage : la zone est agrandie (échelle ${entiere.toFixed(2)} → ${zoom.toFixed(2)})`);
    await page.capture('ecran-enrichi-cadrage.png');

    // Suivi : la vue se déplace avec le combattant actif.
    await api('POST', '/api/ecran', { suivreActif: true }, mj);
    await page.attendre('window.ArcaneRendu.state.suivreActif === true', 20);
    await page.attendre('false', 2);
    const origineMob = await page.evaluer('(() => { const t = window.ArcaneRendu.ctx.getTransform(); return [t.e, t.f]; })()');
    await api('POST', '/api/initiative/suivant', {}, mj);
    await page.attendre(`window.ArcaneRendu.state.actifId === 'player:${second.id}'`, 20);
    await page.attendre('false', 2);
    const origineJoueur = await page.evaluer('(() => { const t = window.ArcaneRendu.ctx.getTransform(); return [t.e, t.f]; })()');
    verifier(origineMob[0] !== origineJoueur[0] || origineMob[1] !== origineJoueur[1],
      'suivi : l\'Écran se recentre sur le nouveau combattant actif');
    await api('POST', '/api/ecran', { suivreActif: false, cadrage: null }, mj);
    verifier(await page.attendre(`Math.abs(window.ArcaneRendu.ctx.getTransform().a - ${entiere}) < 0.01`, 20),
      'carte entière : retour à l\'échelle de départ');

    // --- Carte MJ : anneau, zone de l'Écran, tracé du cadrage -------------------------------
    await page.ouvrir('map.html');
    await page.attendre('!!window.ArcaneRendu?.state.map', 30);
    verifier(await page.attendre(`window.ArcaneRendu.state.actifId === 'player:${second.id}'`, 20),
      'carte MJ : anneau doré sur le combattant actif');
    verifier(await barreVerte(false) === true, `carte MJ : la barre de vie reste au-dessus des jetons (${pleinsPv.nom})`);
    verifier(await page.evaluer("document.getElementById('opt-ecran-suivre').checked === false && document.getElementById('opt-ecran-groupe').checked === true"),
      'carte MJ : « Suivre » décoché, bandeau coché');

    await page.cliquer('#btn-ecran-cadrer');
    const pointCase = (x, y) => page.evaluer(`(() => {
      const r = window.ArcaneRendu; const g = r.state.map.grid; const rect = r.canvas.getBoundingClientRect();
      const echelle = rect.width / (g.cols * g.cellSize + 22);
      return [rect.left + (22 + (${x} + 0.5) * g.cellSize) * echelle, rect.top + (22 + (${y} + 0.5) * g.cellSize) * echelle];
    })()`);
    const [x1, y1] = await pointCase(3, 4);
    const [x2, y2] = await pointCase(12, 9);
    await page.souris('mousePressed', x1, y1);
    await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: (x1 + x2) / 2, y: (y1 + y2) / 2, button: 'left', buttons: 1 });
    await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x2, y: y2, button: 'left', buttons: 1 });
    await page.souris('mouseReleased', x2, y2);
    await page.attendre('false', 3);
    const cadrage = (await api('GET', '/api/ecran')).donnees.cadrage;
    verifier(JSON.stringify(cadrage) === JSON.stringify({ x: 3, y: 4, w: 10, h: 6 }),
      `carte MJ : rectangle tracé → cadrage de l'Écran (${JSON.stringify(cadrage)})`);
    verifier(await page.evaluer("document.getElementById('ecran-cadrage-etat').textContent.includes('10 × 6')"),
      'carte MJ : zone de l\'Écran indiquée');
    await page.capture('carte-mj-cadrage.png');
  }
};
