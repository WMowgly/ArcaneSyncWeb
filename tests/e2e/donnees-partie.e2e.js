// Données de partie : la fiche affiche l'état de jeu sans l'écraser, les jets
// de survie sont enregistrés, les liens ne transportent que l'identifiant.
module.exports = {
  nom: 'Données de partie (fiche, jeu, survie)',
  async executer({ page, verifier, session, joueur, api, lireJson }) {
    const PLAYER = joueur.id;
    await api('GET', `/api/session/player/${PLAYER}`);
    const max = session(PLAYER).hp.max;
    await api('POST', '/api/session/player', {
      id: PLAYER,
      nouvellesDonnees: { hp: { current: max - 5 }, survie: { reussi: [false, false, false], echec: [false, false, false] } }
    });
    const inventaireAvant = JSON.stringify(session(PLAYER).inventaire || []);

    // Fiche : valeurs de partie modifiables, mises à jour en direct.
    await page.ouvrir(`fiche_perso.html?PlayerId=${PLAYER}`);
    await page.attendre("document.getElementById('player_name').value !== '' && document.getElementById('player_hp').value !== ''");
    await page.attendre(`document.getElementById('player_hp_current').value === '${max - 5}'`, 20);
    verifier(await page.evaluer("document.getElementById('player_hp_current').value") === String(max - 5),
      'fiche : PV actuels lus dans la partie');
    verifier(await page.evaluer("['player_hp_current','player_mana_current','player_dura_current','def_protection','player_vie_bonus','player_intox'].every(id => !document.getElementById(id).readOnly)"),
      'fiche : champs d\'état de partie modifiables');
    await api('POST', '/api/session/player', { id: PLAYER, nouvellesDonnees: { hp: { current: max - 6 } } });
    verifier(await page.attendre(`document.getElementById('player_hp_current').value === '${max - 6}'`, 20),
      'fiche : mise à jour en direct depuis la partie');

    // Enregistrer la fiche ne remet pas les PV de partie à zéro.
    // La sauvegarde affiche une alerte puis recharge la fiche.
    await page.attendre("document.querySelectorAll('.competences-table .comp_name').length > 0", 20);
    const competencesAffichees = await page.evaluer(`[...document.querySelectorAll('.competences-table tbody tr')]
      .map(l => l.querySelector('.comp_name').value + ' = ' + l.querySelector('.comp_effet').value)`);
    verifier(await page.naviguerPar("setTimeout(() => document.getElementById('save-data-btn').click(), 0)",
      "document.getElementById('player_name').value !== ''"), 'fiche : rechargée après enregistrement');
    verifier(await page.evaluer('location.search') === `?PlayerId=${PLAYER}`, 'fiche : URL courte après enregistrement');
    verifier(session(PLAYER).hp.current === max - 6, 'fiche : PV de partie conservés après enregistrement');
    const competencesEnregistrees = (lireJson('data.json').find(j => j.id === PLAYER).competences || [])
      .map(c => `${c.nom} = ${c.effet}`);
    verifier(competencesAffichees.length > 0 && JSON.stringify(competencesEnregistrees) === JSON.stringify(competencesAffichees),
      `fiche : compétences enregistrées avec leur effet (${competencesEnregistrees.length})`);

    // PV saisis sur la fiche : la saisie n'est pas écrasée par le direct,
    // et l'enregistrement met la partie à jour.
    await page.evaluer(`(() => { const c = document.getElementById('player_hp_current');
      c.value = '${max - 8}'; c.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await api('POST', '/api/session/player', { id: PLAYER, nouvellesDonnees: { hp: { current: max - 7 } } });
    await page.attendre('false', 4);
    verifier(await page.evaluer("document.getElementById('player_hp_current').value") === String(max - 8),
      'fiche : saisie en cours non écrasée par une mise à jour en direct');
    verifier(await page.naviguerPar("setTimeout(() => document.getElementById('save-data-btn').click(), 0)",
      "document.getElementById('player_name').value !== ''"), 'fiche : rechargée après modification des PV');
    verifier(session(PLAYER).hp.current === max - 8, 'fiche : PV saisis enregistrés dans la partie');
    await page.attendre(`document.getElementById('player_hp_current').value === '${max - 8}'`, 20);
    verifier(await page.evaluer("document.getElementById('player_hp_current').value") === String(max - 8),
      'fiche : PV saisis relus après rechargement');
    // Remise à la valeur attendue par la suite du scénario.
    await api('POST', '/api/session/player', { id: PLAYER, nouvellesDonnees: { hp: { current: max - 6 } } });

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

    // Ancien lien par le nom : la fiche retrouve le personnage.
    await page.ouvrir(`fiche_perso.html?Nom=${encodeURIComponent(joueur.nom)}`);
    verifier(await page.attendre(`document.getElementById('player_name').value === ${JSON.stringify(joueur.nom)} && document.getElementById('player_hp_current').value === '${max - 6}'`, 40),
      'fiche : un ancien lien ?Nom= ouvre toujours le bon personnage');
    await page.ouvrir(`interface_jeu.html?PlayerId=${PLAYER}`);
    await page.attendre("document.getElementById('player_hp').value !== ''");

    await page.evaluer("document.getElementById('save-btn').click()");
    await page.attendre('false', 6);
    verifier(JSON.stringify(session(PLAYER).inventaire || []) === inventaireAvant, 'jeu : inventaire de partie intact après enregistrement');
    await page.capture('donnees-partie-fiche.png');
  }
};
