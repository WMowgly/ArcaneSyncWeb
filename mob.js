// mob.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { creerDepot, cheminDonnees } = require('./storage');

const templatesFile = cheminDonnees('mob_templates.json');
let templates = [];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function generateId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function lireTemplates() {
  if (!fs.existsSync(templatesFile)) {
    templates = [];
    return;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(templatesFile, 'utf8'));
    templates = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Erreur lors de la lecture de mob_templates.json:', error);
    templates = [];
  }
}

// V1.13.5 : écriture atomique factorisée dans storage.js.
const depotTemplates = creerDepot(templatesFile, { etiquette: 'mob_templates.json' });

function ecrireTemplates() {
  return depotTemplates.ecrire(JSON.stringify(templates, null, 2));
}

// ---------------------------------------------------------------------------
// V1.13.5 — Catégories de créature.
//
// Trois champs seulement séparent désormais les trois niveaux du modèle,
// sans rien dupliquer :
//
//   TEMPLATE   mob_templates.json   mobtpl_*   templateId vide
//   INSTANCE   session.mobs         mob_*      templateId -> son modèle
//   TOKEN      map.tokens           mob:<id>   ni stats ni PV, juste la place
//
// `categorie` et `icone` servent à l'affichage d'une bibliothèque de
// créatures ; `templateId` établit la filiation sans copier le modèle.
// ---------------------------------------------------------------------------
const CATEGORIES_MOB = Object.freeze({
  bete:        { id: 'bete',        nom: 'Bête',        icone: '🐺' },
  humanoide:   { id: 'humanoide',   nom: 'Humanoïde',   icone: '🗡️' },
  'mort-vivant': { id: 'mort-vivant', nom: 'Mort-vivant', icone: '💀' },
  elementaire: { id: 'elementaire', nom: 'Élémentaire', icone: '🔥' },
  construct:   { id: 'construct',   nom: 'Construct',   icone: '⚙️' },
  aberration:  { id: 'aberration',  nom: 'Aberration',  icone: '👁️' },
  autre:       { id: 'autre',       nom: 'Autre',       icone: '👹' }
});

function getCategoriesMob() {
  return Object.values(CATEGORIES_MOB).map(c => ({ ...c }));
}

/**
 * Nom d'une nouvelle instance : « Gobelin », puis « Gobelin #2 »…
 *
 * Sans cela, trois gobelins issus du même modèle portaient exactement le
 * même nom et devenaient indiscernables sur la carte comme dans la liste.
 */
function nommerInstance(nomBase, mobsExistants = {}) {
  const base = String(nomBase || 'Créature').trim() || 'Créature';
  const liste = Array.isArray(mobsExistants) ? mobsExistants : Object.values(mobsExistants || {});

  const freres = liste.filter(mob => {
    const nom = String(mob?.nom || '');
    return nom === base || nom.startsWith(`${base} #`);
  });

  return freres.length ? `${base} #${freres.length + 1}` : base;
}

function normaliserMob(input = {}, options = {}) {
  const now = new Date().toISOString();
  const categorie = CATEGORIES_MOB[input.categorie] ? input.categorie : 'autre';

  return {
    id: options.id || input.id || generateId('mob'),
    nom: String(input.nom || 'Nouveau mob'),
    categorie,
    icone: typeof input.icone === 'string' && input.icone
      ? input.icone.slice(0, 8)
      : CATEGORIES_MOB[categorie].icone,
    // Renseigné sur une instance, vide sur un modèle.
    templateId: typeof input.templateId === 'string' ? input.templateId.slice(0, 120) : '',
    description: input.description || '',
    stats: {
      force: input.stats?.force ?? 0,
      dexterite: input.stats?.dexterite ?? 0,
      magie: input.stats?.magie ?? 0,
      constitution: input.stats?.constitution ?? 0,
      charisme: input.stats?.charisme ?? 0,
      perception: input.stats?.perception ?? 0,
      chance: input.stats?.chance ?? 0,
      intelligence: input.stats?.intelligence ?? 0
    },
    hp: {
      max: Math.max(0, Number(input.hp?.max ?? 0)),
      current: Math.max(0, Math.min(Number(input.hp?.current ?? input.hp?.max ?? 0), Number(input.hp?.max ?? 0)))
    },
    mana: {
      max: Math.max(0, Number(input.mana?.max ?? 0)),
      current: Math.max(0, Math.min(Number(input.mana?.current ?? input.mana?.max ?? 0), Number(input.mana?.max ?? 0)))
    },
    statut: (Number(input.hp?.current ?? input.hp?.max ?? 0) <= 0) ? 'mort' : 'vivant',
    // V1.13.8 : conditions (poison, brûlure...). Simple conservation ici,
    // c'est session.js qui valide contre STATUTS_JOUEUR.
    statuts: Array.isArray(input.statuts) ? clone(input.statuts) : [],
    armure: {
      type: input.armure?.type || '',
      resistance: input.armure?.resistance || '',
      durabilite: {
        max: input.armure?.durabilite?.max ?? 0,
        current: input.armure?.durabilite?.current ?? input.armure?.durabilite?.max ?? 0
      },
      protection: {
        max: input.armure?.protection?.max ?? 0,
        current: input.armure?.protection?.current ?? input.armure?.protection?.max ?? 0
      }
    },
    bonus_vie: input.bonus_vie ?? 0,
    intox: input.intox ?? 0,
    armes: Array.isArray(input.armes) ? clone(input.armes) : [],
    spells: Array.isArray(input.spells) ? clone(input.spells) : [],
    competences: Array.isArray(input.competences) ? clone(input.competences) : [],
    notes: input.notes || '',
    createdAt: input.createdAt || now,
    updatedAt: now
  };
}

function getMobTemplates() {
  return clone(templates);
}

function getMobTemplateById(id) {
  return templates.find(t => t.id === id) || null;
}

function createMobTemplate(data) {
  // Un modèle n'a pas de filiation : c'est lui la référence.
  const template = normaliserMob({ ...data, templateId: '' }, { id: generateId('mobtpl') });
  if (!ecrireTemplatesAfter(() => templates.push(template))) return null;
  return clone(template);
}

function ecrireTemplatesAfter(mutator) {
  const before = clone(templates);
  mutator();
  if (!ecrireTemplates()) {
    templates = before;
    return false;
  }
  return true;
}

function updateMobTemplate(id, data) {
  const index = templates.findIndex(t => t.id === id);
  if (index === -1) return null;
  const before = clone(templates);
  templates[index] = normaliserMob({ ...templates[index], ...data }, { id });
  if (!ecrireTemplates()) {
    templates = before;
    return null;
  }
  return clone(templates[index]);
}

/**
 * Duplique un MODELE du bestiaire.
 *
 * C'est l'operation centrale d'une bibliotheque de creatures : partir
 * d'un « Gobelin » pour en tirer un « Gobelin Archer » sans toucher a
 * l'original. Le clone est profond, et le duplicata est lui-meme un
 * modele (templateId vide), pas une instance.
 */
function duplicateMobTemplate(id, nom) {
  const source = getMobTemplateById(id);
  if (!source) return null;

  const copie = clone(source);
  delete copie.id;
  delete copie.createdAt;
  copie.nom = String(nom || `${source.nom} (copie)`).slice(0, 120);

  return createMobTemplate(copie);
}

/**
 * Promeut une creature de la partie en modele reutilisable.
 * Le sens inverse de createMobFromTemplate() : le MJ ajuste un mob en
 * jeu, puis en fait un patron pour les suivants.
 */
function templateDepuisMob(mob, nom) {
  if (!mob || !mob.nom) return null;

  const copie = clone(mob);
  delete copie.id;
  delete copie.createdAt;
  copie.templateId = '';
  copie.nom = String(nom || mob.nom).slice(0, 120);

  return createMobTemplate(copie);
}

function deleteMobTemplate(id) {
  const index = templates.findIndex(t => t.id === id);
  if (index === -1) return false;
  const before = clone(templates);
  templates.splice(index, 1);
  if (!ecrireTemplates()) {
    templates = before;
    return false;
  }
  return true;
}

/**
 * Crée une INSTANCE indépendante à partir d'un modèle.
 *
 * Le clonage en profondeur garantit qu'une modification des PV du
 * « Gobelin #1 » ne touche ni le modèle ni les autres instances.
 * `options.mobsExistants` active la numérotation automatique.
 */
function createMobFromTemplate(templateId, overrides = {}, options = {}) {
  const template = getMobTemplateById(templateId);
  if (!template) return null;

  const nom = overrides.nom
    || nommerInstance(template.nom, options.mobsExistants || {});

  return normaliserMob({
    ...clone(template),
    ...overrides,
    nom,
    // Filiation : l'instance sait de quel modèle elle provient, sans en
    // dupliquer le contenu.
    templateId: template.id,
    stats: { ...template.stats, ...(overrides.stats || {}) },
    hp: { ...template.hp, ...(overrides.hp || {}) },
    mana: { ...template.mana, ...(overrides.mana || {}) },
    armure: {
      ...template.armure,
      ...(overrides.armure || {}),
      durabilite: { ...template.armure?.durabilite, ...(overrides.armure?.durabilite || {}) },
      protection: { ...template.armure?.protection, ...(overrides.armure?.protection || {}) }
    }
  }, { id: generateId('mob') });
}

lireTemplates();

module.exports = {
  CATEGORIES_MOB,
  getCategoriesMob,
  nommerInstance,
  getMobTemplates,
  getMobTemplateById,
  createMobTemplate,
  updateMobTemplate,
  duplicateMobTemplate,
  templateDepuisMob,
  deleteMobTemplate,
  createMobFromTemplate,
  normaliserMob
};
