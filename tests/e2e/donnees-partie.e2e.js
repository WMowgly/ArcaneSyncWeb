// Données de partie : la fiche affiche l'état de jeu sans l'écraser, les jets
// de survie sont enregistrés, les liens ne transportent que l'identifiant.
module.exports = {
  nom: 'Données de partie (fiche, jeu, survie)',
  async executer({ page, verifier, session, joueur, api }) {
    const PLAYER = joueur.id;
    await api('GET', `/api/session/player/${PLAYER}`);
    const max = session(PLAYER).hp.max;
    await api('POST', '/api/session/player', {
      id: PLAYER,
      nouvellesDonnees: { hp: { current: max - 5 }, survie: { reussi: [false, false, false], echec: [false, false, false] } }
    });
    const inventaireAvant = JSON.stringify(session(PLAYER).inventaire || []);

    // Fiche : valeurs de partie en lecture seule, mises à jour en direct.
    await page.ouvrir(`fiche_perso.html?PlayerId=${PLAYER}`);
    await page.attendre("document.getElementById('player_name').value !== '' && document.getElementById('player_hp').value !== ''");
    await page.attendre(`document.getElementById('player_hp_current').value === '${max - 5}'`, 20);
    verifier(await page.evaluer("document.getElementById('player_hp_current').value") === String(max - 5),
      'fiche : PV actuels lus dans la partie');
    verifier(await page.evaluer("['player_hp_current','player_mana_current','player_dura_current','def_protection','player_vie_bonus','player_intox'].every(id => document.getElementById(id).readOnly)"),
      'fiche : champs d\'état de partie en lecture seule');
    await api('POST', '/api/session/player', { id: PLAYER, nouvellesDonnees: { hp: { current: max - 6 } } });
    verifier(await page.attendre(`document.getElementById('player_hp_current').value === '${max - 6}'`, 20),
      'fiche : mise à jour en direct depuis la partie');

    // Enregistrer la fiche ne remet pas les PV de partie à zéro.
    // La sauvegarde affiche une alerte puis recharge la fiche.
    verifier(await page.naviguerPar("setTimeout(() => document.getElementById('save-data-btn').click(), 0)",
      "document.getElementById('player_name').value !== ''"), 'fiche : rechargée après enregistrement');
    verifier(await page.evaluer('location.search') === `?PlayerId=${PLAYER}`, 'fiche : URL courte après enregistrement');
    verifier(session(PLAYER).hp.current === max - 6, 'fiche : PV de partie conservés après enregistrement');

    verifier(await page.naviguerPar("setTimeout(() => document.getElementById('retour-jeu-btn').click(), 0)",
      "location.pathname.endsWith('interface_jeu.html') && document.getElementById('player_hp').value !== ''"),
      'retour au jeu : Interface de Jeu ouverte');
    verifier(await page.evaluer('location.search') === `?PlayerId=${PLAYER}`, 'retour au jeu : URL courte');

    // Jets de survie enregistrés et relus.
    await page.evaluer(`document.querySelector('input[name="survie1"][value="reussi"]').click()`);
    await page.evaluer(`document.querySelector('input[name="survie2"][value="echec"]').click()`);
    await page.attendre('false', 5);
    const survie = session(PLAYER).survie;
    verifier(survie?.reussi?.[0] === true && survie?.echec?.[1] === true, 'jeu : jets de survie enregistrés');
    await page.ouvrir(`interface_jeu.html?PlayerId=${PLAYER}`);
    verifier(await page.attendre(`document.querySelector('input[name="survie1"][value="reussi"]').checked && document.querySelector('input[name="survie2"][value="echec"]').checked`, 30),
      'jeu : jets de survie relus après rechargement');

    await page.evaluer("document.getElementById('save-btn').click()");
    await page.attendre('false', 6);
    verifier(JSON.stringify(session(PLAYER).inventaire || []) === inventaireAvant, 'jeu : inventaire de partie intact après enregistrement');
    await page.capture('donnees-partie-fiche.png');
  }
};
