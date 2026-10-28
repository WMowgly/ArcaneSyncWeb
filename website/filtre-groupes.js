// website/filtre-groupes.js
// ---------------------------------------------------------------------------
// Filtre « Type » des listes de sorts et d'attaques (Fiche, Création).
//
// Masquer un <optgroup> (attribut hidden) ne suffit pas : la liste native
// des téléphones (Android notamment) l'affiche quand même. Les groupes hors
// filtre sont donc RETIRÉS de la liste, puis remis à leur place d'origine
// quand le filtre change. Le choix déjà fait sur une ligne reste toujours
// disponible.
// ---------------------------------------------------------------------------
(function () {
  'use strict';

  // Liste -> tous ses groupes, dans l'ordre d'origine.
  const groupesDe = new WeakMap();

  /** N'affiche dans `select` que les groupes du type choisi ('' = tous). */
  function filtrerGroupes(select, type) {
    if (!groupesDe.has(select)) groupesDe.set(select, [...select.querySelectorAll('optgroup')]);
    const groupes = groupesDe.get(select);
    const valeur = select.value;
    const choisi = select.selectedOptions[0];
    // Les groupes gardés reviennent après les options hors groupe
    // (« Sélectionner un sort », sort hors base), dans leur ordre d'origine.
    groupes.forEach(groupe => groupe.remove());
    groupes
      .filter(groupe => !type || groupe.label === type || groupe.contains(choisi))
      .forEach(groupe => select.appendChild(groupe));
    select.value = valeur;
  }

  window.ArcaneFiltre = { filtrerGroupes };
})();
