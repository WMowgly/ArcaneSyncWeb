// tests/e2e/lancer.js
// ---------------------------------------------------------------------------
// Contrôles de bout en bout : npm run test:e2e
//
// Chaque scénario part d'une COPIE des données et d'un serveur dédié
// (port 3100 par défaut, ARCANESYNC_E2E_PORT pour le changer). La partie en
// cours n'est jamais touchée.
//
//   node tests/e2e/lancer.js                 tous les scénarios
//   node tests/e2e/lancer.js code-mj         un ou plusieurs scénarios (début du nom)
//   ARCANESYNC_E2E_CAPTURES=<dossier>        enregistre des captures d'écran
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const outils = require('./_outils');

const filtres = process.argv.slice(2);
const filtre = filtres.join(', ');
const scenarios = fs.readdirSync(__dirname)
  .filter(f => f.endsWith('.e2e.js'))
  .filter(f => !filtres.length || filtres.some(nom => f.startsWith(nom)))
  .sort();

async function executer(fichier, navigateur) {
  const scenario = require(path.join(__dirname, fichier));
  const bac = outils.creerBac();
  const serveur = await outils.demarrerServeur(bac);
  const resultats = [];
  const lireJson = nom => JSON.parse(fs.readFileSync(path.join(bac, nom), 'utf8'));

  const contexte = {
    page: navigateur.page,
    BASE: outils.BASE,
    api: outils.api,
    lireJson,
    joueur: lireJson('data.json')[0],
    session: id => lireJson('session.json').players?.[id],
    fichierExiste: nom => fs.existsSync(path.join(bac, nom)),
    verifier(condition, libelle) {
      resultats.push({ ok: Boolean(condition), libelle });
      console.log(`  ${condition ? 'OK   ' : 'ÉCHEC'} ${libelle}`);
    },
    /** Définit le code MJ du bac à sable et le mémorise dans le navigateur. */
    async definirCodeMj(code = 'dragon') {
      await outils.api('POST', '/api/mj/code', { nouveau: code });
      await navigateur.page.ouvrir('index.html');
      await navigateur.page.evaluer(`localStorage.setItem('arcanesync-code-mj', ${JSON.stringify(code)})`);
      return { code, role: 'mj' };
    }
  };

  console.log(`\n▶ ${scenario.nom}`);
  try {
    // Chaque scénario repart d'un navigateur sans code MJ mémorisé.
    await navigateur.page.ouvrir('index.html');
    await navigateur.page.evaluer('localStorage.clear()');
    await scenario.executer(contexte);
  } catch (erreur) {
    resultats.push({ ok: false, libelle: `erreur : ${erreur.message}` });
    console.log(`  ÉCHEC erreur : ${erreur.message}`);
  } finally {
    await outils.arreterServeur(serveur);
    try { fs.rmSync(bac, { recursive: true, force: true }); } catch (_) { /* fichier encore ouvert */ }
  }
  return resultats;
}

(async () => {
  if (!scenarios.length) {
    console.error(`Aucun scénario ne correspond à « ${filtre} ».`);
    process.exit(1);
  }
  let navigateur;
  try {
    navigateur = await outils.lancerNavigateur();
  } catch (erreur) {
    console.error(erreur.message);
    process.exit(1);
  }

  const tous = [];
  try {
    for (const fichier of scenarios) tous.push(...await executer(fichier, navigateur));
  } finally {
    await navigateur.fermer();
  }

  const echecs = tous.filter(r => !r.ok);
  console.log(`\n${tous.length - echecs.length}/${tous.length} contrôles réussis (${scenarios.length} scénario(s)).`);
  process.exit(echecs.length ? 1 : 0);
})();
