export function showMJPopup(joueur) {
  const existingModal = document.querySelector('.modal-overlay');
  if (existingModal) existingModal.remove();

  const overlay = document.createElement('div');
  overlay.classList.add('modal-overlay');

  overlay.innerHTML = `
    <div class="modal">
      <span class="close-btn">&times;</span>
      <h2>${joueur.nom}</h2>
      <p><strong>HP:</strong> ${joueur.hp}</p>
      <p><strong>Mana:</strong> ${joueur.mana}</p>
      <button class="fiche-btn">Voir Fiche Complète</button>
    </div>
  `;

  overlay.querySelector('.close-btn').addEventListener('click', () => {
    overlay.remove();
  });

  overlay.querySelector('.fiche-btn').addEventListener('click', () => {
    const queryParams = new URLSearchParams(joueur).toString();
    window.location.href = `fiche_perso.html?${queryParams}`;
  });

  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
}
