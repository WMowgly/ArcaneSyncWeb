// serveur/routes-mobs.js
// ---------------------------------------------------------------------------
// Créatures : statuts, mobs en jeu, modèles et bestiaire.
//
// Routes déplacées telles quelles depuis server.js (V1.16). Le routeur est
// nommé `app` pour que chaque route garde exactement son écriture d'origine.
// ---------------------------------------------------------------------------
const express = require('express');
const {
  getSessionMobs,
  getSessionMobById,
  sauvegarderMobSession,
  supprimerMobSession,
  getStatutsJoueurDisponibles,
  ajouterStatutMob,
  retirerStatutMob
} = require('../session');
const {
  getMobTemplates,
  createMobTemplate,
  updateMobTemplate,
  deleteMobTemplate,
  createMobFromTemplate,
  normaliserMob,
  getCategoriesMob,
  duplicateMobTemplate,
  duplicateMob,
  templateDepuisMob
} = require('../mob');
const { refuserSiPasMj } = require('./acces');
const { emitMapState } = require('./diffusion-carte');

const app = express.Router();
let io = null;

// STATUTS — catalogue partagé (appliqués aux créatures par le MJ ; pour
// les personnages, seule l'agonie subsiste, automatique à 0 PV).
// ------------------------------------------------------------------
app.get('/api/statuses',(req,res)=>res.json(getStatutsJoueurDisponibles()));

// ------------------------------------------------------------------
// MOBS / NPC — gestion uniquement par le MJ.
// Aucun moteur de combat n'est exécuté par ArcaneSync.
// ------------------------------------------------------------------
// ------------------------------------------------------------------
// V1.13.8 — Statuts des créatures.
//
// Calquées sur les routes de statuts joueur ci-dessus, et partageant le
// MÊME catalogue (STATUTS_JOUEUR) : Poison ou Paralysie s'appliquent
// aussi bien à un gobelin qu'à un personnage.
// ------------------------------------------------------------------
app.post('/api/mobs/:id/statuses', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  const result = ajouterStatutMob(req.params.id, req.body?.statutId);
  if (!result.success) return res.status(400).json({ message: result.message });

  io.emit('mobUpdated', { type: 'statusUpdate', mob: result.mob });
  emitMapState();
  res.json({ message: 'Statut appliqué.', mobId: req.params.id, statuts: result.mob.statuts });
});

app.delete('/api/mobs/:id/statuses/:statutId', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  const result = retirerStatutMob(req.params.id, req.params.statutId);
  if (!result.success) return res.status(400).json({ message: result.message });

  io.emit('mobUpdated', { type: 'statusUpdate', mob: result.mob });
  emitMapState();
  res.json({ message: 'Statut retiré.', mobId: req.params.id, statuts: result.mob.statuts });
});

app.get('/api/mobs', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  res.json(Object.values(getSessionMobs()));
});

app.post('/api/mobs', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  try {
    if (!req.body?.nom || !String(req.body.nom).trim()) {
      return res.status(400).json({ message: 'Le nom du mob est requis.' });
    }
    const mob = normaliserMob(req.body);
    if (!sauvegarderMobSession(mob)) {
      return res.status(500).json({ message: 'Impossible de sauvegarder le mob.' });
    }
    io.emit('mobUpdated', { type: 'created', mob });
    io.emit('sceneUpdated');
    emitMapState();
    res.status(201).json({ message: 'Mob créé avec succès.', mob });
  } catch (error) {
    console.error('Erreur création mob:', error);
    res.status(500).json({ message: 'Impossible de créer le mob.' });
  }
});

app.put('/api/mobs/:id', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  try {
    const current = getSessionMobById(req.params.id);
    if (!current) return res.status(404).json({ message: 'Mob introuvable dans la partie active.' });

    const requested = req.body || {};
    const merged = {
      ...current,
      ...requested,
      id: current.id,
      hp: requested.hp ? { ...current.hp, ...requested.hp } : current.hp,
      mana: requested.mana ? { ...current.mana, ...requested.mana } : current.mana
    };

    const mob = normaliserMob(merged, { id: current.id });
    if (!sauvegarderMobSession(mob)) {
      return res.status(500).json({ message: 'Impossible de modifier le mob.' });
    }
    io.emit('mobUpdated', { type: 'updated', mob });
    io.emit('sceneUpdated');
    emitMapState();
    res.json({ message: 'Mob modifié avec succès.', mob });
  } catch (error) {
    console.error('Erreur modification mob:', error);
    res.status(500).json({ message: 'Impossible de modifier le mob.' });
  }
});

app.delete('/api/mobs/:id', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  try {
    if (!supprimerMobSession(req.params.id)) {
      return res.status(404).json({ message: 'Mob introuvable dans la partie active.' });
    }
    io.emit('mobUpdated', { type: 'deleted', mobId: req.params.id });
    io.emit('sceneUpdated');
    // Le mob a aussi quitté l'ordre d'initiative (session.supprimerMobSession).
    io.emit('initiativeUpdated');
    emitMapState();
    res.json({ message: 'Mob retiré de la partie active.' });
  } catch (error) {
    console.error('Erreur suppression mob:', error);
    res.status(500).json({ message: 'Impossible de supprimer le mob.' });
  }
});

/** Copie indépendante d'un mob de la partie (nouvel id, nom numéroté). */
app.post('/api/mobs/:id/duplicate', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  try {
    const source = getSessionMobById(req.params.id);
    if (!source) return res.status(404).json({ message: 'Mob introuvable dans la partie active.' });

    const mob = duplicateMob(source, getSessionMobs());
    if (!mob || !sauvegarderMobSession(mob)) {
      return res.status(500).json({ message: 'Impossible de dupliquer le mob.' });
    }
    io.emit('mobUpdated', { type: 'duplicated', mob });
    io.emit('sceneUpdated');
    emitMapState();
    res.status(201).json({ message: `« ${mob.nom} » ajouté à la partie.`, mob });
  } catch (error) {
    console.error('Erreur duplication mob:', error);
    res.status(500).json({ message: 'Impossible de dupliquer le mob.' });
  }
});

app.get('/api/mob-templates', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  res.json(getMobTemplates());
});

app.post('/api/mob-templates', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  try {
    if (!req.body?.nom || !String(req.body.nom).trim()) {
      return res.status(400).json({ message: 'Le nom du template est requis.' });
    }
    const template = createMobTemplate(req.body);
    if (!template) return res.status(500).json({ message: 'Impossible de sauvegarder le template.' });

    io.emit('mobTemplateUpdated', { type: 'created', template });
    res.status(201).json({ message: 'Template de mob créé avec succès.', template });
  } catch (error) {
    console.error('Erreur création template:', error);
    res.status(500).json({ message: 'Impossible de créer le template.' });
  }
});

app.put('/api/mob-templates/:id', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  try {
    const template = updateMobTemplate(req.params.id, req.body || {});
    if (!template) return res.status(404).json({ message: 'Template de mob introuvable.' });

    io.emit('mobTemplateUpdated', { type: 'updated', template });
    res.json({ message: 'Template de mob modifié avec succès.', template });
  } catch (error) {
    console.error('Erreur modification template:', error);
    res.status(500).json({ message: 'Impossible de modifier le template.' });
  }
});

app.delete('/api/mob-templates/:id', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  try {
    if (!deleteMobTemplate(req.params.id)) {
      return res.status(404).json({ message: 'Template de mob introuvable.' });
    }
    io.emit('mobTemplateUpdated', { type: 'deleted', templateId: req.params.id });
    res.json({ message: 'Template supprimé.' });
  } catch (error) {
    console.error('Erreur suppression template:', error);
    res.status(500).json({ message: 'Impossible de supprimer le template.' });
  }
});

// ------------------------------------------------------------------
// V1.13.6 — BESTIAIRE : bibliotheque de creatures du MJ
//
// Trois niveaux, deja portes par le modele depuis V1.13.5 :
//   MODELE    mob_templates.json  definition reutilisable
//   INSTANCE  session.mobs        etat propre a la partie
//   TOKEN     maps.json           position sur une carte
//
// Ces routes n'ajoutent aucune donnee : elles exposent les transitions
// entre ces trois niveaux.
// ------------------------------------------------------------------

app.get('/api/mob-categories', (req, res) => {
  res.json(getCategoriesMob());
});

/** Gobelin -> Gobelin Archer, sans toucher a l'original. */
app.post('/api/mob-templates/:id/duplicate', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const template = duplicateMobTemplate(req.params.id, req.body?.nom);
  if (!template) return res.status(404).json({ message: 'Modele de creature introuvable.' });

  io.emit('mobTemplateUpdated', { type: 'duplicated', template });
  res.status(201).json({ message: `« ${template.nom} » ajoute au bestiaire.`, template });
});

/** Promeut une creature de la partie en modele reutilisable. */
app.post('/api/mob-templates/from-mob/:mobId', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const mob = getSessionMobById(req.params.mobId);
  if (!mob) return res.status(404).json({ message: 'Creature introuvable dans la partie.' });

  const template = templateDepuisMob(mob, req.body?.nom);
  if (!template) return res.status(500).json({ message: 'Impossible de creer le modele.' });

  io.emit('mobTemplateUpdated', { type: 'created', template });
  res.status(201).json({ message: `« ${template.nom} » ajoute au bestiaire.`, template });
});

app.post('/api/mob-templates/:id/spawn', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  try {
    // Numérotation automatique : « Gobelin », puis « Gobelin #2 »…
    const mob = createMobFromTemplate(req.params.id, req.body || {}, {
      mobsExistants: getSessionMobs()
    });
    if (!mob) return res.status(404).json({ message: 'Template de mob introuvable.' });

    if (!sauvegarderMobSession(mob)) {
      return res.status(500).json({ message: 'Impossible de créer le mob dans la partie.' });
    }

    io.emit('mobUpdated', { type: 'createdFromTemplate', mob });
    io.emit('sceneUpdated');
    emitMapState();
    res.status(201).json({ message: 'Mob créé depuis le template.', mob });
  } catch (error) {
    console.error('Erreur création mob depuis template:', error);
    res.status(500).json({ message: 'Impossible de créer le mob depuis le template.' });
  }
});

module.exports = instanceIo => {
  io = instanceIo;
  return app;
};
