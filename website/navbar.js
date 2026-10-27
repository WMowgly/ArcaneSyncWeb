document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);

  // Page intégrée dans l'Écran partagé : pas de barre de navigation.
  if (params.get('embed') === '1') return;

  // -------------------------------------------------------------------------
  // Interface courante : MJ, Joueur ou Écran.
  //
  // La page ouverte fait foi quand elle appartient à une seule interface
  // (une page MJ affiche toujours la barre MJ). Pour les pages partagées
  // (création de personnage, tableau blanc sans contexte), on reprend le
  // choix fait sur l'accueil, mémorisé dans ce navigateur.
  // -------------------------------------------------------------------------
  const page = window.location.pathname.split('/').pop() || 'index.html';
  const playerId = params.get('PlayerId');
  const PAGES_MJ = ['mj.html', 'map.html', 'modification.html'];
  const PAGES_JOUEUR = ['selecte_player.html', 'interface_jeu.html', 'fiche_perso.html', 'map_joueur.html'];

  let choixMemorise = null;
  try { choixMemorise = localStorage.getItem('arcanesync-interface'); } catch (_) {}

  let iface;
  if (PAGES_MJ.includes(page) || (page === 'tableau.html' && params.get('role') === 'mj')) iface = 'mj';
  else if (PAGES_JOUEUR.includes(page) || playerId) iface = 'joueur';
  else iface = ['mj', 'joueur', 'ecran'].includes(choixMemorise) ? choixMemorise : 'joueur';

  try { localStorage.setItem('arcanesync-interface', iface); } catch (_) {}

  const id = playerId ? encodeURIComponent(playerId) : '';
  const LIENS = {
    mj: [
      ['index.html', 'Accueil'],
      ['mj.html', 'MJ'],
      ['map.html', 'Carte (MJ)'],
      ['tableau.html?role=mj', 'Tableau blanc'],
      ['modification.html', 'Données de jeu']
    ],
    // Joueur : choix du personnage tant qu'aucun n'est ouvert ; ensuite,
    // uniquement les menus de CE personnage.
    joueur: playerId
      ? [
          ['index.html', 'Accueil'],
          [`interface_jeu.html?PlayerId=${id}`, 'Jeu'],
          [`fiche_perso.html?PlayerId=${id}`, 'Fiche'],
          [`tableau.html?role=player&PlayerId=${id}`, 'Tableau blanc']
        ]
      : [
          ['index.html', 'Accueil'],
          ['selecte_player.html', 'Personnages'],
          ['create_player.html', 'Créer un personnage']
        ],
    ecran: [
      ['index.html', 'Accueil'],
      ['ecran.html', 'Écran']
    ]
  };

  const liens = LIENS[iface]
    .map(([href, libelle]) => {
      const actif = href.split('?')[0] === page ? ' class="actif"' : '';
      return `<a href="${href}"${actif}>${libelle}</a>`;
    })
    .join('');

  const navbar = document.createElement('div');
  navbar.className = 'navbar-container';
  navbar.innerHTML = `
    <style>
      .navbar-container {
        width: 100%;
        background-color: #333;
      }

      .navbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        padding: 0.5rem 1rem;
        color: white;
      }

      .navbar-brand {
        display: flex;
        align-items: center;
        flex-grow: 1;
      }

      .navbar-toggle {
        font-size: 1.5rem;
        cursor: pointer;
        color: white;
        display: none;
      }

      .navbar-links {
        display: flex;
        justify-content: center;
        flex-grow: 8;
        gap: 1rem;
      }


      .navbar a {
        color: white;
        text-decoration: none;
        padding: 0.5rem;
      }

      .navbar a:hover,
      .navbar a.actif {
        background-color: #575757;
        border-radius: 4px;
      }

      /* Responsive Styles */
      @media (max-width: 768px) {
        .navbar-toggle {
          display: block;
        }

        .navbar-links {
          display: none;
          flex-direction: column;
          width: 100%;
        }

        .navbar-links.active {
          display: flex;
        }

        .navbar a {
          padding: 1rem;
          border-top: 1px solid #444;
        }
      }
    </style>

    <div class="navbar">
      <div class="navbar-brand">
        <span class="navbar-toggle" id="js-navbar-toggle">&#9776;</span>
      </div>
      <div class="navbar-links" id="js-menu" data-interface="${iface}">${liens}</div>
    </div>
  `;
  document.body.insertBefore(navbar, document.body.firstChild);

  // Toggle menu on small screens
  document.getElementById('js-navbar-toggle').addEventListener('click', () => {
    document.getElementById('js-menu').classList.toggle('active');
  });
});
