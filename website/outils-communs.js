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
  },

  /**
   * V2.4 — Créatures d'une rencontre déployée, regroupées (carte MJ, tableau
   * blanc). `rencontreDe(element)` renvoie le lien { nom, deploiement, le }
   * ou null. Résultat : les éléments sans rencontre (dans l'ordre reçu) et
   * un sous-groupe par déploiement, du plus ancien au plus récent, nommé
   * comme la rencontre (« Embuscade », puis « Embuscade #2 » si elle a été
   * déployée deux fois).
   */
  regrouperParRencontre(liste, rencontreDe) {
    const libres = [];
    const parDeploiement = new Map();
    liste.forEach(element => {
      const lien = rencontreDe(element);
      if (!lien || !lien.deploiement) { libres.push(element); return; }
      if (!parDeploiement.has(lien.deploiement)) {
        parDeploiement.set(lien.deploiement, { cle: lien.deploiement, nom: lien.nom || 'Rencontre', le: lien.le || '', liste: [] });
      }
      parDeploiement.get(lien.deploiement).liste.push(element);
    });
    const vus = new Map();
    const groupes = [...parDeploiement.values()]
      .sort((a, b) => a.le.localeCompare(b.le))
      .map(groupe => {
        const rang = (vus.get(groupe.nom) || 0) + 1;
        vus.set(groupe.nom, rang);
        return { cle: groupe.cle, titre: rang > 1 ? `${groupe.nom} #${rang}` : groupe.nom, liste: groupe.liste };
      });
    return { libres, groupes };
  }
});
