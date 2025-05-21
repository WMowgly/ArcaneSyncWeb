export function showMJPopup(joueur) {
  const existingModal = document.querySelector('.modal-overlay');
  if (existingModal) existingModal.remove();

  const overlay = document.createElement('div');
  overlay.classList.add('modal-overlay');

  overlay.innerHTML = `
    <div class="modal">
      <span class="close-btn">&times;</span>
      <h2>${joueur.nom}</h2>
      <p><strong>HP:</strong> ${joueur.hp?.current || 0} / ${joueur.hp?.max || 0}</p>
      <p><strong>Mana:</strong> ${joueur.mana?.current || 0} / ${joueur.mana?.max || 0}</p>
      <p><strong>Protection:</strong> ${joueur.armure?.protection?.current || 0} / ${joueur.armure?.protection?.max || 0}</p>
      <button class="fiche-btn">Voir Fiche Complète</button>
    </div>
  `;

  overlay.querySelector('.close-btn').addEventListener('click', () => {
    overlay.remove();
  });

  overlay.querySelector('.fiche-btn').addEventListener('click', () => {
    const params = new URLSearchParams();

    // Informations de base
    params.set("Nom", joueur.nom);
    params.set("Classe", joueur.classe);
    params.set("Race", joueur.race);
    params.set("Niveau", joueur.niveau);

    // Stats vitales
    params.set("VieMax", joueur.hp?.max || '0');
    params.set("VieCurrent", joueur.hp?.current || '0');
    params.set("ManaMax", joueur.mana?.max || '0');
    params.set("ManaCurrent", joueur.mana?.current || '0');

    // Armure et protection
    params.set("Vie bonus", joueur.bonus_vie || '0');
    params.set("Valeur protection", joueur.armure?.protection?.current || '0');
    params.set("Valeur protection max", joueur.armure?.protection?.max || '0');
    params.set("DuraMax", joueur.armure?.durabilite?.max || '0');
    params.set("DuraCurrent", joueur.armure?.durabilite?.current || '0');
    params.set("Type d'armure", joueur.armure?.type || '');
    params.set("Résistance", joueur.armure?.resistance || '');
    params.set("Intox.", joueur.intox || '0');

    // Stats
    const stats = joueur.stats || {};
    params.set("Force", stats.force || '0');
    params.set("Dexterite", stats.dexterite || '0');
    params.set("Magie", stats.magie || '0');
    params.set("Constitution", stats.constitution || '0');
    params.set("Charisme", stats.charisme || '0');
    params.set("Perception", stats.perception || '0');
    params.set("Chance", stats.chance || '0');
    params.set("Intelligence", stats.intelligence || '0');

    // Inventaire
    params.set("Sac", joueur.sac || '');
    params.set("Ceinture / Dos", joueur.ceinture || '');

    // Sorts et compétences
    if (joueur.spells) params.set("Sorts", JSON.stringify(joueur.spells));
    if (joueur.sorts_mineurs) params.set("Sorts mineurs", JSON.stringify(joueur.sorts_mineurs));
    if (joueur.competences) params.set("Competences", JSON.stringify(joueur.competences));
    if (joueur.armes) params.set("Armes", JSON.stringify(joueur.armes));

    // Informations additionnelles
    if (joueur.skills_speciales) params.set("Skills speciales", joueur.skills_speciales);
    if (joueur.bio) params.set("Biographie", joueur.bio);
    if (joueur.levelup) params.set("Choix de level up", joueur.levelup);

    // Ouvrir la fiche préremplie
    window.open(`fiche_perso.html?${params.toString()}`, '_blank');
  });

  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
}
