// Bac a sable de donnees : DOIT rester le tout premier require.
const bacDonnees = require('./_donnees');
// tests/storage.test.js
// ---------------------------------------------------------------------------
// V1.13.5 — Persistance : écriture atomique, vidage différé et fusionné.
//
// Convention du projet : script Node autonome, `throw` en cas d'échec,
// nettoyage systématique dans le `finally`.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'arcane-storage-'));
const fichier = path.join(dossier, 'depot.json');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Exécute un scénario dans un processus fils.
 *
 * Indispensable pour tout ce qui touche au MINUTEUR ou à l'ARRÊT : une
 * attente active dans ce processus bloquerait la boucle d'événements et
 * empêcherait justement le minuteur de se déclencher.
 */
function executerScenario(source) {
  execFileSync(process.execPath, ['-e', source], { stdio: 'pipe' });
}

const CHEMIN_STORAGE = JSON.stringify(path.join(__dirname, '..', 'storage.js'));

try {
  delete require.cache[require.resolve('../storage')];
  const storage = require('../storage');

  const depot = storage.creerDepot(fichier, { etiquette: 'depot.json', delaiMs: 60 });

  // ---------------------------------------------------------------------
  // 1. Écriture immédiate et atomique
  // ---------------------------------------------------------------------
  assert(depot.ecrire('{"v":1}'), 'Écriture immédiate impossible.');
  assert(fs.readFileSync(fichier, 'utf8') === '{"v":1}', 'Contenu immédiat incorrect.');
  assert(!fs.existsSync(`${fichier}.tmp`), 'Le fichier temporaire doit être renommé, pas laissé.');
  assert(!depot.enAttente(), 'Aucune écriture ne doit rester en attente.');

  // Un même chemin renvoie le MÊME dépôt : recharger un module ne perd pas
  // l'écriture en attente.
  assert(storage.creerDepot(fichier) === depot, 'Un chemin doit toujours donner le même dépôt.');

  // ---------------------------------------------------------------------
  // 2. Différé : le disque n'est pas touché tout de suite
  // ---------------------------------------------------------------------
  assert(depot.ecrireDifferee('{"v":2}'), 'Écriture différée refusée.');
  assert(depot.enAttente(), 'Une écriture doit être en attente.');
  assert(fs.readFileSync(fichier, 'utf8') === '{"v":1}',
    'Le disque ne doit pas encore refléter une écriture différée.');

  assert(depot.flush(), 'Vidage impossible.');
  assert(fs.readFileSync(fichier, 'utf8') === '{"v":2}', 'Le vidage n\'a pas écrit le contenu.');
  assert(!depot.enAttente(), 'Plus rien ne doit être en attente après vidage.');

  // ---------------------------------------------------------------------
  // 3. Fusion : N mutations rapprochées => UNE écriture
  // ---------------------------------------------------------------------
  let serialisations = 0;
  for (let i = 3; i <= 12; i += 1) {
    // Sérialisation paresseuse : la fonction ne doit être évaluée qu'au vidage.
    depot.ecrireDifferee(() => { serialisations += 1; return `{"v":${i}}`; });
  }
  assert(serialisations === 0,
    `La sérialisation doit être paresseuse (${serialisations} évaluations avant vidage).`);

  depot.flush();
  assert(serialisations === 1,
    `Dix mutations doivent produire UNE sérialisation (obtenu : ${serialisations}).`);
  assert(fs.readFileSync(fichier, 'utf8') === '{"v":12}',
    'Seule la dernière version doit être écrite.');

  // ---------------------------------------------------------------------
  // 4. Le minuteur vide tout seul (processus fils : voir executerScenario)
  // ---------------------------------------------------------------------
  const fichierMinuteur = path.join(dossier, 'minuteur.json');
  executerScenario(`
    const fs = require('fs');
    const storage = require(${CHEMIN_STORAGE});
    const depot = storage.creerDepot(${JSON.stringify(fichierMinuteur)}, { delaiMs: 40 });
    depot.ecrireDifferee('{"minuteur":true}');
    // Le minuteur du dépôt est unref() : ce setTimeout maintient le
    // processus en vie assez longtemps pour l'observer se déclencher.
    setTimeout(() => {
      const ecrit = fs.existsSync(${JSON.stringify(fichierMinuteur)})
        && fs.readFileSync(${JSON.stringify(fichierMinuteur)}, 'utf8') === '{"minuteur":true}';
      storage.annulerTout();
      process.exit(ecrit ? 0 : 3);
    }, 300);
  `);
  assert(fs.readFileSync(fichierMinuteur, 'utf8') === '{"minuteur":true}',
    'Le minuteur doit vider l\'écriture en attente sans appel explicite.');

  // ---------------------------------------------------------------------
  // 5. Une écriture immédiate annule l'attente
  // ---------------------------------------------------------------------
  depot.ecrireDifferee('{"v":"perdue"}');
  depot.ecrire('{"v":14}');
  assert(!depot.enAttente(), 'Une écriture immédiate doit annuler l\'attente.');
  depot.flush();
  assert(fs.readFileSync(fichier, 'utf8') === '{"v":14}',
    'Une écriture différée obsolète ne doit jamais ressusciter.');

  // ---------------------------------------------------------------------
  // 6. annulerTout() : indispensable quand un tiers réécrit le fichier
  // ---------------------------------------------------------------------
  depot.ecrireDifferee('{"v":"abandonnee"}');
  storage.annulerTout();
  assert(!depot.enAttente(), 'annulerTout() doit vider les attentes.');
  depot.flush();
  assert(fs.readFileSync(fichier, 'utf8') === '{"v":14}',
    'Une écriture abandonnée ne doit pas être appliquée.');

  // ---------------------------------------------------------------------
  // 7. Vidage à l'arrêt du processus
  //
  // Régression réelle rencontrée pendant l'implémentation : sans ce
  // gestionnaire, une écriture différée en attente était perdue à la
  // sortie ; avec lui mais sans annulerTout(), elle écrasait une
  // restauration externe. Les deux comportements sont vérifiés ici.
  // ---------------------------------------------------------------------
  const fichierArret = path.join(dossier, 'arret.json');
  executerScenario(`
    const storage = require(${CHEMIN_STORAGE});
    const depot = storage.creerDepot(${JSON.stringify(fichierArret)}, { delaiMs: 100000 });
    depot.ecrireDifferee('{"arret":true}');
    // Sortie immédiate : seul le gestionnaire 'exit' peut sauver ce contenu.
  `);

  assert(fs.existsSync(fichierArret),
    "L'écriture en attente doit être vidée à l'arrêt du processus.");
  assert(fs.readFileSync(fichierArret, 'utf8') === '{"arret":true}',
    'Contenu incorrect après vidage à l\'arrêt.');

  // ---------------------------------------------------------------------
  // 8. V1.13.7 — Sauvegardes tournantes
  //
  // maps.json a été entièrement vidé une fois, sans que l'incident ait pu
  // être reproduit. Ces sauvegardes rendent toute perte réversible.
  // ---------------------------------------------------------------------
  const dossierRot = path.join(dossier, 'rotation');
  fs.mkdirSync(dossierRot);
  const fichierRot = path.join(dossierRot, 'donnees.json');
  const archives = path.join(dossierRot, 'sauvegardes');
  const generation = rang => path.join(archives, `donnees.json.${rang}`);

  // Un fichier absent ne produit rien.
  assert(storage.sauvegarderRotation(fichierRot, { generations: 3 }) === false,
    'Un fichier absent ne doit produire aucune sauvegarde.');

  // Un fichier vide non plus : il ne doit surtout pas chasser une
  // génération valable.
  fs.writeFileSync(fichierRot, '   ', 'utf8');
  assert(storage.sauvegarderRotation(fichierRot, { generations: 3 }) === false,
    'Un fichier vide ne doit produire aucune sauvegarde.');

  // Première rotation.
  fs.writeFileSync(fichierRot, 'v1', 'utf8');
  assert(storage.sauvegarderRotation(fichierRot, { generations: 3 }) === true,
    'La première rotation doit créer une génération.');
  assert(fs.readFileSync(generation(1), 'utf8') === 'v1', 'Génération 1 incorrecte.');

  // Rien n'a changé : on ne consomme pas de génération. C'est ce qui
  // évite qu'une série de redémarrages évince toutes les bonnes versions.
  assert(storage.sauvegarderRotation(fichierRot, { generations: 3 }) === false,
    'Une rotation sans changement ne doit rien créer.');
  assert(fs.readdirSync(archives).length === 1,
    'Aucune génération supplémentaire ne doit apparaître sans changement.');

  // Décalage.
  fs.writeFileSync(fichierRot, 'v2', 'utf8');
  storage.sauvegarderRotation(fichierRot, { generations: 3 });
  assert(fs.readFileSync(generation(1), 'utf8') === 'v2', 'La plus récente doit être en .1.');
  assert(fs.readFileSync(generation(2), 'utf8') === 'v1', "L'ancienne doit avoir reculé en .2.");

  // Plafond : au-delà, la plus ancienne disparaît.
  fs.writeFileSync(fichierRot, 'v3', 'utf8');
  storage.sauvegarderRotation(fichierRot, { generations: 3 });
  fs.writeFileSync(fichierRot, 'v4', 'utf8');
  storage.sauvegarderRotation(fichierRot, { generations: 3 });

  assert(fs.readdirSync(archives).length === 3, 'Le plafond de générations doit être respecté.');
  assert(fs.readFileSync(generation(1), 'utf8') === 'v4', 'Génération 1 après plafond incorrecte.');
  assert(fs.readFileSync(generation(3), 'utf8') === 'v2', 'Génération 3 après plafond incorrecte.');
  assert(!fs.existsSync(generation(4)), 'Aucune génération au-delà du plafond.');

  // Traitement par lot.
  const secondFichier = path.join(dossierRot, 'autre.json');
  fs.writeFileSync(secondFichier, 'a1', 'utf8');
  assert(storage.sauvegarderFichiers([fichierRot, secondFichier], { generations: 3 }) === 1,
    'Seul le fichier réellement modifié doit être archivé.');

  // Le serveur doit importer la fonction : l'oubli s'est déjà produit,
  // et le try/catch le rendait silencieux.
  const serveurSource = require('./_sources').sourceServeur();
  assert(/const \{[^}]*sauvegarderFichiers[^}]*\} = require\('\.\/storage'\)/.test(serveurSource),
    'server.js doit importer sauvegarderFichiers, sinon la rotation reste inerte.');
  assert(serveurSource.includes('sauvegarderDonnees()'),
    'La rotation doit être déclenchée au démarrage du serveur.');

  console.log('PASS: V1.13.7 persistance — atomicité, différé fusionné, vidage à l' + "'" + 'arrêt, sauvegardes tournantes');
} finally {
  // Abandonner AVANT de supprimer le dossier : sans cela, le vidage à
  // l'arrêt tenterait d'écrire dans un répertoire qui n'existe plus.
  try { require('../storage').annulerTout(); } catch (_) { /* rien */ }
  try { fs.rmSync(dossier, { recursive: true, force: true }); } catch (_) { /* rien */ }
  delete require.cache[require.resolve('../storage')];
}

// ---------------------------------------------------------------------
// V1.13.9 — Le bac à sable de données ne doit pas être contournable.
//
// Deux incidents sont nés d'une suite qui écrivait dans la partie en cours.
// La protection n'a de valeur que si l'on ne peut pas l'oublier : ces deux
// contrôles échouent AVANT qu'un tel test ne soit écrit.
//
// storage.test.js est exempté du second : il s'isole déjà lui-même par
// mkdtemp et ne charge aucun module persistant. C'est le modèle que les
// autres suites viennent de rejoindre.
// ---------------------------------------------------------------------
{
  const DONNEES = ['data.json', 'session.json', 'maps.json', 'mob_templates.json', 'tableau.json'];
  const PERSISTANTS = ['../map', '../session', '../mob', '../joueur'];

  fs.readdirSync(__dirname)
    .filter(nom => nom.endsWith('.test.js'))
    .forEach(nom => {
      const source = fs.readFileSync(path.join(__dirname, nom), 'utf8');

      // 1. Aucun chemin vers un fichier de données à la racine du projet.
      DONNEES.forEach(fichier => {
        const motif = new RegExp('__dirname\\s*,\\s*\'\\.\\.\'\\s*,\\s*\'' + fichier.replace('.', '\\.') + '\'');
        if (motif.test(source)) {
          throw new Error(nom + ' construit un chemin vers ' + fichier
            + ' à la racine : il écrirait dans la partie en cours. Utiliser bacDonnees.chemin().');
        }
      });

      // 2. Toute suite chargeant un module qui persiste doit requérir le bac
      //    à sable, et le requérir EN PREMIER : storage.js lit
      //    ARCANESYNC_DATA_DIR au chargement du module appelant.
      if (!PERSISTANTS.some(m => source.includes("require('" + m + "')"))) return;

      const position = source.indexOf("require('./_donnees')");
      if (position === -1) {
        throw new Error(nom + ' charge un module persistant sans requérir ./_donnees.');
      }
      if (/require\(/.test(source.slice(0, position))) {
        throw new Error(nom + ' doit requérir ./_donnees AVANT tout autre require.');
      }
    });

  // Le bac lui-même doit rediriger, et n'avoir amorcé que des copies.
  const bac = process.env.ARCANESYNC_DATA_DIR;
  if (bac) {
    const { cheminDonnees } = require('../storage');
    if (!cheminDonnees('maps.json').startsWith(bac)) {
      throw new Error('cheminDonnees() ignore ARCANESYNC_DATA_DIR.');
    }
  }

  console.log('PASS: isolation des données — aucune suite ne peut atteindre la partie en cours');
}
