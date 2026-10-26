// Bac a sable de donnees : DOIT rester le tout premier require.
const bacDonnees = require('./_donnees');
const fs = require('fs');
const path = require('path');

const file = bacDonnees.chemin('mob_templates.json');
const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;

try {
  delete require.cache[require.resolve('../mob')];
  const mob = require('../mob');

  const template = mob.createMobTemplate({
    nom: '__TEST_TEMPLATE__',
    hp: { max: 30, current: 30 },
    stats: { force: 7 }
  });

  if (!template?.id) throw new Error('Template sans ID.');
  if (!mob.getMobTemplateById(template.id)) throw new Error('Template introuvable.');

  const active = mob.createMobFromTemplate(template.id);
  if (!active?.id || active.id === template.id) throw new Error('ID du mob actif invalide.');
  if (active.hp.max !== 30 || active.stats.force !== 7) throw new Error('Copie template incorrecte.');

  // ---------------------------------------------------------------------
  // V1.13.5 — Trois niveaux distincts, sans duplication de données
  //
  //   TEMPLATE  mobtpl_*  templateId vide      définition réutilisable
  //   INSTANCE  mob_*     templateId -> modèle état propre en partie
  //   TOKEN     map.js                          position seulement
  // ---------------------------------------------------------------------
  function verifier(condition, message) {
    if (!condition) throw new Error(message);
  }

  const vierge = mob.normaliserMob({ nom: 'Sonde' });
  verifier(vierge.categorie === 'autre', 'Catégorie par défaut incorrecte.');
  verifier(typeof vierge.icone === 'string' && vierge.icone.length > 0, 'Icône par défaut absente.');
  verifier(vierge.templateId === '', 'Une créature sans modèle ne doit pas porter de templateId.');

  const categories = mob.getCategoriesMob();
  verifier(categories.length >= 5, 'Catalogue de catégories trop pauvre.');
  verifier(categories.every(c => c.id && c.nom && c.icone), 'Catégorie incomplète.');

  const humanoide = mob.normaliserMob({ nom: 'Garde', categorie: 'humanoide' });
  verifier(humanoide.categorie === 'humanoide', 'Catégorie explicite non conservée.');
  verifier(humanoide.icone !== vierge.icone, "L'icône doit suivre la catégorie.");

  const inventee = mob.normaliserMob({ nom: 'X', categorie: '__inconnue__' });
  verifier(inventee.categorie === 'autre', 'Une catégorie inconnue doit retomber sur « autre ».');

  // --- Numérotation des instances --------------------------------------
  const gobelin = mob.createMobTemplate({ nom: 'Gobelin', hp: { max: 12, current: 12 }, categorie: 'humanoide' });
  verifier(gobelin.templateId === '', 'Un modèle ne doit pas porter de templateId.');

  const enPartie = {};
  const noms = [];
  for (let i = 0; i < 3; i += 1) {
    const instance = mob.createMobFromTemplate(gobelin.id, {}, { mobsExistants: enPartie });
    verifier(instance.templateId === gobelin.id, "L'instance doit référencer son modèle.");
    verifier(instance.categorie === 'humanoide', 'La catégorie doit être héritée du modèle.');
    enPartie[instance.id] = instance;
    noms.push(instance.nom);
  }

  verifier(noms[0] === 'Gobelin', `Première instance mal nommée : ${noms[0]}`);
  verifier(noms[1] === 'Gobelin #2', `Deuxième instance mal nommée : ${noms[1]}`);
  verifier(noms[2] === 'Gobelin #3', `Troisième instance mal nommée : ${noms[2]}`);
  verifier(new Set(Object.values(enPartie).map(m => m.id)).size === 3, 'Les IDs doivent être uniques.');

  // --- Indépendance : le point le plus important ------------------------
  const instances = Object.values(enPartie);
  instances[0].hp.current = 3;
  instances[0].mana.current = 1;

  verifier(instances[1].hp.current === 12, 'Blesser une instance ne doit pas toucher les autres.');
  verifier(instances[2].hp.current === 12, 'Blesser une instance ne doit pas toucher les autres.');
  verifier(mob.getMobTemplateById(gobelin.id).hp.current === 12,
    'Blesser une instance ne doit JAMAIS modifier le modèle.');

  // Modifier le modèle ne réécrit pas non plus les instances déjà créées.
  mob.updateMobTemplate(gobelin.id, { hp: { max: 40, current: 40 } });
  verifier(instances[1].hp.max === 12,
    'Modifier le modèle ne doit pas altérer les instances existantes.');

  // ---------------------------------------------------------------------
  // V1.13.6 — Bestiaire : duplication et promotion
  //
  // Gobelin -> Dupliquer -> Gobelin Archer, modifiable sans toucher au
  // modèle d'origine. C'est l'opération centrale d'une bibliothèque.
  // ---------------------------------------------------------------------
  const archer = mob.duplicateMobTemplate(gobelin.id, 'Gobelin Archer');
  verifier(archer, 'Duplication du modèle impossible.');
  verifier(archer.id !== gobelin.id, 'Le duplicata doit avoir son propre identifiant.');
  verifier(archer.nom === 'Gobelin Archer', 'Nom du duplicata incorrect.');
  verifier(archer.templateId === '',
    'Un duplicata est un MODELE, pas une instance : templateId doit rester vide.');
  verifier(archer.categorie === gobelin.categorie, 'La catégorie doit être reprise.');

  const copieAuto = mob.duplicateMobTemplate(gobelin.id);
  verifier(copieAuto.nom === 'Gobelin (copie)', `Nom par défaut du duplicata : ${copieAuto.nom}`);
  mob.deleteMobTemplate(copieAuto.id);

  // Modifier le duplicata laisse l'original intact.
  mob.updateMobTemplate(archer.id, { hp: { max: 8, current: 8 } });
  verifier(mob.getMobTemplateById(archer.id).hp.max === 8, 'Le duplicata devrait être modifié.');
  verifier(mob.getMobTemplateById(gobelin.id).hp.max === 40,
    "Modifier un duplicata ne doit JAMAIS toucher le modèle d'origine.");

  verifier(mob.duplicateMobTemplate('mobtpl_inexistant') === null,
    'Dupliquer un modèle inconnu doit échouer proprement.');

  // Promotion : une créature ajustée en jeu devient un modèle réutilisable.
  const blesse = instances[0];
  const promu = mob.templateDepuisMob(blesse, 'Gobelin vétéran');
  verifier(promu, 'Promotion en modèle impossible.');
  verifier(promu.nom === 'Gobelin vétéran', 'Nom du modèle promu incorrect.');
  verifier(promu.templateId === '',
    'Un modèle promu ne doit pas conserver la filiation de l\'instance.');
  verifier(promu.id !== blesse.id, 'Le modèle promu doit avoir son propre identifiant.');
  verifier(promu.id.startsWith('mobtpl_'), 'Un modèle doit porter un identifiant de modèle.');

  verifier(mob.templateDepuisMob(null) === null, 'Promouvoir un mob absent doit échouer.');

  // ---------------------------------------------------------------------
  // Duplication d'une INSTANCE de la partie : copie conforme, indépendante.
  // ---------------------------------------------------------------------
  const original = mob.normaliserMob({
    nom: 'Gobelin #2', templateId: gobelin.id,
    hp: { max: 12, current: 5 }, stats: { force: 9 },
    armes: [{ nom: 'Gourdin' }], statuts: [{ id: 'poison', nom: 'Poison' }]
  });
  // enPartie contient déjà Gobelin, Gobelin #2 et Gobelin #3.
  const double = mob.duplicateMob(original, enPartie);
  verifier(double && double.id !== original.id && double.id.startsWith('mob_'),
    'Le double doit avoir son propre identifiant d\'instance.');
  verifier(double.nom === 'Gobelin #4', `Nom du double : ${double.nom}`);
  verifier(double.templateId === gobelin.id, 'Le double doit garder la filiation du modèle.');
  verifier(double.hp.current === 5 && double.stats.force === 9 && double.statuts.length === 1,
    "Le double doit reprendre l'état courant de l'original.");
  double.hp.current = 0;
  double.stats.force = 1;
  double.armes[0].nom = 'Épée';
  double.statuts.length = 0;
  verifier(original.hp.current === 5 && original.stats.force === 9
    && original.armes[0].nom === 'Gourdin' && original.statuts.length === 1,
    "Modifier le double ne doit JAMAIS toucher l'original.");
  verifier(mob.duplicateMob(null) === null, 'Dupliquer un mob absent doit échouer.');

  mob.deleteMobTemplate(archer.id);
  mob.deleteMobTemplate(promu.id);

  verifier(mob.deleteMobTemplate(gobelin.id), 'Suppression du modèle Gobelin échouée.');

  if (!mob.deleteMobTemplate(template.id)) throw new Error('Suppression template échouée.');

  console.log('PASS: bestiaire — modèles, duplication, promotion, instances indépendantes et numérotées');
} finally {
  if (original === null) {
    try { fs.unlinkSync(file); } catch (_) {}
  } else {
    fs.writeFileSync(file, original, 'utf8');
  }
  delete require.cache[require.resolve('../mob')];
}

// v1.8.2 — restauration des ressources mobs
const fsV182 = require('fs');
const pathV182 = require('path');
const mjSourceV182 = fsV182.readFileSync(pathV182.join(__dirname, '..', 'website', 'mj.html'), 'utf8');
if (!mjSourceV182.includes('data-a="heal"')) throw new Error('Bouton + HP absent des mobs.');
if (!mjSourceV182.includes('data-a="restore-mana"')) throw new Error('Bouton + Mana absent des mobs.');
if (!mjSourceV182.includes('Math.min(max,cur+amount)')) throw new Error('Plafond HP mob absent.');
if (!mjSourceV182.includes('Math.min(manaMax,manaCur+amount)')) throw new Error('Plafond Mana mob absent.');

// ---------------------------------------------------------------------
// V1.13.8 — Statuts sur les créatures
//
// Les créatures partagent le catalogue des personnages (STATUTS_JOUEUR) :
// pas de second référentiel à maintenir. Seule l'agonie reste propre aux
// personnages — pour une créature, statut 'mort' joue déjà ce rôle.
// ---------------------------------------------------------------------
{
  const fichierSession = bacDonnees.chemin('session.json');
  const sessionOriginale = fs.existsSync(fichierSession)
    ? fs.readFileSync(fichierSession, 'utf8') : null;

  try {
    delete require.cache[require.resolve('../session')];
    delete require.cache[require.resolve('../mob')];
    const session = require('../session');
    const mobLib = require('../mob');

    // Le champ statuts doit survivre à la normalisation, et exister par défaut.
    const neuf = mobLib.normaliserMob({ id: 'mob_stat', nom: '__TEST_STATUT__' });
    if (!Array.isArray(neuf.statuts) || neuf.statuts.length !== 0) {
      throw new Error('Une créature doit naître avec une liste de statuts vide.');
    }
    const porteur = mobLib.normaliserMob({
      id: 'mob_stat', nom: '__TEST_STATUT__',
      statuts: [{ id: 'poison', nom: 'Poison', appliedAt: '2026-01-01T00:00:00.000Z' }]
    });
    if (porteur.statuts.length !== 1) throw new Error('normaliserMob doit conserver les statuts.');

    if (!session.sauvegarderMobSession({ id: 'mob_stat', nom: '__TEST_STATUT__', statuts: [] })) {
      throw new Error('Impossible de placer la créature de test en session.');
    }

    // Catalogue partagé : ce que connaissent les personnages, rien de plus.
    const catalogue = session.getStatutsJoueurDisponibles().map(s => s.id);
    if (!catalogue.includes('poison')) throw new Error('Catalogue de statuts incomplet.');

    const applique = session.ajouterStatutMob('mob_stat', 'poison');
    if (!applique.success) throw new Error('Application de Poison refusée : ' + applique.message);
    if (applique.mob.statuts[0].id !== 'poison') throw new Error('Poison non enregistré.');
    if (!applique.mob.statuts[0].appliedAt) throw new Error('Horodatage du statut absent.');

    // Idempotence : deux fois le même statut ne doit pas s'empiler.
    if (session.ajouterStatutMob('mob_stat', 'poison').success) {
      throw new Error('Un statut déjà appliqué ne doit pas être ajouté deux fois.');
    }

    // Un identifiant inventé ne doit rien créer.
    if (session.ajouterStatutMob('mob_stat', 'petrification__inconnu').success) {
      throw new Error('Un statut hors catalogue doit être refusé.');
    }
    if (session.ajouterStatutMob('mob_inexistant', 'poison').success) {
      throw new Error('Une créature inconnue doit être refusée.');
    }

    // L'agonie traduit un personnage à 0 PV ; une créature meurt (statut 'mort').
    if (session.ajouterStatutMob('mob_stat', 'agonie').success) {
      throw new Error('L\'agonie ne doit pas s\'appliquer à une créature.');
    }

    const retire = session.retirerStatutMob('mob_stat', 'poison');
    if (!retire.success) throw new Error('Retrait de Poison refusé : ' + retire.message);
    if (retire.mob.statuts.length !== 0) throw new Error('Poison toujours présent après retrait.');
    if (session.retirerStatutMob('mob_stat', 'poison').success) {
      throw new Error('Retirer un statut absent doit être refusé.');
    }

    session.supprimerMobSession('mob_stat');
    console.log('PASS: statuts de créature — catalogue partagé, refus des cas invalides');
  } finally {
    try { require('../storage').annulerTout(); } catch (_) {}
    if (sessionOriginale !== null) fs.writeFileSync(fichierSession, sessionOriginale, 'utf8');
    delete require.cache[require.resolve('../session')];
    delete require.cache[require.resolve('../mob')];
  }
}
