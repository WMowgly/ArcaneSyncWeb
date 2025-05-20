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
        <a href="tableau.html">Tableau blanc</a>
      </div>
    </div>
  `;
  document.body.insertBefore(navbar, document.body.firstChild);

  // Toggle menu on small screens
  document.getElementById('js-navbar-toggle').addEventListener('click', () => {
    document.getElementById('js-menu').classList.toggle('active');
  });
});
