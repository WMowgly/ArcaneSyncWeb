// Image de fond : choisie par le MJ sur la carte, visible sur l'Écran.
module.exports = {
  nom: 'Image de fond de carte',
  async executer({ page, verifier, api, definirCodeMj, fichierExiste }) {
    const mj = await definirCodeMj();
    const creation = await api('POST', '/api/maps', { nom: 'Carte au fond rouge', force: true }, mj);
    const mapId = creation.donnees.map.id;
    await api('POST', `/api/maps/${mapId}/activate`, {}, mj);

    // Choix d'une image (rouge, générée dans la page) par le champ fichier.
    await page.ouvrir('map.html');
    await page.attendre("!!document.getElementById('map-fond-image') && document.getElementById('active-map-name').textContent.includes('Carte au fond rouge')", 60);
    await page.evaluer(`new Promise(fin => {
      const c = document.createElement('canvas'); c.width = 8; c.height = 8;
      const g = c.getContext('2d'); g.fillStyle = '#ff0000'; g.fillRect(0, 0, 8, 8);
      c.toBlob(blob => {
        const transfert = new DataTransfer();
        transfert.items.add(new File([blob], 'fond.png', { type: 'image/png' }));
        const champ = document.getElementById('map-fond-image');
        champ.files = transfert.files;
        champ.dispatchEvent(new Event('change'));
        fin();
      }, 'image/png');
    })`);
    verifier(await page.attendre("!document.getElementById('btn-fond-retirer').disabled", 40), 'MJ : image de fond enregistrée');
    verifier(fichierExiste(`cartes_fonds/${mapId}.png`), 'serveur : fichier rangé dans cartes_fonds/');

    // L'Écran affiche la carte du groupe, image comprise.
    await api('POST', '/api/ecran', { vue: 'carte' }, mj);
    await page.ouvrir('ecran.html');
    const majoriteRouge = `(() => {
      const c = document.getElementById('map-canvas'); const g = c.getContext('2d');
      let rouges = 0;
      for (const [fx, fy] of [[0.55, 0.55], [0.7, 0.7], [0.85, 0.6], [0.6, 0.85], [0.75, 0.45]]) {
        const p = g.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data;
        if (p[0] > 200 && p[1] < 90 && p[2] < 90) rouges++;
      }
      return rouges >= 3;
    })()`;
    verifier(await page.attendre(majoriteRouge, 40), 'Écran : image de fond dessinée sous la grille');
    await page.capture('fond-carte-ecran.png');

    // Retrait depuis la carte MJ : l'Écran revient à la couleur de fond.
    await page.ouvrir('map.html');
    await page.attendre("!document.getElementById('btn-fond-retirer').disabled", 40);
    // Clic différé : la confirmation (acceptée automatiquement) ne bloque pas l'évaluation.
    await page.evaluer("setTimeout(() => document.getElementById('btn-fond-retirer').click(), 0)");
    verifier(await page.attendre("document.getElementById('btn-fond-retirer').disabled", 40), 'MJ : image retirée');
    await page.ouvrir('ecran.html');
    await page.attendre("!!document.getElementById('map-canvas')", 20);
    await page.attendre('false', 8);
    verifier(!(await page.evaluer(majoriteRouge)), 'Écran : plus d\'image après le retrait');
  }
};
