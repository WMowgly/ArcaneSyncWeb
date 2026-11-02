// choix-ecran.js
// ---------------------------------------------------------------------------
// Sélecteur « 🖥️ Écran : Carte | Tableau blanc » (V2.4).
//
// Le MJ choisit ce qu'affiche l'Écran partagé depuis la page MJ, la carte MJ
// ou le tableau blanc (MJ) : un seul composant, un seul comportement.
//
//   ArcaneChoixEcran.monter(conteneur, socket)
//     conteneur : élément vide qui reçoit le sélecteur ;
//     socket    : connexion Socket.IO de la page (suivi des choix faits
//                 depuis un autre poste ou une autre page).
//
// Les requêtes passent par le fetch de mj-code.js (code MJ ajouté).
// ---------------------------------------------------------------------------
(function () {
  'use strict';

  const STYLE = `
    .choix-ecran {
      display: inline-flex; align-items: center; white-space: nowrap;
      border: 2px solid #8b5e3c; border-radius: 8px; overflow: hidden; background: #fff4d6;
      font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px;
    }
    .choix-ecran span { padding: 0 9px; font-weight: 600; color: #5c3b21; }
    .choix-ecran button {
      margin: 0; padding: 6px 11px; border: 0; border-left: 1px solid #8b5e3c; border-radius: 0;
      background: transparent; color: #5c3b21; font: inherit; cursor: pointer;
    }
    .choix-ecran button:hover { background: #f0e2c4; }
    .choix-ecran button[aria-pressed="true"] { background: #8b5e3c; color: #fefae0; font-weight: 600; }
    .choix-ecran button.choix-rideau { border-left-width: 3px; }
    .choix-ecran button.choix-rideau[aria-pressed="true"] { background: #3b2f1e; color: #f4d58d; }`;

  function injecterStyle() {
    if (document.getElementById('style-choix-ecran')) return;
    const style = document.createElement('style');
    style.id = 'style-choix-ecran';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  function monter(conteneur, socket) {
    if (!conteneur) return;
    injecterStyle();
    conteneur.classList.add('choix-ecran');
    conteneur.setAttribute('role', 'group');
    conteneur.setAttribute('aria-label', "Affichage de l'Écran partagé");
    conteneur.title = "Ce qu'affiche l'Écran partagé";
    conteneur.innerHTML = `<span>🖥️ Écran</span>
      <button type="button" data-ecran-vue="carte" aria-pressed="false">Carte</button>
      <button type="button" data-ecran-vue="tableau" aria-pressed="false">Tableau blanc</button>
      <button type="button" class="choix-rideau" data-ecran-rideau aria-pressed="false"
        title="Baisser le rideau : l'Écran n'affiche plus rien (préparation d'une carte, créatures à placer)">🎭 Rideau</button>`;

    const afficher = vue => conteneur.querySelectorAll('[data-ecran-vue]')
      .forEach(bouton => bouton.setAttribute('aria-pressed', String(bouton.dataset.ecranVue === vue)));

    // V2.4 — Rideau : l'Écran masque tout tant qu'il est baissé.
    const boutonRideau = conteneur.querySelector('[data-ecran-rideau]');
    const afficherRideau = baisse => {
      boutonRideau.setAttribute('aria-pressed', String(baisse === true));
      boutonRideau.textContent = baisse === true ? '🎭 Rideau baissé' : '🎭 Rideau';
    };

    if (socket && typeof socket.on === 'function') {
      socket.on('ecranVue', ({ vue } = {}) => afficher(vue));
      socket.on('ecranReglages', (reglages = {}) => { if (typeof reglages.rideau === 'boolean') afficherRideau(reglages.rideau); });
    }
    fetch('/api/ecran').then(r => r.json()).then(etat => { afficher(etat.vue); afficherRideau(etat.rideau); }).catch(() => {});

    boutonRideau.addEventListener('click', async () => {
      try {
        const baisse = boutonRideau.getAttribute('aria-pressed') !== 'true';
        const reponse = await fetch('/api/ecran', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rideau: baisse })
        });
        const resultat = await reponse.json();
        if (!reponse.ok) throw new Error(resultat.message || `Erreur HTTP ${reponse.status}`);
        afficherRideau(resultat.rideau);
      } catch (erreur) {
        alert(`Impossible de changer le rideau de l'Écran : ${erreur.message}`);
      }
    });

    conteneur.querySelectorAll('[data-ecran-vue]').forEach(bouton => {
      bouton.addEventListener('click', async () => {
        // La vue et le rideau sont indépendants : on peut préparer l'autre vue
        // rideau baissé.
        try {
          const reponse = await fetch('/api/ecran', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vue: bouton.dataset.ecranVue })
          });
          const resultat = await reponse.json();
          if (!reponse.ok) throw new Error(resultat.message || `Erreur HTTP ${reponse.status}`);
          afficher(resultat.vue);
          afficherRideau(resultat.rideau);
        } catch (erreur) {
          alert(`Impossible de changer l'affichage de l'Écran : ${erreur.message}`);
        }
      });
    });
  }

  window.ArcaneChoixEcran = Object.freeze({ monter });
})();
