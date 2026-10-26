// ---------------------------------------------------------------------------
// Sorts et attaques de référence.
//
// database/sorts.json (converti depuis Sorts.txt) est la référence des sorts
// et des attaques spéciales. Il remplace les listes de test de
// game_database.json, sous les noms que les pages lisent déjà :
//   sorts_mineurs  = sorts de niveau 0
//   sorts_majeurs  = les autres (impositions des mains en fin de liste)
//   attack_special = attaques spéciales
//
// `degats` est la valeur de RÉFÉRENCE (liste fournie par le MJ, vide quand
// elle n'en donne pas) : elle pré-remplit la fiche quand on choisit le sort,
// mais le personnage garde sa propre valeur, modifiable sur sa fiche.
// ---------------------------------------------------------------------------

const fs = require('fs');
const { cheminDonnees, creerDepot, sauvegarderRotation } = require('./storage');

function fichierSorts() {
  return cheminDonnees('database', 'sorts.json');
}

/** Listes prêtes pour /api/game-database, ou null si sorts.json est absent ou illisible. */
function listesSortsReference(chemin = fichierSorts()) {
  if (!fs.existsSync(chemin)) return null;

  let ref;
  try {
    ref = JSON.parse(fs.readFileSync(chemin, 'utf8'));
  } catch (erreur) {
    console.error('sorts.json illisible, listes de game_database.json conservées :', erreur);
    return null;
  }

  const ecoles = Object.fromEntries((ref.ecoles || []).map(e => [e.id, e.nom]));
  const versSort = s => ({
    id: s.id,
    nom: s.nom,
    description: s.description || '',
    degats: s.degats || '',
    niveau: s.niveau ?? '',
    ecole: s.ecole,
    ecole_nom: ecoles[s.ecole] || s.ecole,
    duree: s.duree,
    type_action: s.type_action,
    element: s.element,
    ...(s.cout_charges !== undefined ? { cout_charges: s.cout_charges } : {})
  });

  const sorts = Array.isArray(ref.sorts) ? ref.sorts : [];
  const majeurs = sorts.filter(s => s.niveau !== 0);

  return {
    sorts_mineurs: sorts.filter(s => s.niveau === 0).map(versSort),
    sorts_majeurs: [
      ...majeurs.filter(s => s.ecole !== 'imposition'),
      ...majeurs.filter(s => s.ecole === 'imposition')
    ].map(versSort),
    attack_special: (ref.attaques_speciales?.liste || []).map(a => ({
      id: a.id,
      nom: a.nom,
      description: a.description || '',
      degats: a.degats || '',
      niveau: a.niveau ?? '',
      armes: a.armes,
      affinite_magique: a.affinite_magique === true
    }))
  };
}

// ---------------------------------------------------------------------------
// Édition de la référence (interface Modification, réservée au MJ).
//
// Chaque écriture est précédée d'une rotation de sauvegardes (5 versions dans
// database/sauvegardes/) puis faite de façon atomique. Les identifiants sont
// stables : modifier un sort ne change jamais son id. Les personnages, eux,
// mémorisent le NOM : un sort renommé devient « hors base » sur leurs fiches,
// sans être perdu.
// ---------------------------------------------------------------------------

const MAX_NIVEAU = 20;

function lireReference() {
  const ref = JSON.parse(fs.readFileSync(fichierSorts(), 'utf8'));
  if (!Array.isArray(ref.sorts)) ref.sorts = [];
  if (!ref.attaques_speciales || !Array.isArray(ref.attaques_speciales.liste)) {
    ref.attaques_speciales = { regles: ref.attaques_speciales?.regles || '', liste: [] };
  }
  return ref;
}

function ecrireReference(ref) {
  const chemin = fichierSorts();
  sauvegarderRotation(chemin, { generations: 5 });
  return creerDepot(chemin, { etiquette: 'sorts.json' })
    .ecrire(JSON.stringify(ref, null, 2) + '\n');
}

function slug(texte) {
  return String(texte).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'entree';
}

function idUnique(ref, base) {
  const pris = new Set([
    ...ref.sorts, ...ref.attaques_speciales.liste, ...(ref.metamorphoses?.formes || [])
  ].map(x => x.id));
  let id = base, n = 2;
  while (pris.has(id)) id = `${base}-${n++}`;
  return id;
}

const texte = (valeur, max) => (typeof valeur === 'string' ? valeur.trim() : '').slice(0, max);
const texteOuNull = (valeur, max) => texte(valeur, max) || null;

function entierOuNull(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  const n = Number(valeur);
  return Number.isInteger(n) && n >= 0 && n <= MAX_NIVEAU ? n : NaN;
}

function nomPris(liste, nom, idExclu) {
  const cible = nom.toLocaleLowerCase('fr');
  return liste.some(x => x.id !== idExclu && String(x.nom).toLocaleLowerCase('fr') === cible);
}

/** Valide et normalise un sort. Renvoie { sort } ou { message }. */
function validerSort(ref, donnees, idExclu) {
  const nom = texte(donnees.nom, 120);
  if (!nom) return { message: 'Le nom du sort est obligatoire.' };
  if (nomPris(ref.sorts, nom, idExclu)) return { message: `Un sort « ${nom} » existe déjà.` };

  const ecole = texte(donnees.ecole, 40);
  if (!(ref.ecoles || []).some(e => e.id === ecole)) return { message: 'École inconnue.' };

  const description = texte(donnees.description, 4000);
  if (!description) return { message: 'La description est obligatoire.' };

  const typeAction = texte(donnees.type_action, 120);
  if (!typeAction) return { message: "Le type d'action est obligatoire." };

  const sort = {
    nom,
    ecole,
    niveau: null,
    duree: texteOuNull(donnees.duree, 120),
    type_action: typeAction,
    element: texteOuNull(donnees.element, 40)?.toUpperCase() || null,
    description,
    degats: texteOuNull(donnees.degats, 200)
  };

  if (ecole === 'imposition') {
    const cout = entierOuNull(donnees.cout_charges);
    if (cout === null || Number.isNaN(cout)) return { message: 'Le coût en charges est obligatoire (entier).' };
    sort.cout_charges = cout;
  } else {
    const niveau = entierOuNull(donnees.niveau);
    if (niveau === null || Number.isNaN(niveau)) {
      return { message: `Le niveau est obligatoire (entier de 0 à ${MAX_NIVEAU}).` };
    }
    sort.niveau = niveau;
  }
  return { sort };
}

/** Valide et normalise une attaque spéciale. Le niveau peut rester vide. */
function validerAttaque(ref, donnees, idExclu) {
  const nom = texte(donnees.nom, 120);
  if (!nom) return { message: "Le nom de l'attaque est obligatoire." };
  if (nomPris(ref.attaques_speciales.liste, nom, idExclu)) {
    return { message: `Une attaque « ${nom} » existe déjà.` };
  }

  const description = texte(donnees.description, 4000);
  if (!description) return { message: 'La description est obligatoire.' };

  const niveau = entierOuNull(donnees.niveau);
  if (Number.isNaN(niveau)) return { message: `Niveau invalide (entier de 0 à ${MAX_NIVEAU}, ou vide).` };

  return {
    attaque: {
      nom,
      armes: texteOuNull(donnees.armes, 200),
      niveau,
      affinite_magique: donnees.affinite_magique === true,
      description,
      degats: texteOuNull(donnees.degats, 200)
    }
  };
}

function enregistrer(ref, resultat) {
  return ecrireReference(ref)
    ? { success: true, ...resultat }
    : { success: false, message: "Impossible d'enregistrer sorts.json." };
}

function creerSort(donnees = {}) {
  const ref = lireReference();
  const { sort, message } = validerSort(ref, donnees);
  if (!sort) return { success: false, message };
  const complet = { id: idUnique(ref, `${sort.ecole}-${slug(sort.nom)}`), ...sort };
  ref.sorts.push(complet);
  return enregistrer(ref, { sort: complet });
}

function modifierSort(id, donnees = {}) {
  const ref = lireReference();
  const index = ref.sorts.findIndex(s => s.id === id);
  if (index === -1) return { success: false, introuvable: true, message: 'Sort introuvable.' };
  const { sort, message } = validerSort(ref, { ...ref.sorts[index], ...donnees }, id);
  if (!sort) return { success: false, message };
  ref.sorts[index] = { id, ...sort };
  return enregistrer(ref, { sort: ref.sorts[index] });
}

function supprimerSort(id) {
  const ref = lireReference();
  const index = ref.sorts.findIndex(s => s.id === id);
  if (index === -1) return { success: false, introuvable: true, message: 'Sort introuvable.' };
  const [retire] = ref.sorts.splice(index, 1);
  return enregistrer(ref, { sort: retire });
}

/** Copie indépendante, placée juste après l'original, nom suffixé « (copie) ». */
function dupliquerSort(id) {
  const ref = lireReference();
  const index = ref.sorts.findIndex(s => s.id === id);
  if (index === -1) return { success: false, introuvable: true, message: 'Sort introuvable.' };
  const source = ref.sorts[index];
  let nom = `${source.nom} (copie)`, n = 2;
  while (nomPris(ref.sorts, nom)) nom = `${source.nom} (copie ${n++})`;
  const copie = { ...JSON.parse(JSON.stringify(source)), nom };
  copie.id = idUnique(ref, `${copie.ecole}-${slug(nom)}`);
  ref.sorts.splice(index + 1, 0, copie);
  return enregistrer(ref, { sort: copie });
}

function creerAttaque(donnees = {}) {
  const ref = lireReference();
  const { attaque, message } = validerAttaque(ref, donnees);
  if (!attaque) return { success: false, message };
  const complete = { id: idUnique(ref, `attaque-${slug(attaque.nom)}`), ...attaque };
  ref.attaques_speciales.liste.push(complete);
  return enregistrer(ref, { attaque: complete });
}

function modifierAttaque(id, donnees = {}) {
  const ref = lireReference();
  const liste = ref.attaques_speciales.liste;
  const index = liste.findIndex(a => a.id === id);
  if (index === -1) return { success: false, introuvable: true, message: 'Attaque introuvable.' };
  const { attaque, message } = validerAttaque(ref, { ...liste[index], ...donnees }, id);
  if (!attaque) return { success: false, message };
  liste[index] = { id, ...attaque };
  return enregistrer(ref, { attaque: liste[index] });
}

function supprimerAttaque(id) {
  const ref = lireReference();
  const liste = ref.attaques_speciales.liste;
  const index = liste.findIndex(a => a.id === id);
  if (index === -1) return { success: false, introuvable: true, message: 'Attaque introuvable.' };
  const [retiree] = liste.splice(index, 1);
  return enregistrer(ref, { attaque: retiree });
}

function dupliquerAttaque(id) {
  const ref = lireReference();
  const liste = ref.attaques_speciales.liste;
  const index = liste.findIndex(a => a.id === id);
  if (index === -1) return { success: false, introuvable: true, message: 'Attaque introuvable.' };
  const source = liste[index];
  let nom = `${source.nom} (copie)`, n = 2;
  while (nomPris(liste, nom)) nom = `${source.nom} (copie ${n++})`;
  const copie = { ...JSON.parse(JSON.stringify(source)), nom };
  copie.id = idUnique(ref, `attaque-${slug(nom)}`);
  liste.splice(index + 1, 0, copie);
  return enregistrer(ref, { attaque: copie });
}

module.exports = {
  fichierSorts,
  listesSortsReference,
  lireReference,
  creerSort,
  modifierSort,
  supprimerSort,
  dupliquerSort,
  creerAttaque,
  modifierAttaque,
  supprimerAttaque,
  dupliquerAttaque
};
