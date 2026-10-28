// Carte MJ : la gomme efface en restant appuyé, et Ctrl + Z annule le geste.
module.exports = {
  nom: 'Carte MJ (gomme en glissé)',
  async executer({ page, verifier, api, definirCodeMj }) {
    const mj = await definirCodeMj();
    const creation = await api('POST', '/api/maps', { nom: 'Carte à gommer', force: true }, mj);
    const mapId = creation.donnees.map.id;
    await api('POST', `/api/maps/${mapId}/activate`, {}, mj);

    // Ligne de décor (y = 2, x = 1..6) et un tracé sur la ligne y = 6,
    // posé par-dessus une case de décor qui doit survivre à la gomme.
    const ligne = [1, 2, 3, 4, 5, 6].map(x => ({ x, y: 2 }));
    await api('POST', `/api/maps/${mapId}/elements/batch`, { kind: 'couleur', color: '#336699', cells: ligne }, mj);
    await api('POST', `/api/maps/${mapId}/elements/batch`, { kind: 'couleur', color: '#996633', cells: [{ x: 3, y: 6 }] }, mj);
    await api('POST', `/api/maps/${mapId}/annotations`,
      { type: 'trait', points: [{ x: 1.5, y: 6.5 }, { x: 6.5, y: 6.5 }], color: '#000000', size: 3, visibleToPlayers: true }, mj);

    // État lu par l'API (l'écriture de maps.json est différée).
    const carte = async () => (await api('GET', '/api/map/active', null, mj)).donnees.map;
    const decorLigne = async () => Object.values((await carte()).elements || {}).filter(e => e.y === 2 && e.x >= 1 && e.x <= 6).length;
    const decorSousTrace = async () => Object.values((await carte()).elements || {}).filter(e => e.y === 6 && e.x === 3).length;
    const traces = async () => Object.keys((await carte()).annotations || {}).length;

    await page.ouvrir('map.html');
    await page.attendre("document.getElementById('active-map-name').textContent.includes('Carte à gommer')", 60);
    await page.evaluer("document.querySelector('.tool-btn[data-tool=\"erase\"]').click()");
    await page.attendre('false', 3);

    // Centre d'une case en coordonnées écran (même calcul que map-core).
    const { cols, cellSize } = (await carte()).grid;
    const position = (x, y) => page.evaluer(`(() => {
      const r = document.getElementById('map-canvas').getBoundingClientRect();
      const G = ArcaneMap.GUTTER, largeur = ${cols} * ${cellSize} + G;
      const echelle = r.width / largeur;
      return [r.left + (G + (${x} + 0.5) * ${cellSize}) * echelle, r.top + (G + (${y} + 0.5) * ${cellSize}) * echelle];
    })()`);
    async function glisser(de, a) {
      const [x1, y1] = await position(...de);
      const [x2, y2] = await position(...a);
      await page.souris('mousePressed', x1, y1);
      // Deux grands pas seulement : la gomme doit relier les cases sautées.
      await page.souris('mouseMoved', (x1 + x2) / 2, (y1 + y2) / 2);
      await page.souris('mouseMoved', x2, y2);
      await page.souris('mouseReleased', x2, y2);
    }

    // 1. Décor : un seul geste efface toute la ligne.
    verifier(await decorLigne() === 6, 'préparation : 6 cases de décor');
    await glisser([1, 2], [6, 2]);
    await page.attendre('false', 6);
    const reste = await decorLigne();
    verifier(reste === 0, `gomme : les 6 cases effacées d'un seul geste (reste ${reste})`);
    await page.capture('carte-gomme.png');

    // 2. Ctrl + Z rétablit tout le geste.
    await page.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: 2, windowsVirtualKeyCode: 90 });
    await page.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: 2, windowsVirtualKeyCode: 90 });
    await page.attendre('false', 6);
    const retablies = await decorLigne();
    verifier(retablies === 6, `Ctrl + Z : le geste entier est annulé (${retablies} cases)`);

    // 3. Un geste commencé sur un tracé n'efface que les annotations.
    verifier(await traces() === 1 && await decorSousTrace() === 1, 'préparation : un tracé posé sur du décor');
    await glisser([1, 6], [6, 6]);
    await page.attendre('false', 6);
    verifier(await traces() === 0, 'gomme : le tracé est effacé en glissant');
    verifier(await decorSousTrace() === 1, 'gomme : le décor sous le tracé est conservé');
  }
};
