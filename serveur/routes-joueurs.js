// serveur/routes-joueurs.js
// ---------------------------------------------------------------------------
// Personnages (data.json) : création, lecture, fiche, suppression.
//
// Routes déplacées telles quelles depuis server.js (V1.16). Le routeur est
// nommé `app` pour que chaque route garde exactement son écriture d'origine.
// ---------------------------------------------------------------------------
const express = require('express');
const {
  ajouterJoueur,
  getJoueurs,
  getJoueurById,
  supprimerJoueur,
  sauvegardeData
} = require('../joueur');
const {
  synchroniserSessionDepuisPersonnage,
  supprimerJoueurSession
} = require('../session');
const { refuserSiPasMj, sansDonneesPrivees } = require('./acces');
const { emitMapState } = require('./diffusion-carte');

const app = express.Router();
let io = null;

/**
 * Après la suppression d'une fiche : retire aussi son état de partie et sa
 * place dans l'initiative, puis prévient les écrans (scène, carte, combat).
 */
function nettoyerApresSuppression(joueur) {
  if (!supprimerJoueurSession(joueur.id)) {
    console.error(`Fiche de ${joueur.nom} supprimée, mais son état de partie n'a pas pu être retiré.`);
  }
  io.emit('sceneUpdated');
  io.emit('initiativeUpdated');
  emitMapState();
}

// API pour ajouter un joueur
app.post('/api/joueurs', (req, res) => {
  try {
    const nouveauJoueur = req.body;
    if (!nouveauJoueur.nom) {
      return res.status(400).json({ message: "Le nom est requis." });
    }
    const joueurEnregistre = ajouterJoueur(nouveauJoueur);
    io.emit('playerUpdate', {
      type: 'add',
      player: joueurEnregistre.nom,
      playerId: joueurEnregistre.id
    });
    io.emit('sceneUpdated');
    emitMapState();
    res.status(201).json({
      message: 'Joueur enregistré avec succès !',
      playerId: joueurEnregistre.id
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de l\'enregistrement.' });
  }
});

// API pour récupérer les joueurs
app.get('/api/joueurs', (req, res) => {
  res.json(getJoueurs().map(sansDonneesPrivees));
});

// API pour récupérer un joueur par son identifiant stable
app.get('/api/joueurs/:id', (req, res) => {
  const joueur = getJoueurById(req.params.id);

  if (!joueur) {
    return res.status(404).json({ message: 'Joueur non trouvé.' });
  }

  res.json(sansDonneesPrivees(joueur));
});

// API pour supprimer un joueur par son identifiant stable.
// L'ancien endpoint par nom reste disponible pour compatibilité.
app.delete('/api/joueurs/delete/:id', (req, res) => {
  // Suppression définitive d'un personnage : réservée au MJ.
  if (refuserSiPasMj(req, res)) return;

  const id = req.params.id;
  const joueur = getJoueurById(id);

  if (!joueur) {
    return res.status(404).send('Joueur non trouvé');
  }

  const success = supprimerJoueur({ id });

  if (success) {
    nettoyerApresSuppression(joueur);
    io.emit('playerUpdate', {
      type: 'delete',
      player: joueur.nom,
      playerId: joueur.id
    });
    res.status(200).send(`Joueur ${joueur.nom} supprimé`);
  } else {
    res.status(500).send('Erreur lors de la suppression du joueur');
  }
});

// Compatibilité avec les anciens liens qui utilisent encore le nom.
app.delete('/api/joueurs/delete-by-name/:nom', (req, res) => {
  // Shim de compatibilité, sans appelant connu — mais tout aussi
  // destructeur que la route par ID : même contrôle.
  if (refuserSiPasMj(req, res)) return;

  const nom = req.params.nom;
  const joueur = getJoueurs().find(
    player => typeof player.nom === 'string' &&
      player.nom.toLowerCase() === nom.toLowerCase()
  );

  if (!joueur) {
    return res.status(404).send(`Joueur ${nom} non trouvé`);
  }

  const success = supprimerJoueur({ id: joueur.id });

  if (success) {
    nettoyerApresSuppression(joueur);
    io.emit('playerUpdate', {
      type: 'delete',
      player: joueur.nom,
      playerId: joueur.id
    });
    res.status(200).send(`Joueur ${nom} supprimé`);
  } else {
    res.status(500).send('Erreur lors de la suppression du joueur');
  }
});

// API pour mettre à jour un joueur
app.post('/api/joueur', (req, res) => {
  console.log("Mise à jour du joueur :", req.body);
  const { id, nom, nouvellesDonnees } = req.body;

  if ((!id && !nom) || !nouvellesDonnees) {
    return res.status(400).json({
      message: "L'identifiant du joueur et les nouvelles données sont requis."
    });
  }

  const success = sauvegardeData({ id, nom }, nouvellesDonnees);

  if (success) {
    const joueurMisAJour = id
      ? getJoueurById(id)
      : getJoueurs().find(
          joueur => typeof joueur.nom === 'string' &&
            joueur.nom.toLowerCase() === nom.toLowerCase()
        );

    if (!joueurMisAJour) {
      return res.status(500).json({
        message: "Le joueur a été sauvegardé mais son état actuel est introuvable."
      });
    }

    // Flux volontairement à sens unique :
    // Fiche de Perso -> état de session -> Interface de Jeu.
    const sessionSynced = synchroniserSessionDepuisPersonnage(joueurMisAJour);

    if (!sessionSynced) {
      return res.status(500).json({
        message: "Le personnage a été sauvegardé, mais l'état de session n'a pas pu être synchronisé."
      });
    }

    io.emit('playerUpdate', {
      type: 'update',
      player: joueurMisAJour.nom,
      playerId: joueurMisAJour.id
    });

    res.status(200).json({
      message: `Les données du joueur ${joueurMisAJour.nom} ont été mises à jour avec succès.`,
      playerId: joueurMisAJour.id
    });
  } else {
    res.status(404).json({ message: 'Joueur non trouvé.' });
  }
});

module.exports = instanceIo => {
  io = instanceIo;
  return app;
};
