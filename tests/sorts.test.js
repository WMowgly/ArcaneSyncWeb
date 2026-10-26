// Bac a sable de donnees : DOIT rester le tout premier require.
const bacDonnees = require('./_donnees');
const fs = require('fs');
const path = require('path');

function verifier(condition, message) {
  if (!condition) throw new Error(message);
}

const { listesSortsReference, fichierSorts } = require('../sorts');

// ---------------------------------------------------------------------------
// 1. sorts.json : la référence convertie depuis Sorts.txt
// ---------------------------------------------------------------------------
verifier(fichierSorts() === bacDonnees.chemin('database', 'sorts.json'),
  'Le test doit lire la copie du bac à sable, jamais la référence réelle.');

const ref = JSON.parse(fs.readFileSync(fichierSorts(), 'utf8'));
verifier(ref.sorts.length === 117, `117 sorts attendus, ${ref.sorts.length} trouvés.`);
verifier(ref.attaques_speciales.liste.length === 28, '28 attaques spéciales attendues.');
verifier(ref.metamorphoses.formes.length === 6, '6 métamorphoses attendues.');

const ids = [...ref.sorts, ...ref.attaques_speciales.liste, ...ref.metamorphoses.formes].map(x => x.id);
verifier(new Set(ids).size === ids.length, 'Les identifiants doivent être uniques.');

const ecoles = new Set(ref.ecoles.map(e => e.id));
ref.sorts.forEach(s => {
  verifier(s.nom && s.description && s.type_action, `Sort incomplet : ${s.id}`);
  verifier(ecoles.has(s.ecole), `École inconnue pour ${s.nom} : ${s.ecole}`);
  verifier(!/\((B|GLACE|FEU|ELEC|EAU)\)/.test(s.nom), `Marqueur resté dans le nom : ${s.nom}`);
  verifier(s.degats === null || (typeof s.degats === 'string' && s.degats),
    `Dégâts de référence : chaîne ou null attendu pour ${s.nom}.`);
  if (s.ecole === 'imposition') {
    verifier(s.niveau === null && Number.isInteger(s.cout_charges), `Imposition sans coût : ${s.nom}`);
  } else {
    verifier(Number.isInteger(s.niveau), `Niveau manquant : ${s.nom}`);
  }
});

const glace = ref.sorts.find(s => s.nom === 'Souffle de glace');
verifier(glace && glace.element === 'GLACE', "L'élément doit être extrait du nom.");
verifier(ref.sorts.some(s => s.nom === 'Lumière du sacre'), 'Le marqueur (B) doit être retiré du nom.');

// Dégâts de référence repris de la liste du MJ, tels quels.
verifier(ref.sorts.filter(s => s.degats).length === 52, '52 sorts avec dégâts de référence attendus.');
verifier(ref.attaques_speciales.liste.filter(a => a.degats).length === 10, '10 attaques avec dégâts attendues.');
verifier(ref.sorts.find(s => s.nom === 'Rayon arcanique').degats === '1d12+8', 'Dégâts de Rayon arcanique.');
verifier(ref.sorts.find(s => s.nom === 'Alarme magique').degats === null, 'Sans dégâts dans la liste : null.');
verifier(ref.attaques_speciales.liste.filter(a => a.affinite_magique).length === 6,
  '6 attaques spéciales avec affinité magique attendues.');

// ---------------------------------------------------------------------------
// 2. Listes servies par /api/game-database
// ---------------------------------------------------------------------------
const listes = listesSortsReference();
verifier(listes, 'Les listes de référence doivent être produites.');
verifier(listes.sorts_mineurs.length === 22 && listes.sorts_mineurs.every(s => s.niveau === 0),
  'Sorts mineurs = les 22 sorts de niveau 0.');
verifier(listes.sorts_majeurs.length === 95, `95 sorts majeurs attendus, ${listes.sorts_majeurs.length} trouvés.`);
verifier(listes.sorts_majeurs.slice(-4).every(s => s.ecole === 'imposition'),
  'Les impositions des mains doivent fermer la liste des sorts majeurs.');
verifier(listes.attack_special.length === 28, '28 attaques spéciales attendues.');

[...listes.sorts_mineurs, ...listes.sorts_majeurs, ...listes.attack_special].forEach(s => {
  // Champs lus par fiche_perso.html et create_player.html.
  verifier(typeof s.id === 'string' && s.nom && typeof s.description === 'string', `Entrée mal formée : ${s.id}`);
  verifier(typeof s.degats === 'string', `Dégâts (chaîne, éventuellement vide) attendus pour ${s.nom}.`);
});
verifier(listes.sorts_majeurs.find(s => s.nom === 'Rayon arcanique').degats === '1d12+8',
  'Les dégâts de référence doivent être servis aux fiches.');
verifier(listes.sorts_majeurs.every(s => s.ecole_nom), "Chaque sort doit porter le nom de son école (regroupement).");

// Repli : sans sorts.json, aucune liste n'est imposée (game_database.json fait foi).
verifier(listesSortsReference(path.join(bacDonnees.bacASable, 'absent.json')) === null,
  'Sans sorts.json, les listes de game_database.json doivent être conservées.');
const illisible = bacDonnees.chemin('illisible.json');
fs.writeFileSync(illisible, '{ pas du json');
const erreurConsole = console.error;
console.error = () => {};
try {
  verifier(listesSortsReference(illisible) === null, 'Un sorts.json illisible ne doit pas casser la route.');
} finally {
  console.error = erreurConsole;
}

// ---------------------------------------------------------------------------
// 3. Édition de la référence (interface Modification)
// ---------------------------------------------------------------------------
const sorts = require('../sorts');
const lire = () => JSON.parse(fs.readFileSync(fichierSorts(), 'utf8'));
const nbAvant = lire().sorts.length;

// Refus des saisies invalides, sans rien écrire.
verifier(!sorts.creerSort({ ecole: 'arcanique', niveau: 1, type_action: 'Principale', description: 'x' }).success,
  'Un sort sans nom doit être refusé.');
verifier(!sorts.creerSort({ nom: 'Z', ecole: 'inconnue', niveau: 1, type_action: 'Principale', description: 'x' }).success,
  'Une école inconnue doit être refusée.');
verifier(!sorts.creerSort({ nom: 'Z', ecole: 'arcanique', niveau: 'abc', type_action: 'Principale', description: 'x' }).success,
  'Un niveau non entier doit être refusé.');
verifier(!sorts.creerSort({ nom: 'Z', ecole: 'imposition', type_action: 'Principale', description: 'x' }).success,
  'Une imposition sans coût doit être refusée.');
verifier(!sorts.creerSort({ nom: 'trait d’ARCANE', ecole: 'arcanique', niveau: 0, type_action: 'Principale', description: 'x' }).success,
  'Un nom déjà pris (casse ignorée) doit être refusé.');
verifier(lire().sorts.length === nbAvant, 'Une saisie refusée ne doit rien écrire.');

// Création.
const cree = sorts.creerSort({
  nom: '  Éclair de test ', ecole: 'elementaire', niveau: '2', duree: '', type_action: 'Principale',
  element: 'elec', description: 'Inflige des dégâts.', degats: '9d9'
});
verifier(cree.success, `Création refusée : ${cree.message}`);
verifier(cree.sort.nom === 'Éclair de test' && cree.sort.niveau === 2 && cree.sort.element === 'ELEC'
  && cree.sort.duree === null && cree.sort.degats === '9d9', `Sort créé mal normalisé : ${JSON.stringify(cree.sort)}`);
verifier(cree.sort.id === 'elementaire-eclair-de-test', `Identifiant inattendu : ${cree.sort.id}`);
verifier(lire().sorts.length === nbAvant + 1, 'Le sort créé doit être écrit dans sorts.json.');
verifier(fs.existsSync(bacDonnees.chemin('database', 'sauvegardes', 'sorts.json.1')),
  'Une sauvegarde doit précéder chaque écriture de sorts.json.');

// Modification : identifiant stable.
const modifie = sorts.modifierSort(cree.sort.id, { nom: 'Éclair modifié', niveau: 3 });
verifier(modifie.success && modifie.sort.id === cree.sort.id && modifie.sort.niveau === 3,
  "La modification doit garder l'identifiant.");
verifier(!sorts.modifierSort('sort-inexistant', { nom: 'X' }).success, 'Modifier un sort inconnu doit échouer.');

// Passage en imposition : le coût remplace le niveau.
const impose = sorts.modifierSort(cree.sort.id, { ecole: 'imposition', cout_charges: 2 });
verifier(impose.success && impose.sort.niveau === null && impose.sort.cout_charges === 2,
  'Une imposition doit porter un coût et pas de niveau.');

// Duplication : copie indépendante, juste après l'original.
const double = sorts.dupliquerSort(cree.sort.id);
verifier(double.success && double.sort.id !== cree.sort.id && double.sort.nom === 'Éclair modifié (copie)',
  `Duplication incorrecte : ${JSON.stringify(double.sort)}`);
sorts.modifierSort(double.sort.id, { description: 'Autre texte.' });
verifier(lire().sorts.find(s => s.id === cree.sort.id).description === 'Inflige des dégâts.',
  "Modifier la copie ne doit jamais toucher l'original.");
const ordre = lire().sorts.map(s => s.id);
verifier(ordre.indexOf(double.sort.id) === ordre.indexOf(cree.sort.id) + 1, 'La copie doit suivre l’original.');
verifier(sorts.dupliquerSort(cree.sort.id).sort.nom === 'Éclair modifié (copie 2)', 'Deuxième copie mal nommée.');

// Visible dans les listes servies aux fiches.
verifier(listesSortsReference().sorts_majeurs.some(s => s.nom === 'Éclair modifié'),
  'Un sort ajouté doit apparaître dans les listes des fiches.');

// Suppression.
['Éclair modifié', 'Éclair modifié (copie)', 'Éclair modifié (copie 2)'].forEach(nom => {
  const s = lire().sorts.find(x => x.nom === nom);
  verifier(s && sorts.supprimerSort(s.id).success, `Suppression de ${nom} impossible.`);
});
verifier(lire().sorts.length === nbAvant, 'Après suppression, la référence doit revenir à son état initial.');
verifier(!sorts.supprimerSort('sort-inexistant').success, 'Supprimer un sort inconnu doit échouer.');

// Attaques spéciales : même cycle, niveau facultatif.
const attaque = sorts.creerAttaque({ nom: 'Coup de test', armes: 'EPÉE', niveau: '', description: 'Frappe.' });
verifier(attaque.success && attaque.attaque.niveau === null && attaque.attaque.affinite_magique === false,
  `Création d'attaque incorrecte : ${JSON.stringify(attaque)}`);
verifier(!sorts.creerAttaque({ nom: 'Tourbillon', description: 'x' }).success, 'Nom d’attaque déjà pris : refus attendu.');
verifier(!sorts.creerAttaque({ nom: 'Y', niveau: 99, description: 'x' }).success, 'Niveau hors limites : refus attendu.');
const attaqueModifiee = sorts.modifierAttaque(attaque.attaque.id, { niveau: 2, affinite_magique: true });
verifier(attaqueModifiee.success && attaqueModifiee.attaque.niveau === 2 && attaqueModifiee.attaque.affinite_magique,
  "Modification d'attaque incorrecte.");
const attaqueCopie = sorts.dupliquerAttaque(attaque.attaque.id);
verifier(attaqueCopie.success && attaqueCopie.attaque.nom === 'Coup de test (copie)', "Duplication d'attaque incorrecte.");
verifier(sorts.supprimerAttaque(attaque.attaque.id).success && sorts.supprimerAttaque(attaqueCopie.attaque.id).success,
  "Suppression d'attaque impossible.");
verifier(lire().attaques_speciales.liste.length === 28, 'Les attaques doivent revenir à 28.');
verifier(lire().metamorphoses.formes.length === 6, 'Les métamorphoses ne doivent jamais être touchées.');

// Câblage des routes : écritures réservées au MJ.
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
verifier(serverSource.includes("require('./sorts')") && serverSource.includes('listesSortsReference()'),
  '/api/game-database doit servir les listes de sorts.json.');
const routesEcriture = serverSource.match(/app\.(post|put|delete)\('\/api\/reference[^]*?\n\}\);/g) || [];
verifier(routesEcriture.length === 8 && routesEcriture.every(r => r.includes('refuserSiPasMj')),
  `Les 8 routes d'écriture de la référence doivent être réservées au MJ (${routesEcriture.length} trouvées).`);

console.log('PASS: sorts — référence sorts.json, listes des fiches, édition MJ (créer, modifier, dupliquer, supprimer), sauvegarde');
