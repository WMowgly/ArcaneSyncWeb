export function openFicheJoueur(joueur) {
    const queryParams = new URLSearchParams(joueur).toString();
    window.location.href = `fiche_perso.html?${queryParams}`;
  }
  