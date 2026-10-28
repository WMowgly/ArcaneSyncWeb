// Bac a sable de donnees : DOIT rester le tout premier require.
const bacDonnees = require('./_donnees');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Cohérence des interfaces : tableau blanc enregistré, Écran piloté par le
// MJ, cartes des mobs, page de création, police lisible.
// ---------------------------------------------------------------------------
function verifier(condition, message) {
  if (!condition) throw new Error(message);
}
const source = (...segments) => fs.readFileSync(path.join(__dirname, '..', ...segments), 'utf8');

// --- Tableau blanc : traits et textes conservés ----------------------------------
{
  const storage = require('../storage');
  const tableau = require('../tableau');
  tableau.vider();

  verifier(tableau.ajouterTrait({ points: [[10, 10], [20, 25], [30, 40]], color: '#AA0000', size: 4 }), 'Trait valide refusé.');
  verifier(!tableau.ajouterTrait({ points: [[10, 10]], color: '#aa0000', size: 4 }), 'Un trait d\'un seul point doit être refusé.');
  verifier(!tableau.ajouterTrait({ points: [[0, 0], [5, 5]], color: 'red; background:url(x)', size: 4 }), 'Une couleur invalide doit être refusée.');
  verifier(!tableau.ajouterTrait({ points: [[0, 0], [1e9, 5]], color: '#000000' }), 'Des coordonnées absurdes doivent être refusées.');
  verifier(tableau.ajouterTexte({ x: 100, y: 200, text: '  Gobelins au nord  ', color: '#000000', size: 3 }), 'Texte valide refusé.');
  verifier(!tableau.ajouterTexte({ x: 100, y: 200, text: '   ', color: '#000000' }), 'Un texte vide doit être refusé.');

  const traces = tableau.getTraces();
  verifier(traces.length === 2, `Deux dessins attendus, ${traces.length} obtenus.`);
  verifier(traces[0].color === '#aa0000' && traces[0].points.length === 3, 'Trait mal normalisé.');
  verifier(traces[1].text === 'Gobelins au nord', 'Texte mal normalisé.');

  const borne = tableau.ajouterTrait({ points: [[0, 0], [1, 1]], color: '#000000', size: 999 });
  verifier(borne.size === 50, 'L\'épaisseur doit être bornée à 50.');

  // Persistance : relu par un module neuf (comme au redémarrage du serveur).
  storage.flushAll();
  const fichier = bacDonnees.chemin('tableau_dessins.json');
  verifier(fs.existsSync(fichier), 'tableau_dessins.json non écrit.');
  delete require.cache[require.resolve('../tableau')];
  const relu = require('../tableau');
  verifier(relu.getTraces().length === 3, 'Les dessins doivent survivre à un redémarrage.');

  relu.vider();
  storage.flushAll();
  delete require.cache[require.resolve('../tableau')];
  verifier(require('../tableau').getTraces().length === 0, 'Effacer le tableau doit être enregistré.');

  const serveur = require('./_sources').sourceServeur();
  verifier(serveur.includes("socket.on('tableauTrait'") && serveur.includes("socket.on('tableauTracesRequest'"), 'Le serveur doit enregistrer et renvoyer les dessins.');
  verifier(/socket\.on\('clearDrawings'[\s\S]{0,200}role !== 'mj'[\s\S]{0,80}tableau\.vider\(\)/.test(serveur), 'Seul le MJ peut effacer le tableau.');
  const page = source('website', 'tableau.html');
  verifier(page.includes("socket.emit('tableauTracesRequest')") && page.includes('traces.forEach(dessinerTrace)'),
    'Le tableau doit recharger et redessiner les dessins enregistrés.');
}
console.log('PASS: tableau blanc — traits et textes validés, enregistrés, relus au redémarrage, effacement MJ');

// --- Écran partagé : vue choisie par le MJ ------------------------------------------
{
  const session = require('../session');
  verifier(['carte', 'tableau'].includes(session.getEcranVue()), 'Vue d\'écran initiale invalide.');
  verifier(session.setEcranVue('tableau').success && session.getEcranVue() === 'tableau', 'Choix « tableau » non appliqué.');
  verifier(!session.setEcranVue('autre').success && session.getEcranVue() === 'tableau', 'Une vue inconnue doit être refusée.');
  const fichier = JSON.parse(fs.readFileSync(bacDonnees.chemin('session.json'), 'utf8'));
  verifier(fichier.ecranVue === 'tableau', 'La vue de l\'écran doit être enregistrée dans la partie.');
  session.setEcranVue('carte');

  const serveur = require('./_sources').sourceServeur();
  verifier(/app\.post\('\/api\/ecran'[\s\S]{0,80}refuserSiPasMj/.test(serveur), 'Le choix de la vue doit être réservé au MJ.');
  verifier(serveur.includes("io.emit('ecranVue'"), 'Le choix doit être diffusé aux écrans.');
  const ecran = source('website', 'ecran.html');
  verifier(ecran.includes("socket.on('ecranVue'") && !ecran.includes('<button type="button" data-vue='),
    'L\'Écran doit suivre la vue du MJ, sans boutons de choix.');
  verifier(source('website', 'mj.html').includes('data-ecran-vue="tableau"'), 'Commande de l\'Écran absente de l\'interface MJ.');
}
console.log('PASS: Écran — vue choisie par le MJ, enregistrée, diffusée, appliquée');

// --- Cartes des mobs : même format que les joueurs --------------------------------------
{
  const mj = source('website', 'mj.html');
  const debut = mj.indexOf('async function loadActiveMobs');
  const carteMob = mj.slice(debut, mj.indexOf('activeMobsList.appendChild(c)', debut));
  for (const attendu of ['gm-etiquette-pv', 'gm-etiquette-mana', 'data-a="full-hp"', 'data-a="full-mana"', 'class="gm-moins"', 'class="gm-plus"']) {
    verifier(carteMob.includes(attendu), `Carte mob : ${attendu} absent.`);
  }
  verifier(!mj.includes('active-mob-resource'), 'L\'ancien format des commandes de mob doit avoir disparu.');
}
console.log('PASS: cartes des mobs — jauges groupées, commandes colorées, bouton Max');

// --- Page de création alignée sur la fiche ----------------------------------------------
{
  const creation = source('website', 'create_player.html');
  verifier(!creation.includes('Ceinture/dos'), 'Le bloc Ceinture/dos doit être retiré de la création.');
  verifier((creation.match(/class="filtre-type"/g) || []).length === 3, 'Filtres par type attendus sur les trois listes.');
  verifier(creation.includes('competences-classe-table') && creation.includes('competences-raciales-table'), 'Compétences de classe et de race absentes.');
  verifier(!creation.includes('class_skill_name_'), 'La création ne doit plus lire de champs inexistants.');
  verifier(creation.includes('class="duo"'), 'Mise en page deux par deux attendue.');
}
console.log('PASS: création — alignée sur la fiche (filtres, compétences, sans Ceinture/dos)');

// --- Police lisible sur les pages joueur ---------------------------------------------------
{
  for (const page of ['interface_jeu.html', 'fiche_perso.html', 'create_player.html']) {
    verifier(source('website', page).includes('href="police-lisible.css"'), `${page} doit charger police-lisible.css.`);
  }
  const css = source('website', 'police-lisible.css');
  verifier(css.includes("'Segoe UI'") && css.includes("h1, h2, h3, h4, h5"), 'Police lisible : règles attendues absentes.');
}
console.log('PASS: police lisible — texte courant lisible, Uncial Antiqua pour les titres');
