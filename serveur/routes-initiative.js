// serveur/routes-initiative.js
// ---------------------------------------------------------------------------
// Ordre d'initiative du combat (modèle : initiative.js, persistance :
// session.js). Le MJ prépare et fait avancer le combat ; la table (Écran,
// joueurs) lit une projection sans les créatures cachées.
// ---------------------------------------------------------------------------
const express = require('express');
const initiative = require('../initiative');
const { getInitiative, setInitiative, getSessionMobById } = require('../session');
const { roleDepuisRequete, refuserSiPasMj } = require('./acces');

const app = express.Router();
let io = null;

/**
 * V2.4 — Combattant hors jeu : une créature morte. Un personnage à 0 PV
 * (agonie) garde son tour, pour ses jets de survie.
 */
function estHorsJeu(entree) {
  if (entree?.kind !== 'mob') return false;
  const entityId = entree.entityId ?? String(entree.id || '').split(':').slice(1).join(':');
  return getSessionMobById(entityId)?.statut === 'mort';
}

/** État complet pour le MJ, projection pour les autres ; morts signalés. */
function vuePour(req, etat) {
  const vue = roleDepuisRequete(req) === 'mj' ? etat : initiative.projectionTable(etat);
  return { ...vue, entrees: vue.entrees.map(entree => (estHorsJeu(entree) ? { ...entree, horsJeu: true } : entree)) };
}

app.get('/api/initiative', (req, res) => {
  res.json(vuePour(req, getInitiative()));
});

/**
 * Applique une opération du modèle, l'enregistre et prévient les clients.
 * Chacun relit ensuite GET /api/initiative avec son propre rôle : aucune
 * créature cachée n'est diffusée à la table.
 */
function appliquer(req, res, operation) {
  if (refuserSiPasMj(req, res)) return;
  const resultat = operation(getInitiative());
  if (!resultat.success) return res.status(400).json({ message: resultat.message });
  const enregistre = setInitiative(resultat.etat);
  if (!enregistre.success) return res.status(500).json({ message: enregistre.message });
  io.emit('initiativeUpdated');
  res.json(vuePour(req, enregistre.initiative));
}

// Début du combat : si le premier est déjà hors jeu, la main passe au
// premier combattant actif.
function demarrerCombat(entrees, options) {
  const resultat = initiative.demarrer(entrees, options);
  if (!resultat.success) return resultat;
  const premierActif = resultat.etat.entrees.findIndex(entree => !estHorsJeu(entree));
  return premierActif > 0 ? { ...resultat, etat: { ...resultat.etat, tour: premierActif } } : resultat;
}

app.post('/api/initiative/demarrer', (req, res) =>
  appliquer(req, res, () => demarrerCombat(req.body?.entrees, { ordreManuel: req.body?.ordreManuel === true })));
// V2.4 : les créatures mortes sont sautées.
app.post('/api/initiative/suivant', (req, res) =>
  appliquer(req, res, etat => initiative.avancerVivant(etat, initiative.suivant, estHorsJeu)));
app.post('/api/initiative/precedent', (req, res) =>
  appliquer(req, res, etat => initiative.avancerVivant(etat, initiative.precedent, estHorsJeu)));
app.post('/api/initiative/retirer', (req, res) =>
  appliquer(req, res, etat => initiative.retirer(etat, req.body?.id)));
app.post('/api/initiative/deplacer', (req, res) =>
  appliquer(req, res, etat => initiative.deplacer(etat, req.body?.id, req.body?.position)));
app.post('/api/initiative/cacher', (req, res) =>
  appliquer(req, res, etat => initiative.basculerCache(etat, req.body?.id)));
app.post('/api/initiative/terminer', (req, res) =>
  appliquer(req, res, () => ({ success: true, etat: initiative.ETAT_VIDE })));

module.exports = instanceIo => {
  io = instanceIo;
  return app;
};
