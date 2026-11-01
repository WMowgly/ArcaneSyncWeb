// outils-communs.js
// ---------------------------------------------------------------------------
// Petites fonctions partagées par toutes les pages (V2.3).
//
// L'échappement HTML était recopié à l'identique dans une dizaine de pages.
// Il est défini ici une fois ; chaque page garde son nom habituel (escapeHtml,
// echapper...) qui délègue à cette fonction.
//
// À charger AVANT les scripts de la page (balise dans <head>).
// ---------------------------------------------------------------------------
window.ArcaneOutils = Object.freeze({
  /** Texte -> HTML sûr : & < > " ' sont échappés ; null / undefined -> ''. */
  echapper(valeur) {
    return String(valeur ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
});
