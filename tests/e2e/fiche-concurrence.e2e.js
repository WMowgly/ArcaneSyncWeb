// Fiche et éditeur MJ (V2.3) : l'éditeur du MJ écrit dans la fiche ; une
// fiche ouverte avant un changement fait ailleurs ne l'efface plus ; quitter
// une fiche non enregistrée demande confirmation.
module.exports = {
  nom: 'Fiche et éditeur MJ (enregistrements concurrents)',
  async executer({ page, verifier, api, definirCodeMj, joueur, lireJson }) {
    const mj = await definirCodeMj();
    const PLAYER = joueur.id;
    const fiche = () => lireJson('data.json').find(j => j.id === PLAYER);

    // --- Éditeur MJ : la définition va dans la fiche --------------------------------------
    await page.ouvrir('mj.html');
    const carte = `#joueurs-list .card[data-id="${PLAYER}"]`;
    await page.attendre(`!!document.querySelector('${carte}')`, 40);
    await page.evaluer(`document.querySelector('${carte} h3').click()`);
    await page.attendre("!!document.querySelector('.modal-overlay .edit-player-btn')", 20);
    await page.evaluer("document.querySelector('.modal-overlay .edit-player-btn').click()");
    verifier(await page.attendre("!!document.querySelector('#mj-player-edit-form input[name=\"force\"]')", 20),
      'éditeur MJ : formulaire ouvert');
    const force = (Number(fiche().stats?.force) || 0) + 7;
    await page.evaluer(`document.querySelector('#mj-player-edit-form input[name="force"]').value = '${force}'`);
    await page.evaluer("document.querySelector('#mj-player-edit-form .mj-save-btn').click()");
    verifier(await page.attendre(`document.querySelector('.mj-edit-message')?.textContent.includes('fiche et partie') || !document.querySelector('.modal-overlay')`, 20),
      'éditeur MJ : enregistrement confirmé');
    await page.attendre('false', 4);
    verifier(fiche().stats.force === force, `éditeur MJ : la Force (${force}) est enregistrée dans la fiche (${fiche().stats.force})`);

    // --- Fiche ouverte, puis changement fait ailleurs --------------------------------------
    await page.ouvrir(`fiche_perso.html?PlayerId=${PLAYER}`);
    await page.attendre("document.getElementById('player_name').value !== ''", 40);
    const quitter = `(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })()`;
    verifier(await page.evaluer(quitter) === false, 'fiche : quitter sans saisie → aucune confirmation');

    const versBio = "document.getElementById('bio').scrollIntoView({ block: 'center' })";
    await page.evaluer(versBio);
    await page.taper('#bio', ' — saisie du joueur');
    verifier(await page.evaluer(quitter) === true, 'fiche : quitter avec une saisie non enregistrée → confirmation demandée');

    const objet = 'Potion posée par le MJ';
    const r = await api('POST', '/api/session/player', {
      id: PLAYER, nouvellesDonnees: { inventaire: [...(fiche().inventaire || []), { nom: objet, quantite: 1 }] }
    }, mj);
    verifier(r.statut === 200 && fiche().inventaire.some(o => o.nom === objet), 'MJ : objet ajouté pendant que la fiche est ouverte');

    const dialoguesAvant = page.dialogues.length;
    await page.naviguerPar("document.getElementById('save-data-btn').click()",
      "document.getElementById('player_name').value !== ''");
    const message = page.dialogues.slice(dialoguesAvant).join(' | ');
    verifier(message.includes('modifié ailleurs') && message.includes("Rien n'a été enregistré"),
      `fiche : enregistrement périmé refusé, avec explication (${message.slice(0, 90)}…)`);
    verifier(fiche().inventaire.some(o => o.nom === objet), 'fiche : l\'objet ajouté par le MJ est conservé');
    verifier(!String(fiche().bio || '').includes('saisie du joueur'), 'fiche : rien n\'a été enregistré');

    // Après rechargement, la fiche est à jour : l'enregistrement passe.
    verifier(await page.attendre(`[...document.querySelectorAll('#inventory-body input')].some(i => i.value === ${JSON.stringify(objet)})`, 20),
      'fiche rechargée : l\'objet du MJ est affiché');
    await page.evaluer(versBio);
    await page.taper('#bio', ' — seconde saisie');
    const dialoguesAvantSucces = page.dialogues.length;
    await page.naviguerPar("document.getElementById('save-data-btn').click()",
      "document.getElementById('player_name').value !== ''");
    verifier(page.dialogues.slice(dialoguesAvantSucces).some(d => d.includes('sauvegardées avec succès')),
      'fiche à jour : enregistrement accepté');
    verifier(String(fiche().bio || '').includes('seconde saisie') && fiche().inventaire.some(o => o.nom === objet),
      'fiche à jour : la saisie est enregistrée, l\'objet du MJ conservé');
    verifier(await page.evaluer(quitter) === false, 'fiche : après enregistrement, quitter ne demande plus confirmation');
  }
};
