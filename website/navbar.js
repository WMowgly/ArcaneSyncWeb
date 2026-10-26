document.addEventListener('DOMContentLoaded', () => {
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

      .navbar a:hover {
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
      <div class="navbar-links" id="js-menu">
        <a href="index.html">Accueil</a>
        <a href="mj.html">MJ</a>
        <a href="selecte_player.html">Liste des joueurs</a>
        <a href="create_player.html">Créer un joueur</a>
        <a href="map.html" data-nav="map">Carte</a>
        <a href="tableau.html">Tableau blanc</a>
      </div>
    </div>
  `;
  document.body.insertBefore(navbar, document.body.firstChild);

  // V1.10 : conserver le contexte de l'utilisateur lors de l'ouverture
  // de la scène de jeu depuis la barre de navigation.
  const params = new URLSearchParams(window.location.search);
  const pathname = window.location.pathname;
  const estPageMj = pathname.endsWith('/mj.html') || pathname.endsWith('/map.html');
  const playerId = params.get('PlayerId');

  const tableauLink = navbar.querySelector('a[href="tableau.html"]');
  if (tableauLink) {
    if (pathname.endsWith('/mj.html')) {
      tableauLink.href = 'tableau.html?role=mj';
    } else if (playerId) {
      tableauLink.href = `tableau.html?role=player&PlayerId=${encodeURIComponent(playerId)}`;
    }
  }

  // V1.13 : la carte a deux interfaces distinctes. Le lien pointe vers
  // l'outil MJ ou vers la vue joueur selon le contexte de la page.
  const mapLink = navbar.querySelector('a[data-nav="map"]');
  if (mapLink) {
    if (estPageMj) {
      mapLink.href = 'map.html';
      mapLink.textContent = 'Carte (MJ)';
    } else if (playerId) {
      mapLink.href = `map_joueur.html?PlayerId=${encodeURIComponent(playerId)}`;
      mapLink.textContent = 'Ma carte';
    }
  }

  // Toggle menu on small screens
  document.getElementById('js-navbar-toggle').addEventListener('click', () => {
    document.getElementById('js-menu').classList.toggle('active');
  });
});
