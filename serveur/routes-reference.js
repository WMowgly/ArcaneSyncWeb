// serveur/routes-reference.js
// ---------------------------------------------------------------------------
// Données de jeu : game_database.json et référence sorts.json.
//
// Routes déplacées telles quelles depuis server.js (V1.16). Le routeur est
// nommé `app` pour que chaque route garde exactement son écriture d'origine.
// ---------------------------------------------------------------------------
const express = require('express');
const sortsRef = require('../sorts');
const fs = require('fs');
const { listesSortsReference } = require('../sorts');
const {
  cheminDonnees
} = require('../storage');
const { refuserSiPasMj } = require('./acces');

const app = express.Router();
let io = null;

// Ajouter cette route pour accéder à la base de données
app.get('/api/game-database', (req, res) => {
  try {
    const databasePath = cheminDonnees('database', 'game_database.json');
    fs.readFile(databasePath, 'utf8', (err, data) => {
      if (err) {
        console.error('Erreur lors de la lecture de la base de données:', err);
        return res.status(500).json({ error: 'Erreur lors de la lecture de la base de données' });
      }
      try {
        const jsonData = JSON.parse(data);
        // Sorts et attaques viennent de sorts.json ; sans lui, des listes
        // vides plutôt que les anciennes listes de test.
        res.json({
          sorts_majeurs: [],
          sorts_mineurs: [],
          attack_special: [],
          ...jsonData,
          ...(listesSortsReference() || {})
        });
      } catch (parseError) {
        console.error('Erreur lors du parsing JSON:', parseError);
        res.status(500).json({ error: 'Erreur lors du parsing des données' });
      }
    });
  } catch (error) {
    console.error('Erreur lors de l\'accès au fichier:', error);
    res.status(500).json({ error: 'Erreur lors de l\'accès au fichier' });
  }
});

// ------------------------------------------------------------------
// Interface Modification — édition de la référence (sorts.json).
// Lecture libre ; toute écriture est réservée au MJ.
// ------------------------------------------------------------------

app.get('/api/reference', (req, res) => {
  try {
    res.json(sortsRef.lireReference());
  } catch (error) {
    console.error('Lecture de sorts.json impossible:', error);
    res.status(500).json({ message: 'Lecture de sorts.json impossible.' });
  }
});

function routeReference(res, action, statutSucces = 200) {
  try {
    const result = action();
    if (!result.success) {
      return res.status(result.introuvable ? 404 : 400).json({ message: result.message });
    }
    io.emit('referenceUpdated');
    res.status(statutSucces).json(result);
  } catch (error) {
    console.error('Modification de sorts.json impossible:', error);
    res.status(500).json({ message: 'Modification de sorts.json impossible.' });
  }
}

app.post('/api/reference/sorts', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  routeReference(res, () => sortsRef.creerSort(req.body), 201);
});
app.put('/api/reference/sorts/:id', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  routeReference(res, () => sortsRef.modifierSort(req.params.id, req.body));
});
app.delete('/api/reference/sorts/:id', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  routeReference(res, () => sortsRef.supprimerSort(req.params.id));
});
app.post('/api/reference/sorts/:id/duplicate', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  routeReference(res, () => sortsRef.dupliquerSort(req.params.id), 201);
});

app.post('/api/reference/attaques', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  routeReference(res, () => sortsRef.creerAttaque(req.body), 201);
});
app.put('/api/reference/attaques/:id', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  routeReference(res, () => sortsRef.modifierAttaque(req.params.id, req.body));
});
app.delete('/api/reference/attaques/:id', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  routeReference(res, () => sortsRef.supprimerAttaque(req.params.id));
});
app.post('/api/reference/attaques/:id/duplicate', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  routeReference(res, () => sortsRef.dupliquerAttaque(req.params.id), 201);
});

// Métamorphoses (formes animales des druides).
app.post('/api/reference/metamorphoses', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  routeReference(res, () => sortsRef.creerForme(req.body), 201);
});
app.put('/api/reference/metamorphoses/:id', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  routeReference(res, () => sortsRef.modifierForme(req.params.id, req.body));
});
app.delete('/api/reference/metamorphoses/:id', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  routeReference(res, () => sortsRef.supprimerForme(req.params.id));
});
app.post('/api/reference/metamorphoses/:id/duplicate', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  routeReference(res, () => sortsRef.dupliquerForme(req.params.id), 201);
});

module.exports = instanceIo => {
  io = instanceIo;
  return app;
};
