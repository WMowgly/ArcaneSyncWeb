// mj-code.js
// ---------------------------------------------------------------------------
// Code MJ côté navigateur.
//
// Le code est saisi une fois (accueil ou première page MJ), puis mémorisé
// dans ce navigateur. Ce script, chargé AVANT les scripts de la page :
//   - ajoute le code à chaque appel /api (en-tête X-ArcaneSync-MJ) et, sur
//     les pages MJ, déclare le rôle (X-ArcaneSync-Role: mj) ;
//   - transmet le code à la connexion Socket.IO ;
//   - redemande le code quand le serveur répond « code MJ requis », puis
//     rejoue la requête ;
//   - sur une page MJ, vérifie le code dès l'ouverture.
// ---------------------------------------------------------------------------
(function () {
  const CLE = 'arcanesync-code-mj';
  const lire = () => { try { return localStorage.getItem(CLE) || ''; } catch (_) { return ''; } };
  const ecrire = code => {
    try { code ? localStorage.setItem(CLE, code) : localStorage.removeItem(CLE); } catch (_) {}
  };

  const params = new URLSearchParams(location.search);
  const page = location.pathname.split('/').pop() || 'index.html';
  const pageMj = ['mj.html', 'map.html', 'modification.html'].includes(page)
    || (page === 'tableau.html' && params.get('role') === 'mj');

  // --- Requêtes HTTP ---------------------------------------------------------
  const fetchOrigine = window.fetch.bind(window);

  function estApi(input) {
    try {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      return url.origin === location.origin && url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/mj/');
    } catch (_) {
      return false;
    }
  }

  function avecCode(init) {
    const entetes = new Headers(init?.headers || {});
    const code = lire();
    if (code) entetes.set('X-ArcaneSync-MJ', code);
    if (pageMj) entetes.set('X-ArcaneSync-Role', 'mj');
    return { ...init, headers: entetes };
  }

  window.fetch = async (input, init) => {
    if (!estApi(input)) return fetchOrigine(input, init);
    let reponse = await fetchOrigine(input, avecCode(init));
    if (reponse.status === 403 && reponse.headers.get('X-ArcaneSync-MJ') === 'requis') {
      if (await demanderCode()) reponse = await fetchOrigine(input, avecCode(init));
    }
    return reponse;
  };

  // --- Socket.IO : le code accompagne chaque (re)connexion ------------------
  if (typeof window.io === 'function') {
    const ioOrigine = window.io;
    const ioAvecCode = function (url, options) {
      if (url && typeof url === 'object') { options = url; url = undefined; }
      const opts = { ...(options || {}), auth: rappel => rappel({ mjCode: lire() }) };
      return url === undefined ? ioOrigine(opts) : ioOrigine(url, opts);
    };
    Object.assign(ioAvecCode, ioOrigine);
    window.io = ioAvecCode;
  }

  // --- Dialogue de saisie ----------------------------------------------------
  async function lireStatut() {
    try {
      const reponse = await fetchOrigine('/api/mj/statut');
      return reponse.ok ? await reponse.json() : null;
    } catch (_) {
      return null;
    }
  }

  async function codeValide(code) {
    if (!code) return false;
    try {
      const reponse = await fetchOrigine('/api/mj/verifier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      return reponse.ok && (await reponse.json()).valide === true;
    } catch (_) {
      return false;
    }
  }

  function installerStyle() {
    if (document.getElementById('mjc-style')) return;
    const style = document.createElement('style');
    style.id = 'mjc-style';
    style.textContent = `
      .mjc-fond { position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center;
        justify-content: center; background: rgba(0, 0, 0, .6); padding: 16px; }
      .mjc-boite { width: 100%; max-width: 360px; box-sizing: border-box; padding: 20px;
        background: #fffaf0; color: #3b2614; border: 2px solid #8b5e3c; border-radius: 10px;
        font-family: 'Segoe UI', system-ui, sans-serif; font-size: 15px; box-shadow: 0 8px 30px rgba(0,0,0,.4); }
      .mjc-boite h2 { margin: 0 0 8px; font-size: 20px; }
      .mjc-boite p { margin: 0 0 12px; line-height: 1.4; }
      .mjc-boite label { display: block; margin: 0 0 10px; font-weight: 600; }
      .mjc-boite input { display: block; width: 100%; box-sizing: border-box; margin-top: 4px; padding: 8px;
        font: inherit; border: 1px solid #8b5e3c; border-radius: 6px; background: #fff; color: #222; }
      .mjc-erreur { color: #a11; min-height: 1.2em; }
      .mjc-actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
      .mjc-actions button { font: inherit; padding: 8px 14px; border-radius: 6px; cursor: pointer;
        border: 1px solid #8b5e3c; background: #f3e3c8; color: #3b2614; width: auto; height: auto; margin: 0; }
      .mjc-actions button[type="submit"] { background: #8b5e3c; color: #fff; }
    `;
    document.head.appendChild(style);
  }

  function champ(nom, libelle, autocomplete) {
    return `<label>${libelle}<input type="password" name="${nom}" autocomplete="${autocomplete}" required></label>`;
  }

  function afficherFenetre({ mode, bloquant }) {
    return new Promise(resoudre => {
      installerStyle();
      const textes = {
        saisie: ['Code MJ', 'Saisissez le code MJ. Il sera mémorisé dans ce navigateur.',
          champ('code', 'Code MJ', 'current-password')],
        creation: ['Choisir le code MJ', 'Première utilisation : choisissez le code qui protégera les actions du MJ (4 caractères minimum).',
          champ('nouveau', 'Nouveau code', 'new-password') + champ('confirmation', 'Confirmer le code', 'new-password')],
        changement: ['Changer le code MJ', 'Les autres appareils MJ devront saisir le nouveau code.',
          champ('actuel', 'Code actuel', 'current-password') + champ('nouveau', 'Nouveau code', 'new-password')
            + champ('confirmation', 'Confirmer le code', 'new-password')]
      }[mode];

      const fond = document.createElement('div');
      fond.className = 'mjc-fond';
      fond.innerHTML = `
        <form class="mjc-boite" role="dialog" aria-modal="true" aria-labelledby="mjc-titre">
          <h2 id="mjc-titre">${textes[0]}</h2>
          <p>${textes[1]}</p>
          ${textes[2]}
          <p class="mjc-erreur" role="alert"></p>
          <div class="mjc-actions">
            <button type="button" data-annuler>${bloquant ? "Retour à l'accueil" : 'Annuler'}</button>
            <button type="submit">Valider</button>
          </div>
        </form>`;
      document.body.appendChild(fond);
      const formulaire = fond.querySelector('form');
      const erreur = fond.querySelector('.mjc-erreur');
      const valeur = nom => formulaire.elements[nom]?.value.trim() || '';
      formulaire.querySelector('input').focus();

      const fermer = resultat => { fond.remove(); resoudre(resultat); };

      fond.querySelector('[data-annuler]').addEventListener('click', () => {
        if (bloquant) location.href = 'index.html';
        else fermer(false);
      });

      formulaire.addEventListener('submit', async event => {
        event.preventDefault();
        erreur.textContent = '';
        if (mode === 'saisie') {
          if (await codeValide(valeur('code'))) { ecrire(valeur('code')); fermer(true); }
          else erreur.textContent = 'Code incorrect.';
          return;
        }
        if (valeur('nouveau') !== valeur('confirmation')) {
          erreur.textContent = 'Les deux codes ne correspondent pas.';
          return;
        }
        try {
          const reponse = await fetchOrigine('/api/mj/code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nouveau: valeur('nouveau'), actuel: valeur('actuel') || lire() })
          });
          const resultat = await reponse.json();
          if (!reponse.ok) throw new Error(resultat.message || `Erreur HTTP ${reponse.status}`);
          ecrire(valeur('nouveau'));
          fermer(true);
        } catch (e) {
          erreur.textContent = e.message;
        }
      });
    });
  }

  let enCours = null;
  async function demanderCode(options = {}) {
    if (enCours) return enCours;
    enCours = (async () => {
      const statut = await lireStatut();
      if (!statut) return false;
      if (options.mode === 'changement') {
        if (statut.source === 'env') {
          alert('Le code MJ est fixé sur le serveur (ARCANESYNC_MJ_CODE) : il ne se change pas ici.');
          return false;
        }
        return afficherFenetre({ mode: statut.configure ? 'changement' : 'creation' });
      }
      // Sur une page MJ, rien ne fonctionne sans le code : pas d'annulation,
      // seulement le retour à l'accueil.
      return afficherFenetre({ mode: statut.configure ? 'saisie' : 'creation', bloquant: options.bloquant ?? pageMj });
    })();
    try { return await enCours; } finally { enCours = null; }
  }

  /** Vrai si ce navigateur détient un code valide (le demande sinon). */
  async function assurer() {
    const statut = await lireStatut();
    // Serveur lancé avant l'arrivée du code MJ : il ne sait pas le vérifier.
    // On prévient au lieu de bloquer le bouton sans rien dire.
    if (!statut) {
      alert("Le serveur ArcaneSync doit être redémarré pour activer le code MJ.\n\nL'interface MJ s'ouvre sans code en attendant.");
      return true;
    }
    if (statut?.configure && await codeValide(lire())) return true;
    return demanderCode();
  }

  // --- Page MJ : vérification à l'ouverture ---------------------------------
  async function garde() {
    const statut = await lireStatut();
    if (!statut) return;
    if (statut.configure && await codeValide(lire())) return;
    if (statut.configure) ecrire('');
    const ok = await demanderCode({ bloquant: true });
    // Les connexions ouvertes sans code valide ont reçu une vue joueur :
    // on recharge pour repartir avec le rôle MJ.
    if (ok && statut.configure) location.reload();
  }

  if (pageMj) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', garde);
    else garde();
  }

  window.ArcaneMJ = {
    assurer,
    changerCode: () => demanderCode({ mode: 'changement' }),
    oublier: () => ecrire('')
  };
})();
