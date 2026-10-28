// Bac a sable de donnees : DOIT rester le tout premier require.
require('./_donnees');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const QR = require('../website/qrcode');

// ---------------------------------------------------------------------------
// Rejoindre la partie : QR code (structure conforme à la norme) et adresses
// réseau du serveur.
//
// Le décodage complet a été vérifié avec un lecteur indépendant (jsQR) pour
// les versions 1 à 9 et les huit masques ; ce test garde la structure.
// ---------------------------------------------------------------------------
function verifier(condition, message) {
  if (!condition) throw new Error(message);
}

// --- QR code -----------------------------------------------------------------------
const url = 'http://192.168.1.23:3000/selecte_player.html';
const m = QR.matrice(url);
const taille = m.length;
verifier(taille === 33, `Une adresse de 44 octets tient en version 4 (33 modules), obtenu ${taille}.`);
verifier(m.every(ligne => ligne.length === taille), 'La matrice doit être carrée.');

// Repères de position : carré 7×7 sombre, anneau clair, cœur 3×3 sombre.
for (const [x0, y0] of [[0, 0], [taille - 7, 0], [0, taille - 7]]) {
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
      verifier(m[y0 + y][x0 + x] === (d !== 2), `Repère de position incorrect en ${x0 + x},${y0 + y}.`);
    }
  }
}
// Lignes de synchronisation.
for (let i = 8; i < taille - 8; i++) {
  verifier(m[6][i] === (i % 2 === 0) && m[i][6] === (i % 2 === 0), 'Ligne de synchronisation incorrecte.');
}
verifier(m[taille - 8][8] === true, 'Module sombre obligatoire absent.');

// Information de format : code BCH valide, niveau de correction M, et
// identique dans ses deux copies.
const lireBits = positions => positions.reduce((acc, [x, y], i) => acc | ((m[y][x] ? 1 : 0) << i), 0);
const copie1 = lireBits([[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]]);
const copie2 = lireBits([...Array(8)].map((_, i) => [taille - 1 - i, 8]).concat([...Array(7)].map((_, i) => [8, taille - 7 + i])));
verifier(copie1 === copie2, 'Les deux copies du format doivent être identiques.');
const format = copie1 ^ 0x5412;
let resteBch = format;
for (let i = 14; i >= 10; i--) if ((resteBch >>> i) & 1) resteBch ^= 0x537 << (i - 10);
verifier(resteBch === 0, 'Information de format : code BCH invalide.');
verifier((format >>> 13) === 0, 'Le niveau de correction doit être M.');

verifier(QR.matrice('a').length === 21, 'Un texte court tient en version 1.');
let refuse = false;
try { QR.matrice('x'.repeat(400)); } catch (_) { refuse = true; }
verifier(refuse, 'Un texte trop long doit être refusé.');
verifier(QR.svg(url).startsWith('<svg') && QR.svg(url) === QR.svg(url), 'Le SVG doit être produit, identique d\'un appel à l\'autre.');
console.log('PASS: QR code — repères, synchronisation, format BCH niveau M, limites');

// --- Adresses réseau (serveur réel) ---------------------------------------------------------
const PORT = 3390 + Math.floor(Math.random() * 50);

(async () => {
  const serveur = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')],
    { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'ignore', 'pipe'] });
  let erreurs = '';
  serveur.stderr.on('data', d => { erreurs += d; });
  try {
    let reseau = null;
    for (let i = 0; i < 80 && !reseau; i++) {
      try { reseau = await (await fetch(`http://127.0.0.1:${PORT}/api/reseau`)).json(); } catch (_) { /* pas encore prêt */ }
      if (!reseau) await new Promise(r => setTimeout(r, 150));
    }
    verifier(reseau && reseau.port === PORT, `Le port renvoyé doit être celui de l'instance (${PORT}).`);
    verifier(Array.isArray(reseau.adresses) && reseau.adresses.every(a => /^\d+\.\d+\.\d+\.\d+$/.test(a.adresse) && a.interface),
      'Chaque adresse doit être une IPv4 avec le nom de sa carte réseau.');
    verifier(!reseau.adresses.some(a => a.adresse.startsWith('127.')), 'L\'adresse locale ne sert à rien aux joueurs.');

    const accueil = fs.readFileSync(path.join(__dirname, '..', 'website', 'index.html'), 'utf8');
    verifier(accueil.includes('src="qrcode.js"') && accueil.includes("fetch('/api/reseau')") && accueil.includes('/selecte_player.html'),
      'L\'accueil doit afficher l\'adresse et le QR code menant au choix du personnage.');
    console.log('PASS: rejoindre — adresses réseau du serveur, port de l\'instance, accueil');
  } catch (erreur) {
    if (erreurs) console.error(erreurs);
    console.error(erreur);
    process.exitCode = 1;
  } finally {
    serveur.kill();
  }
})();
