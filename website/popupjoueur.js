/**
 * Ouvre l'Interface de Jeu d'un personnage.
 *
 * Seul l'identifiant voyage dans l'URL : l'interface charge tout le reste
 * depuis le serveur. Transporter le personnage complet en paramètres
 * (sorts, inventaire en JSON...) donnait des URL démesurées et des données
 * périmées qui pouvaient écraser l'état de la partie.
 */
export function openFicheJoueur(joueur) {
  const params = new URLSearchParams();
  if (joueur.id) params.set("PlayerId", joueur.id);
  else params.set("Nom", joueur.nom || '');   // compatibilité : personnage sans ID

  window.open(`interface_jeu.html?${params.toString()}`, '_blank');
}
