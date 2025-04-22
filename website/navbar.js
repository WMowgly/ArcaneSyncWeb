document.addEventListener('DOMContentLoaded', () => {
    const navbar = document.createElement('div');
    navbar.className = 'navbar';
    navbar.innerHTML = `
      <a href="index.html">Accueil</a>
      <a href="mj.html">MJ</a>
    `;
    document.body.insertBefore(navbar, document.body.firstChild);
  });
  