// website/qrcode.js
// ---------------------------------------------------------------------------
// Générateur de QR code minimal, sans dépendance : la partie tourne sur un
// réseau local, souvent sans accès à Internet.
//
// Mode octet, correction d'erreur M, versions 1 à 9 (jusqu'à 180 octets :
// largement assez pour une adresse). Suit la norme ISO/IEC 18004 :
// placement des motifs, Reed-Solomon sur GF(256), entrelacement des blocs,
// choix du masque par pénalité.
//
// Navigateur : window.ArcaneQR.svg(texte) ; Node (tests) : require().
// ---------------------------------------------------------------------------
(function (racine) {
  'use strict';

  // Version 1..9, correction M : octets de correction par bloc et nombre de blocs.
  const ECC_PAR_BLOC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22];
  const NB_BLOCS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5];
  const BITS_FORMAT_M = 0; // L=1, M=0, Q=3, H=2

  function modulesBruts(version) {
    let total = (16 * version + 128) * version + 64;
    if (version >= 2) {
      const nbAlign = Math.floor(version / 7) + 2;
      total -= (25 * nbAlign - 10) * nbAlign - 55;
      if (version >= 7) total -= 36;
    }
    return total;
  }

  const octetsDonnees = version =>
    Math.floor(modulesBruts(version) / 8) - ECC_PAR_BLOC[version] * NB_BLOCS[version];

  // --- Reed-Solomon sur GF(256), polynôme 0x11D ---------------------------------
  function multiplier(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }

  function diviseur(degre) {
    const resultat = new Array(degre).fill(0);
    resultat[degre - 1] = 1;
    let racineCourante = 1;
    for (let i = 0; i < degre; i++) {
      for (let j = 0; j < resultat.length; j++) {
        resultat[j] = multiplier(resultat[j], racineCourante);
        if (j + 1 < resultat.length) resultat[j] ^= resultat[j + 1];
      }
      racineCourante = multiplier(racineCourante, 0x02);
    }
    return resultat;
  }

  function reste(donnees, div) {
    const resultat = div.map(() => 0);
    for (const octet of donnees) {
      const facteur = octet ^ resultat.shift();
      resultat.push(0);
      div.forEach((coef, i) => { resultat[i] ^= multiplier(coef, facteur); });
    }
    return resultat;
  }

  // --- Données : mode octet, remplissage, blocs entrelacés -------------------------
  function encoder(octets, version) {
    const bits = [];
    const ajouter = (valeur, longueur) => {
      for (let i = longueur - 1; i >= 0; i--) bits.push((valeur >>> i) & 1);
    };
    ajouter(0b0100, 4);
    ajouter(octets.length, 8);
    octets.forEach(o => ajouter(o, 8));

    const capacite = octetsDonnees(version) * 8;
    ajouter(0, Math.min(4, capacite - bits.length));
    ajouter(0, (8 - bits.length % 8) % 8);
    for (let remplissage = 0xEC; bits.length < capacite; remplissage ^= 0xEC ^ 0x11) ajouter(remplissage, 8);

    const donnees = [];
    for (let i = 0; i < bits.length; i += 8) {
      donnees.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));
    }

    const nbBlocs = NB_BLOCS[version];
    const eccBloc = ECC_PAR_BLOC[version];
    const total = Math.floor(modulesBruts(version) / 8);
    const nbCourts = nbBlocs - total % nbBlocs;
    const longueurCourt = Math.floor(total / nbBlocs);
    const div = diviseur(eccBloc);
    const blocs = [];
    for (let i = 0, k = 0; i < nbBlocs; i++) {
      const bloc = donnees.slice(k, k + longueurCourt - eccBloc + (i < nbCourts ? 0 : 1));
      k += bloc.length;
      const ecc = reste(bloc, div);
      if (i < nbCourts) bloc.push(0);
      blocs.push(bloc.concat(ecc));
    }
    const resultat = [];
    for (let i = 0; i < blocs[0].length; i++) {
      blocs.forEach((bloc, j) => {
        if (i !== longueurCourt - eccBloc || j >= nbCourts) resultat.push(bloc[i]);
      });
    }
    return resultat;
  }

  // --- Matrice ---------------------------------------------------------------------
  function positionsAlignement(version) {
    if (version === 1) return [];
    const nb = Math.floor(version / 7) + 2;
    const pas = Math.ceil((version * 4 + 4) / (nb * 2 - 2)) * 2;
    const resultat = [6];
    for (let pos = version * 4 + 10; resultat.length < nb; pos -= pas) resultat.splice(1, 0, pos);
    return resultat;
  }

  function construire(version, codewords, masque) {
    const taille = version * 4 + 17;
    const modules = Array.from({ length: taille }, () => new Array(taille).fill(false));
    const fonction = Array.from({ length: taille }, () => new Array(taille).fill(false));
    const poser = (x, y, sombre) => { modules[y][x] = sombre; fonction[y][x] = true; };

    for (let i = 0; i < taille; i++) { poser(6, i, i % 2 === 0); poser(i, 6, i % 2 === 0); }

    for (const [cx, cy] of [[3, 3], [taille - 4, 3], [3, taille - 4]]) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          const x = cx + dx, y = cy + dy;
          if (x >= 0 && x < taille && y >= 0 && y < taille) poser(x, y, d !== 2 && d !== 4);
        }
      }
    }

    const align = positionsAlignement(version);
    align.forEach((ay, i) => align.forEach((ax, j) => {
      const coin = (i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0);
      if (coin) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) poser(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }));

    // Zones de format réservées (remplies après le masque) et module sombre.
    poserFormat(poser, taille, 0);

    if (version >= 7) {
      let r = version;
      for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
      const bits = (version << 12) | r;
      for (let i = 0; i < 18; i++) {
        const bit = ((bits >>> i) & 1) === 1;
        const a = taille - 11 + i % 3, b = Math.floor(i / 3);
        poser(a, b, bit);
        poser(b, a, bit);
      }
    }

    // Données en zigzag, deux colonnes à la fois, de bas en haut puis de haut en bas.
    let i = 0;
    for (let droite = taille - 1; droite >= 1; droite -= 2) {
      if (droite === 6) droite = 5;
      for (let v = 0; v < taille; v++) {
        for (let j = 0; j < 2; j++) {
          const x = droite - j;
          const montant = ((droite + 1) & 2) === 0;
          const y = montant ? taille - 1 - v : v;
          if (!fonction[y][x] && i < codewords.length * 8) {
            modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
            i++;
          }
        }
      }
    }

    for (let y = 0; y < taille; y++) {
      for (let x = 0; x < taille; x++) {
        if (!fonction[y][x] && condition(masque, x, y)) modules[y][x] = !modules[y][x];
      }
    }
    poserFormat(poser, taille, masque);
    return modules;
  }

  function condition(masque, x, y) {
    switch (masque) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return (x * y) % 2 + (x * y) % 3 === 0;
      case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
      default: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
    }
  }

  function poserFormat(poser, taille, masque) {
    const donnees = (BITS_FORMAT_M << 3) | masque;
    let r = donnees;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const bits = ((donnees << 10) | r) ^ 0x5412;
    const bit = i => ((bits >>> i) & 1) === 1;

    for (let i = 0; i <= 5; i++) poser(8, i, bit(i));
    poser(8, 7, bit(6));
    poser(8, 8, bit(7));
    poser(7, 8, bit(8));
    for (let i = 9; i < 15; i++) poser(14 - i, 8, bit(i));

    for (let i = 0; i < 8; i++) poser(taille - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) poser(8, taille - 15 + i, bit(i));
    poser(8, taille - 8, true);
  }

  // --- Choix du masque : pénalités de la norme --------------------------------------
  function penalite(m) {
    const n = m.length;
    let score = 0;
    const lignes = [m, m[0].map((_, x) => m.map(ligne => ligne[x]))];
    for (const grille of lignes) {
      for (const ligne of grille) {
        // Règle 1 : séries de 5 modules identiques ou plus.
        let serie = 1;
        for (let x = 1; x <= n; x++) {
          if (x < n && ligne[x] === ligne[x - 1]) { serie++; continue; }
          if (serie >= 5) score += serie - 2;
          serie = 1;
        }
        // Règle 3 : motif proche d'un repère (1:1:3:1:1 bordé de 4 clairs).
        const texte = ligne.map(v => (v ? '1' : '0')).join('');
        for (const motif of ['10111010000', '00001011101']) {
          for (let p = texte.indexOf(motif); p !== -1; p = texte.indexOf(motif, p + 1)) score += 40;
        }
      }
    }
    // Règle 2 : blocs 2×2 de même couleur.
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
      }
    }
    // Règle 4 : équilibre clair / sombre.
    const sombres = m.reduce((acc, ligne) => acc + ligne.filter(Boolean).length, 0);
    score += Math.floor(Math.abs(sombres * 20 - n * n * 10) / (n * n)) * 10;
    return score;
  }

  /** Matrice de modules (true = sombre) pour un texte. */
  function matrice(texte) {
    const octets = Array.from(new TextEncoder().encode(String(texte)));
    let version = 1;
    while (version <= 9 && octetsDonnees(version) < octets.length + 2) version++;
    if (version > 9) throw new Error('Texte trop long pour un QR code (180 octets au plus).');
    const codewords = encoder(octets, version);
    let meilleure = null;
    for (let masque = 0; masque < 8; masque++) {
      const m = construire(version, codewords, masque);
      const score = penalite(m);
      if (!meilleure || score < meilleure.score) meilleure = { m, score };
    }
    return meilleure.m;
  }

  /** Image SVG (texte) du QR code, marge de 4 modules comprise. */
  function svg(texte, { taille = 200, couleur = '#000', fond = '#fff' } = {}) {
    const m = matrice(texte);
    const n = m.length + 8;
    let chemin = '';
    m.forEach((ligne, y) => ligne.forEach((sombre, x) => {
      if (sombre) chemin += `M${x + 4} ${y + 4}h1v1h-1z`;
    }));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${taille}" height="${taille}" shape-rendering="crispEdges">` +
      `<rect width="${n}" height="${n}" fill="${fond}"/><path d="${chemin}" fill="${couleur}"/></svg>`;
  }

  const api = { matrice, svg };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else racine.ArcaneQR = api;
})(typeof window !== 'undefined' ? window : globalThis);
