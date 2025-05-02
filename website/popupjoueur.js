export function openFicheJoueur(joueur) {
  const params = new URLSearchParams();

  // Champs simples
  params.set("Nom", joueur.nom);
  params.set("Classe", joueur.classe);
  params.set("Race", joueur.race);
  params.set("Niveau", joueur.niveau);
  params.set("VieMax", joueur.hp.max);
  params.set("VieCurrent", joueur.hp.current);
  params.set("ManaMax", joueur.mana.max);
  params.set("ManaCurrent", joueur.mana.current);
  //params.set("Jets de survie", joueur.defense?.survie);
  params.set("Vie bonus", joueur.defense?.bonus_vie || '0');
  params.set("Valeur protection", joueur.defense?.protection || '');
  params.set("Valeur protection max", joueur.defense?.protection_max || '');
  params.set("Intox.", joueur.defense?.intox || '');

  // Statistiques
  const stats = joueur.stats || {};
  params.set("Force", stats.force);
  params.set("Dextérité", stats.dexterite);
  params.set("Magie", stats.magie);
  params.set("Constitution", stats.constitution);
  params.set("Charisme", stats.charisme);
  params.set("Perception", stats.perception);
  params.set("Chance", stats.chance);
  params.set("Intelligence", stats.intelligence);

  // Équipement
  const eq = joueur.equipement || {};
  params.set("Sac", eq.sac);
  params.set("Ceinture / Dos", eq.ceinture);
  params.set("Armes", eq.armes);
  params.set("Type d'armure", eq.armure);
  params.set("Résistance", eq.resistance);
  params.set("Durabilité", eq.durabilite);
  params.set("Type Dégâts", eq.degats);

  // Textarea — à afficher à part éventuellement plus tard
  if (joueur.competences?.classe) params.set("Compétences de Classe & Passifs", joueur.competences.classe);
  if (joueur.competences?.sorts) params.set("Sorts Mineurs / Attaques Spéciales", joueur.competences.sorts);
  if (joueur.competences?.speciales) params.set("Compétences spéciales du personnage", joueur.competences.speciales);
  if (joueur.bio) params.set("Biographie", joueur.bio);
  if (joueur.levelup) params.set("Choix de level up et Effets permanents", joueur.levelup);

  // Redirection
  window.open(`interface_jeu.html?${params.toString()}`, '_blank');
}
