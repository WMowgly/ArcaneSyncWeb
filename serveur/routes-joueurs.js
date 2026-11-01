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
  sauvegardeData,
  revisionDe
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

// V2.3 : l'ancienne route DELETE /api/joueurs/delete-by-name/:nom, sans
// appelant, a été retirée : la suppression se fait par identifiant.

/**
 * V2.3 — Enregistrement périmé ? La page indique la révision qu'elle a
 * chargée (`revisionAttendue`). Si le personnage a changé depuis (MJ, autre
 * appareil), on refuse (409) plutôt que d'effacer ces changements.
 * Sans `revisionAttendue` (anciens appels), aucun contrôle.
 */
function refuserSiPerime(req, res, joueur) {
  const attendue = req.body?.revisionAttendue;
  if (attendue === undefined || attendue === null || !joueur) return false;
  if (Number(attendue) === revisionDe(joueur)) return false;
  res.status(409).json({
    conflit: true,
    revision: revisionDe(joueur),
    message: `${joueur.nom} a été modifié ailleurs (par le MJ ou sur un autre appareil) depuis l'ouverture de cette page.`
  });
  return true;
}

// API pour mettre à jour un joueur
app.post('/api/joueur', (req, res) => {
  const { id, nom, nouvellesDonnees } = req.body;

  if ((!id && !nom) || !nouvellesDonnees) {
    return res.status(400).json({
      message: "L'identifiant du joueur et les nouvelles données sont requis."
    });
  }

  const joueurAvant = id
    ? getJoueurById(id)
    : getJoueurs().find(j => typeof j.nom === 'string' && typeof nom === 'string' && j.nom.toLowerCase() === nom.toLowerCase());
  if (refuserSiPerime(req, res, joueurAvant)) return;

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
    // Nom et PV max des jetons : la carte suit la fiche.
    emitMapState();

    res.status(200).json({
      message: `Les données du joueur ${joueurMisAJour.nom} ont été mises à jour avec succès.`,
      playerId: joueurMisAJour.id,
      revision: revisionDe(joueurMisAJour)
    });
  } else {
    res.status(404).json({ message: 'Joueur non trouvé.' });
  }
});

module.exports = instanceIo => {
  io = instanceIo;
  return app;
};
