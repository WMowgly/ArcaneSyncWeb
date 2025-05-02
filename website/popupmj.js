export function showMJPopup(joueur) {
  const existingModal = document.querySelector('.modal-overlay');
  if (existingModal) existingModal.remove();

  const overlay = document.createElement('div');
  overlay.classList.add('modal-overlay');

  overlay.innerHTML = `
    <div class="modal">
      <span class="close-btn">&times;</span>
      <h2>${joueur.nom}</h2>
      <p><strong>HP:</strong> ${joueur.hp?.current} / ${joueur.hp?.max}</p>
      <p><strong>Mana:</strong> ${joueur.mana?.current} / ${joueur.mana?.max}</p>
      <p><strong>Protection:</strong> ${joueur.defense?.protection} / ${joueur.defense?.protection_max}</p>
      <button class="fiche-btn">Voir Fiche Complète</button>
    </div>
  `;

  overlay.querySelector('.close-btn').addEventListener('click', () => {
    overlay.remove();
  });

  overlay.querySelector('.fiche-btn').addEventListener('click', () => {
    const params = new URLSearchParams();

    // Champs simples
    params.set("Nom", joueur.nom);
    params.set("Classe", joueur.classe);
    params.set("Race", joueur.race);
    params.set("Niveau", joueur.niveau);
    params.set("Vie", joueur.hp);
    params.set("Mana", joueur.mana);
    params.set("Jets de survie", joueur.defense?.survie || '');
    params.set("Vie bonus", joueur.defense?.bonus_vie || '');
    params.set("Valeur protection", joueur.defense?.protection || '');
    params.set("Valeur protection max", joueur.defense?.protection_max || '');
    params.set("Intox.", joueur.defense?.intox || '');

    const stats = joueur.stats || {};
    params.set("Force", stats.force);
    params.set("Dextérité", stats.dexterite);
    params.set("Magie", stats.magie);
    params.set("Constitution", stats.constitution);
    params.set("Charisme", stats.charisme);
    params.set("Perception", stats.perception);
    params.set("Chance", stats.chance);
    params.set("Intelligence", stats.intelligence);

    const eq = joueur.equipement || {};
    params.set("Sac", eq.sac);
    params.set("Ceinture / Dos", eq.ceinture);
    params.set("Armes", eq.armes);
    params.set("Type d'armure", eq.armure);
    params.set("Résistance", eq.resistance);
    params.set("Durabilité", eq.durabilite);
    params.set("Type Dégâts", eq.degats);

    // Champs textarea
    if (joueur.competences?.classe) params.set("Compétences de Classe & Passifs", joueur.competences.classe);
    if (joueur.competences?.sorts) params.set("Sorts Mineurs / Attaques Spéciales", joueur.competences.sorts);
    if (joueur.competences?.speciales) params.set("Compétences spéciales du personnage", joueur.competences.speciales);
    if (joueur.bio) params.set("Biographie", joueur.bio);
    if (joueur.levelup) params.set("Choix de level up et Effets permanents", joueur.levelup);

    // Ouvrir la fiche préremplie
    window.open(`fiche_perso.html?${params.toString()}`, '_blank');
  });

  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
}
