// mjcode.js
// ---------------------------------------------------------------------------
// Code MJ : contrôle d'accès minimal pour une partie en réseau local.
//
// POURQUOI
// --------
// Le rôle MJ était simplement DÉCLARÉ par le navigateur (`role: 'mj'`).
// N'importe quel appareil du réseau pouvait donc modifier les mobs, les
// cartes ou la partie. Le code MJ ne prétend pas être une authentification
// forte : il empêche seulement un joueur de prendre la main par erreur ou
// par jeu.
//
// OÙ EST LE CODE
// --------------
//   1. Variable d'environnement ARCANESYNC_MJ_CODE, si elle est posée :
//      elle fait foi et ne peut pas être changée depuis l'interface.
//   2. Sinon, mj.json dans le dossier de données (empreinte salée, jamais
//      le code en clair). Il est choisi par le MJ à sa première entrée.
//      Supprimer ce fichier remet le code à zéro.
//
// Tant qu'aucun code n'est défini, le serveur fonctionne comme avant
// (rôle déclaré) : rien ne change pour une partie existante tant que le MJ
// n'a pas choisi son code.
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const { creerDepot, cheminDonnees } = require('./storage');

const LONGUEUR_MIN = 4;

const fichier = () => cheminDonnees('mj.json');

let config; // undefined : pas encore lu ; null : aucun fichier

function lireConfig() {
  if (config !== undefined) return config;
  try {
    const brut = JSON.parse(require('fs').readFileSync(fichier(), 'utf8'));
    config = brut && typeof brut.sel === 'string' && typeof brut.empreinte === 'string' ? brut : null;
  } catch (_) {
    config = null;
  }
  return config;
}

function codeEnvironnement() {
  const code = process.env.ARCANESYNC_MJ_CODE;
  return code ? String(code) : null;
}

function empreinte(code, sel) {
  return crypto.createHash('sha256').update(`${sel}:${code}`).digest('hex');
}

function egaux(a, b) {
  const tamponA = Buffer.from(String(a));
  const tamponB = Buffer.from(String(b));
  return tamponA.length === tamponB.length && crypto.timingSafeEqual(tamponA, tamponB);
}

/** 'env', 'fichier' ou null (aucun code : mode ouvert). */
function source() {
  if (codeEnvironnement()) return 'env';
  return lireConfig() ? 'fichier' : null;
}

function estConfigure() {
  return source() !== null;
}

function verifier(code) {
  if (typeof code !== 'string' || !code) return false;
  const env = codeEnvironnement();
  if (env) return egaux(code, env);
  const actuel = lireConfig();
  return Boolean(actuel) && egaux(empreinte(code, actuel.sel), actuel.empreinte);
}

/**
 * Définit (première fois) ou change le code.
 * Changer exige le code actuel ; un code posé par l'environnement ne se
 * change pas ici.
 */
function definir(nouveau, actuel) {
  if (codeEnvironnement()) {
    return { success: false, message: 'Le code MJ est fixé par ARCANESYNC_MJ_CODE sur le serveur.' };
  }
  if (estConfigure() && !verifier(actuel)) {
    return { success: false, message: 'Code MJ actuel incorrect.' };
  }
  const code = typeof nouveau === 'string' ? nouveau.trim() : '';
  if (code.length < LONGUEUR_MIN) {
    return { success: false, message: `Le code MJ doit comporter au moins ${LONGUEUR_MIN} caractères.` };
  }
  const sel = crypto.randomBytes(16).toString('hex');
  const suivant = { sel, empreinte: empreinte(code, sel), modifieLe: new Date().toISOString() };
  if (!creerDepot(fichier(), { etiquette: 'mj.json' }).ecrire(JSON.stringify(suivant, null, 2))) {
    return { success: false, message: "Impossible d'enregistrer le code MJ." };
  }
  config = suivant;
  return { success: true, code };
}

/**
 * Le MJ est-il autorisé pour ce code ? Sans code défini, oui (mode ouvert,
 * comportement historique).
 */
function autorise(code) {
  return !estConfigure() || verifier(code);
}

module.exports = { estConfigure, source, verifier, definir, autorise, LONGUEUR_MIN };
