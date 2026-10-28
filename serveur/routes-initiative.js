// serveur/routes-initiative.js
// ---------------------------------------------------------------------------
// Ordre d'initiative du combat (modèle : initiative.js, persistance :
// session.js). Le MJ prépare et fait avancer le combat ; la table (Écran,
// joueurs) lit une projection sans les créatures cachées.
// ---------------------------------------------------------------------------
const express = require('express');
const initiative = require('../initiative');
const { getInitiative, setInitiative } = require('../session');
const { roleDepuisRequete, refuserSiPasMj } = require('./acces');

const app = express.Router();
let io = null;

/** État complet pour le MJ, projection pour les autres. */
function vuePour(req, etat) {
  return roleDepuisRequete(req) === 'mj' ? etat : initiative.projectionTable(etat);
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
  res.json(enregistre.initiative);
}

app.post('/api/initiative/demarrer', (req, res) =>
  appliquer(req, res, () => initiative.demarrer(req.body?.entrees, { ordreManuel: req.body?.ordreManuel === true })));
app.post('/api/initiative/suivant', (req, res) => appliquer(req, res, initiative.suivant));
app.post('/api/initiative/precedent', (req, res) => appliquer(req, res, initiative.precedent));
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
