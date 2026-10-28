// tableau.js
// ---------------------------------------------------------------------------
// Dessins du tableau blanc : traits et textes, conservés côté serveur.
//
// POURQUOI
// --------
// Les dessins n'existaient que dans les pixels du canevas de chaque
// navigateur : un écran ouvert en cours de séance ne voyait rien des
// dessins précédents, et chaque nouveau rendu de la scène (déplacement
// d'un pion, redimensionnement) les effaçait.
//
// MODÈLE (même principe que les annotations de map.js)
// ------
//   { type: 'trait', points: [[x, y], ...], color, size }
//   { type: 'texte', x, y, text, color, size }
// Coordonnées dans le repère de la scène (1200 × 675 par défaut).
// La gomme est un trait de la couleur du fond : l'ordre de rendu suffit.
// ---------------------------------------------------------------------------

const fs = require('fs');
const { creerDepot, cheminDonnees } = require('./storage');

const MAX_ELEMENTS = 5000;   // au-delà, les plus anciens sont retirés
const MAX_POINTS = 4000;     // par trait
const MAX_TEXTE = 200;
const BORNE = 10000;         // coordonnées absurdes rejetées

const chemin = cheminDonnees('tableau_dessins.json');
const depot = creerDepot(chemin, { etiquette: 'tableau_dessins.json', delaiMs: 1000 });

function lire() {
  try {
    const donnees = JSON.parse(fs.readFileSync(chemin, 'utf8'));
    return Array.isArray(donnees?.traces) ? donnees.traces.map(normaliser).filter(Boolean) : [];
  } catch (_) {
    return [];
  }
}

function sauvegarder() {
  depot.ecrireDifferee(() => JSON.stringify({ traces }));
}

const nombre = valeur => (Number.isFinite(Number(valeur)) && Math.abs(Number(valeur)) <= BORNE ? Math.round(Number(valeur) * 10) / 10 : null);
const couleur = valeur => (typeof valeur === 'string' && /^#[0-9a-f]{6}$/i.test(valeur) ? valeur.toLowerCase() : null);
const taille = valeur => Math.max(1, Math.min(50, Number(valeur) || 1));

function normaliser(element) {
  if (!element || typeof element !== 'object') return null;
  const color = couleur(element.color);
  if (!color) return null;

  if (element.type === 'texte') {
    const x = nombre(element.x);
    const y = nombre(element.y);
    const text = typeof element.text === 'string' ? element.text.trim().slice(0, MAX_TEXTE) : '';
    if (x === null || y === null || !text) return null;
    return { type: 'texte', x, y, text, color, size: taille(element.size) };
  }

  if (!Array.isArray(element.points)) return null;
  const points = element.points.slice(0, MAX_POINTS)
    .map(point => (Array.isArray(point) ? [nombre(point[0]), nombre(point[1])] : [null, null]))
    .filter(([x, y]) => x !== null && y !== null);
  if (points.length < 2) return null;
  return { type: 'trait', points, color, size: taille(element.size) };
}

// Lecture initiale : après les fonctions de validation qu'elle utilise.
let traces = lire();

function ajouter(element) {
  const propre = normaliser(element);
  if (!propre) return null;
  traces.push(propre);
  if (traces.length > MAX_ELEMENTS) traces = traces.slice(-MAX_ELEMENTS);
  sauvegarder();
  return propre;
}

const ajouterTrait = trait => ajouter({ ...trait, type: 'trait' });
const ajouterTexte = texte => ajouter({ ...texte, type: 'texte' });

function vider() {
  traces = [];
  sauvegarder();
}

function getTraces() {
  return traces;
}

module.exports = { getTraces, ajouterTrait, ajouterTexte, vider, MAX_ELEMENTS };
