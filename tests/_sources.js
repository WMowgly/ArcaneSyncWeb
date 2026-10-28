// tests/_sources.js
// ---------------------------------------------------------------------------
// Code source du serveur, pour les vérifications de câblage des suites.
//
// Depuis V1.16, server.js ne garde que le démarrage et les sockets : les
// routes HTTP vivent dans serveur/. Les suites qui vérifient la présence
// d'une route lisent donc l'ensemble de ces fichiers.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

const racine = path.join(__dirname, '..');

function sourceServeur() {
  const dossier = path.join(racine, 'serveur');
  const modules = fs.readdirSync(dossier).filter(f => f.endsWith('.js')).sort()
    .map(f => path.join(dossier, f));
  return [path.join(racine, 'server.js'), ...modules]
    .map(f => fs.readFileSync(f, 'utf8'))
    .join('\n');
}

module.exports = { sourceServeur };
