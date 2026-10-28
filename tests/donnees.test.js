// Bac a sable de donnees : DOIT rester le tout premier require.
const bacDonnees = require('./_donnees');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Données de jeu : dégâts de référence lisibles, game_database.json nettoyé,
// métamorphoses éditables et affichées aux druides.
// ---------------------------------------------------------------------------
function verifier(condition, message) {
  if (!condition) throw new Error(message);
}
const source = (...segments) => fs.readFileSync(path.join(__dirname, '..', ...segments), 'utf8');
const sorts = require('../sorts');
const lire = () => JSON.parse(fs.readFileSync(sorts.fichierSorts(), 'utf8'));

// --- Dégâts de référence : une seule expression ------------------------------------
{
  const ref = lire();
  // « 1d8+2 », « 2d20+20 », « 12 », « +10 », « 4 PV » : plus de « ; » ni de « DGT ».
  const FORMAT = /^(\+?\d+|\d+d\d+([+-]\d+)?|\d+ PV)$/;
  for (const entree of [...ref.sorts, ...ref.attaques_speciales.liste]) {
    if (entree.degats === null) continue;
    verifier(FORMAT.test(entree.degats), `Dégâts non simplifiés pour ${entree.nom} : « ${entree.degats} »`);
  }
  const degats = nom => [...ref.sorts, ...ref.attaques_speciales.liste].find(x => x.nom === nom)?.degats;
  verifier(degats('Lance transperçante') === '1d8+2', 'Lance transperçante : 1d8+2 attendu.');
  verifier(degats('Jugement dernier') === '2d20+20', 'Jugement dernier : 2d20+20 (d\'après la description).');
  verifier(degats('Intervention divine') === '1d20+4', 'Intervention divine : 1d20+4 (d\'après la description).');
  verifier(degats('Baie régénératrice') === '4 PV', 'Soins : « 4 PV » attendu.');
}
console.log('PASS: dégâts de référence — une expression par sort, valeurs complétées d\'après les descriptions');

// --- game_database.json -----------------------------------------------------------------
{
  const base = JSON.parse(fs.readFileSync(bacDonnees.chemin('database', 'game_database.json'), 'utf8'));
  for (const cle of ['sorts_majeurs', 'sorts_mineurs', 'attack_special']) {
    verifier(!(cle in base), `game_database.json ne doit plus contenir la liste de test ${cle}.`);
  }
  verifier(base.armures.every(a => Number.isInteger(a.id_armure) && !('id_race' in a)), 'Les armures doivent porter id_armure.');
  verifier(new Set(base.armures.map(a => a.id_armure)).size === base.armures.length, 'Identifiants d\'armure en double.');
  verifier(new Set(base.races.map(r => r.id_race)).size === base.races.length, 'Identifiants de race en double.');
  verifier(new Set(base.classes.map(c => c.id)).size === base.classes.length, 'Identifiants de classe en double.');
  verifier(/sorts_majeurs: \[\],\s*sorts_mineurs: \[\],\s*attack_special: \[\]/.test(require('./_sources').sourceServeur()),
    'Sans sorts.json, la route doit servir des listes vides.');
}
console.log('PASS: game_database.json — listes de test retirées, identifiants corrigés');

// --- Métamorphoses : édition ---------------------------------------------------------------
{
  const avant = lire().metamorphoses.formes.length;
  verifier(!sorts.creerForme({ niveau: 1, for: 1, dex: 1, const: 1, pv: 1 }).success, 'Forme sans nom : refus attendu.');
  verifier(!sorts.creerForme({ nom: 'Colibri', niveau: 1, for: 1, dex: 1, const: 1, pv: 1 }).success, 'Nom déjà pris : refus attendu.');
  verifier(!sorts.creerForme({ nom: 'X', niveau: 1, for: 'beaucoup', dex: 1, const: 1, pv: 1 }).success, 'FOR non entière : refus attendu.');
  verifier(lire().metamorphoses.formes.length === avant, 'Une saisie refusée ne doit rien écrire.');

  const cree = sorts.creerForme({
    nom: ' Sanglier de test ', niveau: '2', for: '60', dex: 30, const: 70, pv: '25', taille: 'Moyen',
    attaque_base: '1d10 + 3', description: 'Charge.', competence: { nom: 'Défenses', effet: 'Renverse la cible.' }
  });
  verifier(cree.success, `Création refusée : ${cree.message}`);
  verifier(cree.forme.id === 'forme-sanglier-de-test' && cree.forme.nom === 'Sanglier de test' && cree.forme.for === 60
    && cree.forme.pv === 25 && cree.forme.competence?.nom === 'Défenses', `Forme mal normalisée : ${JSON.stringify(cree.forme)}`);

  const modifiee = sorts.modifierForme(cree.forme.id, { pv: 40, competence: { nom: '', effet: '' } });
  verifier(modifiee.success && modifiee.forme.pv === 40 && modifiee.forme.competence === null && modifiee.forme.id === cree.forme.id,
    'Modification de forme incorrecte.');
  const copie = sorts.dupliquerForme(cree.forme.id);
  verifier(copie.success && copie.forme.nom === 'Sanglier de test (copie)', 'Duplication de forme incorrecte.');
  verifier(sorts.supprimerForme(cree.forme.id).success && sorts.supprimerForme(copie.forme.id).success, 'Suppression de forme impossible.');
  verifier(lire().metamorphoses.formes.length === avant, 'La référence doit revenir à son état initial.');
  verifier(!sorts.supprimerForme('forme-inexistante').success, 'Supprimer une forme inconnue doit échouer.');

  const serveur = require('./_sources').sourceServeur();
  for (const route of ["app.post('/api/reference/metamorphoses'", "app.put('/api/reference/metamorphoses/:id'",
    "app.delete('/api/reference/metamorphoses/:id'", "app.post('/api/reference/metamorphoses/:id/duplicate'"]) {
    const debut = serveur.indexOf(route);
    verifier(debut >= 0 && serveur.slice(debut, debut + 120).includes('refuserSiPasMj'), `${route} : route MJ attendue.`);
  }
}
console.log('PASS: métamorphoses — création, modification, duplication, suppression, routes MJ');

// --- Affichage ------------------------------------------------------------------------------
{
  const modification = source('website', 'modification.html');
  verifier(modification.includes('data-onglet="metamorphoses"') && modification.includes('function formulaireForme'),
    'Onglet Métamorphoses absent des Données de jeu.');
  const fiche = source('website', 'fiche_perso.html');
  verifier(fiche.includes('id="metamorphoses-section" hidden') && /druide/i.test(fiche.slice(fiche.indexOf('function majMetamorphoses'))),
    'La fiche doit afficher les métamorphoses aux druides seulement.');
}
console.log('PASS: métamorphoses — onglet des Données de jeu, section de la fiche des druides');
