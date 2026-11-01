// Page MJ stable (V2.3) : les listes reconstruites à chaque mise à jour ne
// font plus perdre la quantité saisie, les notes ouvertes ni le champ actif.
module.exports = {
  nom: 'Page MJ stable pendant les mises à jour',
  async executer({ page, verifier, api, definirCodeMj, lireJson }) {
    const mj = await definirCodeMj();
    const [premier, second] = lireJson('data.json');
    const pvDe = id => lireJson('session.json').players[id].hp;
    const mob = (await api('POST', '/api/mobs', { nom: 'Gobelin stable', hp: { max: 30, current: 30 } }, mj)).donnees.mob;

    await page.ouvrir('mj.html');
    const carte = `#joueurs-list .card[data-id="${premier.id}"]`;
    const carteMob = `#active-mobs-list [data-id="${mob.id}"]`;
    await page.attendre(`!!document.querySelector('${carte}') && !!document.querySelector('${carteMob}')`, 40);
    const valeur = selecteur => page.evaluer(`document.querySelector(${JSON.stringify(selecteur)}).value`);

    // Le MJ saisit 7 ; un JOUEUR modifie ses PV pendant ce temps.
    await page.evaluer(`document.querySelector('${carte} [data-a="hp-amount"]').value = '7'`);
    await page.evaluer(`document.querySelector('${carte} details').open = true`);
    await page.evaluer(`document.querySelector('${carte} [data-a="hp-amount"]').focus()`);
    await api('POST', '/api/session/player', { id: second.id, nouvellesDonnees: { hp: { current: Math.max(0, pvDe(second.id).current - 1) } } });
    await page.attendre('false', 6);
    verifier(await valeur(`${carte} [data-a="hp-amount"]`) === '7', 'joueurs : la quantité saisie reste après l\'action d\'un joueur');
    verifier(await page.evaluer(`document.querySelector('${carte} details').open`), 'joueurs : les notes ouvertes restent ouvertes');
    verifier(await page.evaluer(`document.activeElement === document.querySelector('${carte} [data-a="hp-amount"]')`),
      'joueurs : le champ en cours de saisie garde le curseur');

    // Le MJ clique « − » deux fois : 7 puis encore 7.
    const avant = pvDe(premier.id).current;
    await page.evaluer(`document.querySelector('${carte} [data-a="damage-hp"]').click()`);
    await page.attendre(`document.querySelector('${carte} .stat-bar-text').textContent.startsWith('${Math.max(0, avant - 7)} /')`, 20);
    verifier(await valeur(`${carte} [data-a="hp-amount"]`) === '7', 'joueurs : la quantité reste après le clic du MJ');
    await page.evaluer(`document.querySelector('${carte} [data-a="damage-hp"]').click()`);
    await page.attendre('false', 6);
    verifier(pvDe(premier.id).current === Math.max(0, avant - 14), `joueurs : deux clics « − » retirent 2 × 7 PV (${avant} → ${pvDe(premier.id).current})`);

    // Mobs : même comportement.
    await page.evaluer(`document.querySelector('${carteMob} [data-a="hp-amount"]').value = '5'`);
    await page.evaluer(`document.querySelector('${carteMob} [data-a="damage"]').click()`);
    await page.attendre(`document.querySelector('${carteMob} .stat-bar-text')?.textContent.startsWith('25 /')`, 20);
    verifier(await valeur(`${carteMob} [data-a="hp-amount"]`) === '5', 'mobs : la quantité reste après le clic du MJ');
    await page.evaluer(`document.querySelector('${carteMob} [data-a="damage"]').click()`);
    verifier(await page.attendre(`document.querySelector('${carteMob} .stat-bar-text')?.textContent.startsWith('20 /')`, 20),
      'mobs : deux clics « − » retirent 2 × 5 PV');
  }
};
