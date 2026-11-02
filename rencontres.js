// rencontres.js
// ---------------------------------------------------------------------------
// Rencontres préparées (V2.4) : groupes de créatures du bestiaire, prêts à
// être déployés sur la carte en un clic (« Embuscade gobelins : 3 gobelins
// + 1 chef »).
//
// MODÈLE (rencontres.json)
//   { id, nom, notes,
//     groupes: [{ templateId, quantite (1-20), initiative (entier ou null) }],
//     createdAt, updatedAt }
//
// Les rencontres référencent les modèles du bestiaire (mob_templates.json)
// par leur identifiant : un modèle modifié s'applique aux prochains
// déploiements ; un modèle supprimé est simplement ignoré au déploiement.
// Elles se gèrent dans Données de jeu (réservé au MJ) et se déploient
// depuis la carte MJ (serveur/routes-rencontres.js).
// ---------------------------------------------------------------------------
const fs = require('fs');
const crypto = require('crypto');
const { creerDepot, cheminDonnees, signalerFichierIllisible } = require('./storage');

const cheminFichier = cheminDonnees('rencontres.json');
const depot = creerDepot(cheminFichier, { etiquette: 'rencontres.json' });

const MAX_GROUPES = 20;
const MAX_QUANTITE = 20;

const texte = (valeur, max) => (typeof valeur === 'string' ? valeur.trim().slice(0, max) : '');

function initiativeOuNull(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  const n = Math.round(Number(valeur));
  return Number.isFinite(n) ? Math.max(-99, Math.min(999, n)) : null;
}

function normaliserGroupe(groupe) {
  const templateId = texte(groupe?.templateId, 120);
  if (!templateId) return null;
  const quantite = Math.round(Number(groupe?.quantite));
  return {
    templateId,
    quantite: Number.isFinite(quantite) ? Math.max(1, Math.min(MAX_QUANTITE, quantite)) : 1,
    initiative: initiativeOuNull(groupe?.initiative)
  };
}

function normaliserRencontre(entree = {}, options = {}) {
  const maintenant = new Date().toISOString();
  return {
    id: options.id || texte(entree.id, 80) || `rencontre_${crypto.randomUUID()}`,
    nom: texte(entree.nom, 120),
    notes: texte(entree.notes, 2000),
    groupes: (Array.isArray(entree.groupes) ? entree.groupes : [])
      .map(normaliserGroupe).filter(Boolean).slice(0, MAX_GROUPES),
    createdAt: entree.createdAt || maintenant,
    updatedAt: maintenant
  };
}

let rencontres = [];
if (fs.existsSync(cheminFichier)) {
  try {
    const donnees = JSON.parse(fs.readFileSync(cheminFichier, 'utf8'));
    if (!Array.isArray(donnees)) throw new Error('rencontres.json doit contenir une liste.');
    rencontres = donnees
      .map(r => ({ ...normaliserRencontre(r, { id: r?.id }), createdAt: r?.createdAt, updatedAt: r?.updatedAt || r?.createdAt }))
      .filter(r => r.nom);
  } catch (erreur) {
    // Fichier présent mais illisible : aucune rencontre ne doit l'écraser.
    console.error('Erreur lors de la lecture de rencontres.json:', erreur);
    rencontres = [];
    signalerFichierIllisible(cheminFichier, erreur);
  }
}

function ecrire(liste) {
  if (!depot.ecrire(JSON.stringify(liste, null, 2))) return false;
  rencontres = liste;
  return true;
}

const copie = valeur => JSON.parse(JSON.stringify(valeur));

function getRencontres() {
  return copie(rencontres);
}

function getRencontreById(id) {
  const trouvee = rencontres.find(r => r.id === id);
  return trouvee ? copie(trouvee) : null;
}

function valider(rencontre) {
  if (!rencontre.nom) return 'Le nom de la rencontre est requis.';
  if (!rencontre.groupes.length) return 'Ajoutez au moins une créature du bestiaire.';
  return null;
}

function creerRencontre(donnees = {}) {
  const rencontre = normaliserRencontre({ ...donnees, id: undefined, createdAt: undefined });
  const erreur = valider(rencontre);
  if (erreur) return { success: false, message: erreur };
  if (!ecrire([...rencontres, rencontre])) return { success: false, message: "Impossible d'enregistrer la rencontre." };
  return { success: true, rencontre: copie(rencontre) };
}

function modifierRencontre(id, donnees = {}) {
  const index = rencontres.findIndex(r => r.id === id);
  if (index === -1) return { success: false, introuvable: true, message: 'Rencontre introuvable.' };
  const rencontre = normaliserRencontre({ ...rencontres[index], ...donnees }, { id });
  rencontre.createdAt = rencontres[index].createdAt;
  const erreur = valider(rencontre);
  if (erreur) return { success: false, message: erreur };
  const liste = rencontres.slice();
  liste[index] = rencontre;
  if (!ecrire(liste)) return { success: false, message: "Impossible d'enregistrer la rencontre." };
  return { success: true, rencontre: copie(rencontre) };
}

function supprimerRencontre(id) {
  if (!rencontres.some(r => r.id === id)) return { success: false, introuvable: true, message: 'Rencontre introuvable.' };
  if (!ecrire(rencontres.filter(r => r.id !== id))) return { success: false, message: 'Impossible de supprimer la rencontre.' };
  return { success: true };
}

function dupliquerRencontre(id) {
  const source = rencontres.find(r => r.id === id);
  if (!source) return { success: false, introuvable: true, message: 'Rencontre introuvable.' };
  return creerRencontre({ ...copie(source), nom: `${source.nom} (copie)`.slice(0, 120) });
}

module.exports = {
  getRencontres,
  getRencontreById,
  creerRencontre,
  modifierRencontre,
  supprimerRencontre,
  dupliquerRencontre,
  normaliserRencontre,
  MAX_GROUPES,
  MAX_QUANTITE
};
