document.addEventListener('DOMContentLoaded', () => {
    const navbar = document.createElement('div');
    navbar.className = 'navbar';
    navbar.innerHTML = `
      <a href="index.html">Accueil</a>
      <a href="mj.html">MJ</a>
      <a href="selecte_player.html">Liste des joueurs</a>
      <a href="create_player.html">Créer un joueur</a>
      <a href="tableau.html">Tableau blanc</a>
    `;
    document.body.insertBefore(navbar, document.body.firstChild);
  });
  