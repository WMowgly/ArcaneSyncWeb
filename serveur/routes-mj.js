// serveur/routes-mj.js
// ---------------------------------------------------------------------------
// Code MJ : statut, vérification, définition.
//
// Routes déplacées telles quelles depuis server.js (V1.16). Le routeur est
// nommé `app` pour que chaque route garde exactement son écriture d'origine.
// ---------------------------------------------------------------------------
const express = require('express');
const mjCode = require('../mjcode');

const app = express.Router();

// ------------------------------------------------------------------
// CODE MJ (voir mjcode.js)
// ------------------------------------------------------------------
app.get('/api/mj/statut', (req, res) => {
  res.json({ configure: mjCode.estConfigure(), source: mjCode.source() });
});

app.post('/api/mj/verifier', (req, res) => {
  res.json({ valide: mjCode.verifier(req.body?.code) });
});

// Définition (première fois) ou changement (code actuel exigé).
app.post('/api/mj/code', (req, res) => {
  const resultat = mjCode.definir(req.body?.nouveau, req.body?.actuel);
  if (!resultat.success) return res.status(400).json({ message: resultat.message });
  console.log('[Code MJ] Code MJ défini.');
  res.json({ message: 'Code MJ enregistré.' });
});

module.exports = () => app;
