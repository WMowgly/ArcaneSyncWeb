// Interface de Jeu (V2.3) : armes, objets équipés et compétences
// consultables en jeu, dans un bloc repliable en lecture seule.
module.exports = {
  nom: 'Interface de Jeu : équipement et compétences',
  async executer({ page, verifier, api, definirCodeMj, joueur }) {
    const mj = await definirCodeMj();
    const PLAYER = joueur.id;
    const r = await api('POST', '/api/session/player', { id: PLAYER, nouvellesDonnees: {
      armes: [{ type: 'Épée courte', degats: '1d6+1' }, { type: '', degats: '' }],
      inventaire: [
        { nom: 'Bouclier rond', type: 'Équipement', quantite: 1, emplacement: 'Bras gauche', equipe: true, description: 'Bloque une attaque par tour.' },
        { nom: 'Torche', type: 'Objet', quantite: 3, equipe: false }
      ],
      competences: [{ nom: 'Vigilance', effet: 'Avantage aux jets de perception.', niveau: 2, type: 'racial' }],
      skills_speciales: 'Parle aux corbeaux.'
    } }, mj);
    verifier(r.statut === 200, `préparation : équipement enregistré par le MJ (${r.statut})`);

    await page.largeur(1500);
    await page.ouvrir(`interface_jeu.html?PlayerId=${PLAYER}`);
    await page.evaluer("localStorage.removeItem('arcanesync.jeu.equipementOuvert')");
    await page.ouvrir(`interface_jeu.html?PlayerId=${PLAYER}`);
    await page.attendre("document.querySelectorAll('#equipement-contenu .sorts-groupe').length > 0", 40);
    const texte = () => page.evaluer("document.getElementById('equipement-contenu').textContent.replace(/\\s+/g, ' ')");
    verifier(await page.evaluer("document.getElementById('equipement-repli').open === false"), 'bloc replié par défaut');

    const contenu = await texte();
    verifier(contenu.includes('Épée courte') && contenu.includes('1d6+1'), 'armes : nom et dégâts');
    verifier(contenu.includes('Bouclier rond') && contenu.includes('Bras gauche') && !contenu.includes('Torche'),
      'objets : seulement les objets équipés');
    verifier(contenu.includes('Vigilance') && contenu.includes('Niv. 2') && contenu.includes('Race'), 'compétences : nom, niveau, origine');
    verifier(contenu.includes('Parle aux corbeaux.'), 'compétences spéciales affichées');
    verifier(await page.evaluer("!document.querySelector('#equipement-panel input, #equipement-panel textarea, #equipement-panel select')"),
      'lecture seule : aucun champ de saisie');

    // L'état replié / ouvert est mémorisé.
    await page.evaluer("document.querySelector('#equipement-repli > summary').click()");
    await page.ouvrir(`interface_jeu.html?PlayerId=${PLAYER}`);
    await page.attendre("document.querySelectorAll('#equipement-contenu .sorts-groupe').length > 0", 40);
    verifier(await page.evaluer("document.getElementById('equipement-repli').open === true"), 'bloc ouvert : reste ouvert au retour');
    await page.capture('equipement-pc.png', '#equipement-panel');

    // La fiche change (MJ) : le bloc suit en direct.
    await api('POST', '/api/session/player', { id: PLAYER, nouvellesDonnees: { armes: [{ type: 'Hache', degats: '1d8' }] } }, mj);
    verifier(await page.attendre("document.getElementById('equipement-contenu').textContent.includes('Hache')", 20),
      'mise à jour en direct quand la fiche change');

    await page.largeur(390);
    await page.ouvrir(`interface_jeu.html?PlayerId=${PLAYER}`);
    await page.attendre("document.querySelectorAll('#equipement-contenu .sorts-groupe').length > 0", 40);
    verifier(await page.evaluer('document.documentElement.scrollWidth <= window.innerWidth'), 'téléphone : aucun défilement horizontal');
    await page.capture('equipement-mobile.png', '#equipement-panel');
    await page.largeur(1500);
  }
};
