// Interfaces : cartes des mobs, Écran piloté par le MJ, tableau blanc
// enregistré, création de personnage, police lisible.
module.exports = {
  nom: 'Interfaces (mobs, Écran, tableau blanc, création, police)',
  async executer({ page, verifier, joueur, api, lireJson, definirCodeMj }) {
    const PLAYER = joueur.id;
    const mj = await definirCodeMj();
    const apiMj = (methode, route, corps) => api(methode, route, corps, mj).then(r => r.donnees);

    // --- Cartes des mobs -------------------------------------------------------------
    const modeles = await apiMj('GET', '/api/mob-templates');
    if (!(await apiMj('GET', '/api/mobs')).length) {
      if (modeles.length) await apiMj('POST', `/api/mob-templates/${encodeURIComponent(modeles[0].id)}/spawn`, {});
      else await apiMj('POST', '/api/mobs', { nom: 'Gobelin de test', hp: { max: 10, current: 10 } });
    }
    const mob = (await apiMj('GET', '/api/mobs'))[0];
    await apiMj('PUT', `/api/mobs/${encodeURIComponent(mob.id)}`, { hp: { current: 1 } });
    await page.ouvrir('mj.html');
    await page.attendre("!!document.querySelector('.active-mob-card [data-a=\"full-hp\"]')");
    verifier(await page.evaluer(`(() => { const c = document.querySelector('.active-mob-card');
      return ['.gm-etiquette-pv', '.gm-etiquette-mana', '[data-a="damage"].gm-moins', '[data-a="heal"].gm-plus', '[data-a="full-mana"]'].every(s => c.querySelector(s)); })()`),
      'MJ : carte de mob au format des joueurs');
    await page.evaluer(`document.querySelector('.active-mob-card [data-a="full-hp"]').click()`);
    await page.attendre('false', 6);
    const mobApres = (await apiMj('GET', '/api/mobs')).find(m => m.id === mob.id);
    verifier(mobApres.hp.current === mobApres.hp.max, 'MJ : « Max » remet les PV du mob au maximum');
    await page.capture('interfaces-mobs.png', '#mob-management');

    // --- Écran piloté par le MJ ------------------------------------------------------------
    await apiMj('POST', '/api/ecran', { vue: 'carte' });
    await page.ouvrir('ecran.html');
    await page.attendre("!document.getElementById('vue-carte').hidden");
    await apiMj('POST', '/api/ecran', { vue: 'tableau' });
    verifier(await page.attendre("!document.getElementById('vue-tableau').hidden && document.getElementById('vue-carte').hidden", 20),
      'Écran : bascule au tableau blanc sur choix du MJ');
    await page.ouvrir('ecran.html');
    verifier(await page.attendre("!document.getElementById('vue-tableau').hidden", 20), 'Écran : vue retrouvée après rechargement');
    await page.ouvrir('mj.html');
    await page.attendre("document.querySelector('[data-ecran-vue=\"tableau\"]')?.getAttribute('aria-pressed') === 'true'");
    await page.evaluer(`document.querySelector('[data-ecran-vue="carte"]').click()`);
    await page.attendre('false', 4);
    verifier(lireJson('session.json').ecranVue === 'carte', 'MJ : le bouton « Carte » change la vue de l\'Écran');

    // --- Tableau blanc enregistré -------------------------------------------------------------
    await page.ouvrir('tableau.html?role=mj');
    await page.attendre("typeof traces !== 'undefined' && document.getElementById('scene-canvas').width > 0");
    // Le bac à sable part sans dessin : pas d'effacement préalable, dont l'écho
    // du serveur pourrait arriver après le trait et l'effacer.
    await page.evaluer(`(() => { document.getElementById('tool-draw').click();
      const couleur = document.getElementById('draw-color'); couleur.value = '#c00000'; couleur.dispatchEvent(new Event('input'));
      const taille = document.getElementById('draw-size'); taille.value = '12'; taille.dispatchEvent(new Event('input')); })()`);
    // Dessins déjà enregistrés reçus (aucun dans le bac à sable).
    await page.attendre('traces.length === 0', 20);
    const [cx, cy, cw, ch] = await page.evaluer("(() => { const r = document.getElementById('scene-canvas').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()");
    const y = cy + ch * 0.9;
    await page.souris('mousePressed', cx + cw * 0.2, y);
    for (let i = 1; i <= 10; i++) await page.souris('mouseMoved', cx + cw * (0.2 + i * 0.03), y);
    await page.souris('mouseReleased', cx + cw * 0.5, y);
    const pixelRouge = `(() => { const c = document.getElementById('scene-canvas');
      const p = c.getContext('2d').getImageData(Math.round(c.width * 0.35), Math.round(c.height * 0.9), 1, 1).data;
      return p[0] > 150 && p[1] < 80 && p[2] < 80; })()`;
    verifier(await page.attendre(`traces.length === 1 && ${pixelRouge}`, 20), 'tableau : trait tracé et visible');
    await page.evaluer('resizeCanvas()');
    verifier(await page.evaluer(pixelRouge), 'tableau : trait conservé après un nouveau rendu');
    await page.attendre('false', 6);
    verifier((lireJson('tableau_dessins.json').traces || []).length === 1, 'serveur : trait enregistré');
    page.repondreAuxInvites('Repaire des gobelins');
    await page.evaluer("document.getElementById('tool-text').click()");
    await page.souris('mousePressed', cx + cw * 0.6, cy + ch * 0.8);
    await page.souris('mouseReleased', cx + cw * 0.6, cy + ch * 0.8);
    verifier(await page.attendre("traces.some(t => t.type === 'texte' && t.text === 'Repaire des gobelins')", 20), 'tableau : texte ajouté');
    await page.attendre('false', 6);
    await page.ouvrir('tableau.html?role=mj');
    verifier(await page.attendre(`traces.length === 2 && ${pixelRouge}`, 30), 'tableau : dessins retrouvés après rechargement');
    await apiMj('POST', '/api/ecran', { vue: 'tableau' });
    await page.ouvrir('ecran.html');
    verifier(await page.attendre("document.querySelector('#vue-tableau iframe')?.contentWindow.eval('typeof traces !== \"undefined\" && traces.length') === 2", 40),
      'Écran ouvert après coup : voit les dessins déjà tracés');
    await page.capture('interfaces-ecran-tableau.png');

    // --- Création de personnage ------------------------------------------------------------------
    await page.ouvrir('create_player.html');
    await page.attendre("document.getElementById('player_class').options.length > 0 && document.querySelectorAll('.filtre-type')[0].options.length > 1");
    verifier(!(await page.evaluer("document.body.innerText.includes('Ceinture')")), 'création : plus de bloc Ceinture/dos');
    await page.evaluer(`(() => { const s = document.getElementById('player_class'); s.value = s.options[s.options.length - 1].value; s.dispatchEvent(new Event('change')); })()`);
    await page.attendre("document.querySelectorAll('#competences-classe-table tr[data-nom], #competences-raciales-table tr[data-nom]').length > 0", 20);
    const nbCompetences = await page.evaluer("document.querySelectorAll('#competences-classe-table tr[data-nom], #competences-raciales-table tr[data-nom]').length");
    verifier(nbCompetences > 0, 'création : compétences de classe et de race affichées');
    await page.evaluer("document.getElementById('add-sort-btn').click()");
    await page.attendre("document.querySelectorAll('#sorts-container .sort-row').length === 1");
    const ecole = await page.evaluer("[...document.querySelectorAll('.filtre-type')[0].options].map(o => o.value).filter(Boolean)[0]");
    await page.evaluer(`(() => { const f = document.querySelectorAll('.filtre-type')[0]; f.value = ${JSON.stringify(ecole)}; f.dispatchEvent(new Event('change')); })()`);
    verifier(await page.evaluer(`[...document.querySelectorAll('#sorts-container .sort-row select optgroup')].every(g => g.hidden === (g.label !== ${JSON.stringify(ecole)}))`),
      'création : le filtre « Type » ne montre que l\'école choisie');
    const sortChoisi = await page.evaluer(`(() => { const s = document.querySelector('#sorts-container .sort-row select');
      const o = [...s.querySelectorAll('optgroup')].find(g => !g.hidden).querySelector('option'); s.value = o.value; s.dispatchEvent(new Event('change')); return o.value; })()`);
    await page.evaluer(`(() => { const v = (id, x) => { const e = document.getElementById(id); e.value = x; e.dispatchEvent(new Event('input')); };
      v('player_name', 'Testeur Création'); v('player_hp', '30'); v('player_mana', '12'); v('eq_durabilite', '9'); v('def_protection_max', '4'); })()`);
    await page.capture('interfaces-creation.png', '.duo');
    await page.evaluer("document.getElementById('save_player_creation').click()");
    await page.attendre("location.pathname.endsWith('selecte_player.html')", 30);
    const cree = lireJson('data.json').find(j => j.nom === 'Testeur Création');
    verifier(!!cree, 'création : personnage enregistré');
    verifier(cree && cree.hp.current === 30 && cree.mana.current === 12 && cree.armure.durabilite.current === 9,
      'création : valeurs actuelles = maximums');
    verifier(cree && cree.spells[0]?.nom === sortChoisi && cree.competences.length === nbCompetences,
      'création : sort et compétences enregistrés');

    // --- Police lisible ----------------------------------------------------------------------------
    await page.ouvrir(`interface_jeu.html?PlayerId=${PLAYER}`);
    await page.attendre("document.getElementById('player_hp').value !== ''");
    const polices = await page.evaluer(`(() => { const p = e => getComputedStyle(e).fontFamily;
      return { texte: p(document.querySelector('.section label')), titre: p(document.querySelector('h1')) }; })()`);
    verifier(/Segoe/.test(polices.texte) && /Uncial/.test(polices.titre), 'police : texte lisible, titres en Uncial Antiqua');
  }
};
