function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---------------------------------------------------------------------------
// Listes du personnage (sorts, sorts mineurs, attaques, compétences) :
// une ligne de champs par entrée, au lieu d'un JSON à éditer à la main.
// Chaque ligne garde l'objet d'origine (data-origine) : les champs qui ne
// sont pas affichés sont conservés tels quels à l'enregistrement.
// ---------------------------------------------------------------------------
const LISTES_PERSO = [
  { champ: 'spells', titre: 'Sorts majeurs', ref: 'sorts_majeurs', colonnes: ['nom', 'degats', 'niveau'] },
  { champ: 'sorts_mineurs', titre: 'Sorts mineurs', ref: 'sorts_mineurs', colonnes: ['nom', 'degats'] },
  { champ: 'attaques_speciales', titre: 'Attaques spéciales', ref: 'attack_special', colonnes: ['nom', 'degats', 'niveau'] },
  { champ: 'competences', titre: 'Compétences', ref: null, colonnes: ['nom', 'effet', 'niveau', 'type'] }
];
const LIBELLES_COLONNES = { nom: 'Nom', degats: 'Dégâts', niveau: 'Niveau', effet: 'Effet', type: 'Type' };
const TYPES_COMPETENCE = [['classe', 'Classe'], ['racial', 'Raciale'], ['autre', 'Autre']];

function ligneListe(liste, entree = {}) {
  const champs = liste.colonnes.map(colonne => {
    const valeur = entree[colonne] ?? '';
    if (colonne === 'type') {
      const types = TYPES_COMPETENCE.some(([v]) => v === valeur) ? TYPES_COMPETENCE : [...TYPES_COMPETENCE, [valeur, valeur]];
      return `<select data-col="type" aria-label="Type">${types.map(([v, l]) =>
        `<option value="${escapeHtml(v)}" ${v === (valeur || 'classe') ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>`;
    }
    const attributs = colonne === 'niveau' ? 'type="number" min="0"' : 'type="text"';
    const liste_ = colonne === 'nom' && liste.ref ? ` list="mj-ref-${liste.champ}"` : '';
    return `<input ${attributs} data-col="${colonne}"${liste_} value="${escapeHtml(valeur)}" aria-label="${LIBELLES_COLONNES[colonne]}">`;
  }).join('');
  return `<div class="mj-liste-ligne mj-liste-${liste.colonnes.length}" data-origine="${escapeHtml(JSON.stringify(entree))}">
      ${champs}<button type="button" class="mj-liste-retirer" title="Retirer">✖</button></div>`;
}

function sectionListe(liste, entrees) {
  const enTetes = liste.colonnes.map(c => `<span>${LIBELLES_COLONNES[c]}</span>`).join('');
  return `
    <div class="mj-liste" data-liste="${liste.champ}">
      <h4>${escapeHtml(liste.titre)}</h4>
      <div class="mj-liste-ligne mj-liste-entetes mj-liste-${liste.colonnes.length}">${enTetes}<span></span></div>
      <div class="mj-liste-corps">${(Array.isArray(entrees) ? entrees : []).map(e => ligneListe(liste, e)).join('')}</div>
      <button type="button" class="mj-liste-ajouter">+ Ajouter</button>
      ${liste.ref ? `<datalist id="mj-ref-${liste.champ}"></datalist>` : ''}
    </div>`;
}

/** Lignes → tableau d'objets, en conservant les champs non affichés. */
function collecterListe(form, liste) {
  return [...form.querySelectorAll(`[data-liste="${liste.champ}"] .mj-liste-corps .mj-liste-ligne`)]
    .map(ligne => {
      let origine = {};
      try { origine = JSON.parse(ligne.dataset.origine || '{}'); } catch { origine = {}; }
      const entree = { ...origine };
      ligne.querySelectorAll('[data-col]').forEach(champ => {
        const valeur = champ.value.trim();
        if (champ.dataset.col === 'niveau') {
          if (valeur === '') delete entree.niveau; else entree.niveau = Number(valeur);
        } else {
          entree[champ.dataset.col] = valeur;
        }
      });
      return entree;
    })
    .filter(entree => entree.nom);
}

/** Type d'une entrée de référence : son école, ou classique / magique pour une attaque. */
function typeEntree(entree) {
  if (entree.ecole_nom) return entree.ecole_nom;
  return entree.affinite_magique ? '✨ Affinité magique' : 'Attaques classiques';
}

/**
 * Ajout / retrait de lignes, et suggestions issues de la référence : choisir
 * un sort connu remplit ses dégâts et son niveau s'ils sont encore vides.
 */
async function preparerListes(form) {
  form.querySelectorAll('.mj-liste').forEach(bloc => {
    const liste = LISTES_PERSO.find(l => l.champ === bloc.dataset.liste);
    bloc.querySelector('.mj-liste-ajouter').addEventListener('click', () => {
      bloc.querySelector('.mj-liste-corps').insertAdjacentHTML('beforeend', ligneListe(liste));
      bloc.querySelector('.mj-liste-corps .mj-liste-ligne:last-child [data-col="nom"]')?.focus();
    });
    bloc.addEventListener('click', event => {
      if (event.target.closest('.mj-liste-retirer')) event.target.closest('.mj-liste-ligne')?.remove();
    });
  });

  let reference;
  try { reference = await (await fetch('/api/game-database')).json(); } catch { return; }

  LISTES_PERSO.filter(l => l.ref).forEach(liste => {
    const entrees = Array.isArray(reference[liste.ref]) ? reference[liste.ref] : [];
    const datalist = form.querySelector(`#mj-ref-${liste.champ}`);
    const bloc = form.querySelector(`[data-liste="${liste.champ}"]`);

    // Suggestions : le NOM du sort en premier (le navigateur affiche le
    // libellé), suivi de son type ; restreintes par le filtre « Type ».
    const remplir = type => {
      if (!datalist) return;
      datalist.innerHTML = entrees
        .filter(e => !type || typeEntree(e) === type)
        .map(e => `<option value="${escapeHtml(e.nom)}" label="${escapeHtml(`${e.affinite_magique ? '✨ ' : ''}${e.nom} — ${typeEntree(e)}`)}"></option>`)
        .join('');
    };
    const types = [...new Set(entrees.map(typeEntree))];
    if (bloc && types.length > 1) {
      bloc.querySelector('h4').insertAdjacentHTML('beforeend', `
        <select class="mj-liste-filtre" aria-label="Filtrer par type">
          <option value="">Tous les types</option>
          ${types.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}
        </select>`);
      bloc.querySelector('.mj-liste-filtre').addEventListener('change', event => remplir(event.target.value));
    }
    remplir('');
    form.querySelector(`[data-liste="${liste.champ}"]`)?.addEventListener('change', event => {
      const champ = event.target;
      if (champ.dataset.col !== 'nom') return;
      const connu = entrees.find(e => e.nom === champ.value.trim());
      if (!connu) return;
      const ligne = champ.closest('.mj-liste-ligne');
      const degats = ligne.querySelector('[data-col="degats"]');
      const niveau = ligne.querySelector('[data-col="niveau"]');
      if (degats && !degats.value) degats.value = connu.degats || '';
      if (niveau && !niveau.value && connu.niveau !== '' && connu.niveau != null) niveau.value = connu.niveau;
    });
  });
}

/** Valeurs actuelles bornées à leur maximum pendant la saisie. */
function bornerRessourcesFormulaire(form) {
  const paires = [['hp_current', 'hp_max'], ['mana_current', 'mana_max'],
    ['dura_current', 'dura_max'], ['protection_current', 'protection_max']];
  const borner = () => paires.forEach(([actuel, max]) => {
    const champActuel = form.elements[actuel];
    const champMax = form.elements[max];
    if (!champActuel || !champMax || champMax.value === '') return;
    const maximum = Math.max(0, Number(champMax.value) || 0);
    champActuel.max = maximum;
    if (champActuel.value !== '' && Number(champActuel.value) > maximum) champActuel.value = maximum;
  });
  form.addEventListener('input', event => {
    if (paires.flat().includes(event.target.name)) borner();
  });
  borner();
}

function numberValue(form, name, fallback = 0) {
  const value = Number(form.elements[name]?.value);
  return Number.isFinite(value) ? value : fallback;
}

function textValue(form, name, fallback = '') {
  return form.elements[name]?.value ?? fallback;
}


const INVENTORY_TYPES = ['Objet', 'Arme', 'Armure', 'Potion', 'Accessoire', 'Quête', 'Autre'];

function inventoryItemId() {
  return window.crypto?.randomUUID ? window.crypto.randomUUID() :
    `item_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function inventoryRow(item = {}) {
  const type = INVENTORY_TYPES.includes(item.type) ? item.type : 'Objet';
  const quantity = Math.max(1, Number(item.quantite) || 1);
  return `
    <tr data-inventory-id="${escapeHtml(item.id || inventoryItemId())}">
      <td><input type="text" class="mj-inventory-name" value="${escapeHtml(item.nom || '')}" placeholder="Nom de l'objet"></td>
      <td><select class="mj-inventory-type">
        ${INVENTORY_TYPES.map(t => `<option value="${escapeHtml(t)}" ${t === type ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
      </select></td>
      <td><input type="number" class="mj-inventory-quantity" min="1" step="1" value="${quantity}"></td>
      <td><input type="text" class="mj-inventory-slot" value="${escapeHtml(item.emplacement || '')}" placeholder="Ex. Main droite"></td>
      <td class="mj-inventory-equipped-cell"><input type="checkbox" class="mj-inventory-equipped" ${item.equipe ? 'checked' : ''}></td>
      <td><textarea class="mj-inventory-description" placeholder="Description">${escapeHtml(item.description || '')}</textarea></td>
      <td><button type="button" class="mj-inventory-remove">Supprimer</button></td>
    </tr>`;
}

function renderMJInventoryEditor(items = []) {
  const body = document.querySelector('#mj-inventory-body');
  if (!body) return;
  body.innerHTML = '';
  (Array.isArray(items) ? items : []).forEach(item => body.insertAdjacentHTML('beforeend', inventoryRow(item)));
}

function collectMJInventory(form) {
  const body = form.querySelector('#mj-inventory-body');
  if (!body) return [];
  return [...body.querySelectorAll('tr')].map(row => ({
    id: row.dataset.inventoryId || inventoryItemId(),
    nom: row.querySelector('.mj-inventory-name')?.value.trim() || '',
    type: row.querySelector('.mj-inventory-type')?.value || 'Objet',
    quantite: Math.max(1, Number(row.querySelector('.mj-inventory-quantity')?.value) || 1),
    emplacement: row.querySelector('.mj-inventory-slot')?.value.trim() || '',
    equipe: Boolean(row.querySelector('.mj-inventory-equipped')?.checked),
    description: row.querySelector('.mj-inventory-description')?.value || ''
  })).filter(item => item.nom);
}

function setupMJInventoryEditor(form, items = []) {
  renderMJInventoryEditor(items);
  form.querySelector('#mj-add-inventory-item')?.addEventListener('click', () => {
    const body = form.querySelector('#mj-inventory-body');
    if (!body) return;
    body.insertAdjacentHTML('beforeend', inventoryRow({id:inventoryItemId(), type:'Objet', quantite:1}));
    body.querySelector('tr:last-child .mj-inventory-name')?.focus();
  });
  form.querySelector('#mj-inventory-body')?.addEventListener('click', event => {
    const button = event.target.closest('.mj-inventory-remove');
    if (button) button.closest('tr')?.remove();
  });
}

function buildEditForm(joueur) {
  const stats = joueur.stats || {};
  const hp = joueur.hp || {};
  const mana = joueur.mana || {};
  const armure = joueur.armure || {};
  const dura = armure.durabilite || {};
  const protection = armure.protection || {};
  const armes = Array.isArray(joueur.armes) ? joueur.armes : [];

  // Cinq emplacements d'armes, en lignes compactes (type | dégâts).
  const weaponFields = `
    <div class="mj-liste-ligne mj-liste-armes mj-liste-entetes"><span>Type</span><span>Dégâts</span></div>
    ${Array.from({ length: 5 }, (_, index) => {
      const arme = armes[index] || {};
      return `
      <div class="mj-liste-ligne mj-liste-armes">
        <input name="weapon_type_${index + 1}" value="${escapeHtml(arme.type || '')}" aria-label="Arme ${index + 1} — type">
        <input name="weapon_dmg_${index + 1}" value="${escapeHtml(arme.degats || '')}" aria-label="Arme ${index + 1} — dégâts">
      </div>`;
    }).join('')}`;

  return `
    <form id="mj-player-edit-form" class="mj-player-edit-form">
      <input type="hidden" name="id" value="${escapeHtml(joueur.id)}">

      <section class="mj-edit-section">
        <h3>Identité</h3>
        <div class="mj-edit-grid">
          <label>Nom<input name="nom" value="${escapeHtml(joueur.nom || '')}" required></label>
          <label>Classe<input name="classe" value="${escapeHtml(joueur.classe || '')}"></label>
          <label>Race<input name="race" value="${escapeHtml(joueur.race || '')}"></label>
          <label>Niveau<input name="niveau" type="number" min="1" value="${Number(joueur.niveau ?? 1)}"></label>
        </div>
      </section>

      <section class="mj-edit-section">
        <h3>Statistiques</h3>
        <div class="mj-edit-grid mj-edit-stats">
          <label>Force<input name="force" type="number" value="${Number(stats.force ?? 0)}"></label>
          <label>Dextérité<input name="dexterite" type="number" value="${Number(stats.dexterite ?? 0)}"></label>
          <label>Magie<input name="magie" type="number" value="${Number(stats.magie ?? 0)}"></label>
          <label>Constitution<input name="constitution" type="number" value="${Number(stats.constitution ?? 0)}"></label>
          <label>Charisme<input name="charisme" type="number" value="${Number(stats.charisme ?? 0)}"></label>
          <label>Perception<input name="perception" type="number" value="${Number(stats.perception ?? 0)}"></label>
          <label>Chance<input name="chance" type="number" value="${Number(stats.chance ?? 0)}"></label>
          <label>Intelligence<input name="intelligence" type="number" value="${Number(stats.intelligence ?? 0)}"></label>
        </div>
      </section>

      <section class="mj-edit-section">
        <h3>Ressources</h3>
        <div class="mj-edit-grid">
          <label>HP actuels<input name="hp_current" type="number" min="0" value="${Number(hp.current ?? 0)}"></label>
          <label>HP maximum<input name="hp_max" type="number" min="0" value="${Number(hp.max ?? 0)}"></label>
          <label>Mana actuel<input name="mana_current" type="number" min="0" value="${Number(mana.current ?? 0)}"></label>
          <label>Mana maximum<input name="mana_max" type="number" min="0" value="${Number(mana.max ?? 0)}"></label>
          <label>Vie bonus<input name="bonus_vie" type="number" min="0" value="${Number(joueur.bonus_vie ?? 0)}"></label>
          <label>Intoxication<input name="intox" type="number" min="0"${Number(stats.constitution) > 0 ? ` max="${Number(stats.constitution)}"` : ''} value="${Number(joueur.intox ?? 0)}"></label>
        </div>
      </section>

      <section class="mj-edit-section">
        <h3>Armure</h3>
        <div class="mj-edit-grid">
          <label>Type d'armure<input name="armor_type" value="${escapeHtml(armure.type || '')}"></label>
          <label>Résistance<input name="armor_resistance" value="${escapeHtml(armure.resistance || '')}"></label>
          <label>Durabilité actuelle<input name="dura_current" type="number" min="0" value="${Number(dura.current ?? 0)}"></label>
          <label>Durabilité maximum<input name="dura_max" type="number" min="0" value="${Number(dura.max ?? 0)}"></label>
          <label>Protection actuelle<input name="protection_current" type="number" min="0" value="${Number(protection.current ?? 0)}"></label>
          <label>Protection maximum<input name="protection_max" type="number" min="0" value="${Number(protection.max ?? 0)}"></label>
        </div>
      </section>

      <section class="mj-edit-section">
        <h3>Inventaire & équipement</h3>
        <p class="mj-edit-help">Gérez les objets directement ici. Le JSON reste interne à l'application.</p>
        <div class="mj-inventory-toolbar">
          <button type="button" id="mj-add-inventory-item" class="mj-inventory-add">+ Ajouter un objet</button>
        </div>
        <div class="mj-inventory-table-wrapper">
          <table class="mj-inventory-table">
            <thead><tr>
              <th>Nom</th><th>Type</th><th>Qté</th><th>Emplacement</th><th>Équipé</th><th>Description</th><th>Action</th>
            </tr></thead>
            <tbody id="mj-inventory-body"></tbody>
          </table>
        </div>
        <div class="mj-edit-grid mj-inventory-legacy-fields">
          <label>Sac<textarea name="sac">${escapeHtml(joueur.sac || '')}</textarea></label>
          <label>Ceinture / Dos<textarea name="ceinture">${escapeHtml(joueur.ceinture || '')}</textarea></label>
        </div>
      </section>

      <section class="mj-edit-section">
        <h3>Armes</h3>
        ${weaponFields}
      </section>

      <section class="mj-edit-section">
        <h3>Sorts et compétences</h3>
        <p class="mj-edit-help">Les noms de la référence sont proposés à la saisie ; un sort connu remplit ses dégâts et son niveau.</p>
        <div class="mj-listes">
          ${LISTES_PERSO.map(liste => sectionListe(liste, joueur[liste.champ])).join('')}
        </div>
      </section>

      <section class="mj-edit-section">
        <h3>Informations et notes du personnage</h3>
        <label>Compétences spéciales<textarea name="skills_speciales">${escapeHtml(joueur.skills_speciales || '')}</textarea></label>
        <label>Biographie<textarea name="bio">${escapeHtml(joueur.bio || '')}</textarea></label>
        <label>Choix de level up / effets permanents<textarea name="levelup">${escapeHtml(joueur.levelup || '')}</textarea></label>
      </section>

      <div class="mj-edit-actions">
        <button type="button" class="mj-cancel-btn">Annuler</button>
        <button type="submit" class="mj-save-btn">Enregistrer les modifications</button>
      </div>
      <p class="mj-edit-message" aria-live="polite"></p>
    </form>`;
}

function collectEditData(form) {
  const weapons = [];
  for (let index = 1; index <= 5; index += 1) {
    const type = textValue(form, `weapon_type_${index}`);
    const degats = textValue(form, `weapon_dmg_${index}`);
    if (type || degats) weapons.push({ type, degats });
  }

  return {
    nom: textValue(form, 'nom').trim(),
    classe: textValue(form, 'classe').trim(),
    race: textValue(form, 'race').trim(),
    niveau: Math.max(1, numberValue(form, 'niveau', 1)),
    stats: {
      force: numberValue(form, 'force'),
      dexterite: numberValue(form, 'dexterite'),
      magie: numberValue(form, 'magie'),
      constitution: numberValue(form, 'constitution'),
      charisme: numberValue(form, 'charisme'),
      perception: numberValue(form, 'perception'),
      chance: numberValue(form, 'chance'),
      intelligence: numberValue(form, 'intelligence')
    },
    hp: {
      current: Math.max(0, numberValue(form, 'hp_current')),
      max: Math.max(0, numberValue(form, 'hp_max'))
    },
    mana: {
      current: Math.max(0, numberValue(form, 'mana_current')),
      max: Math.max(0, numberValue(form, 'mana_max'))
    },
    bonus_vie: Math.max(0, numberValue(form, 'bonus_vie')),
    intox: Math.max(0, numberValue(form, 'intox')),
    armure: {
      type: textValue(form, 'armor_type'),
      resistance: textValue(form, 'armor_resistance'),
      durabilite: {
        current: Math.max(0, numberValue(form, 'dura_current')),
        max: Math.max(0, numberValue(form, 'dura_max'))
      },
      protection: {
        current: Math.max(0, numberValue(form, 'protection_current')),
        max: Math.max(0, numberValue(form, 'protection_max'))
      }
    },
    sac: textValue(form, 'sac'),
    ceinture: textValue(form, 'ceinture'),
    inventaire: collectMJInventory(form),
    armes: weapons,
    ...Object.fromEntries(LISTES_PERSO.map(liste => [liste.champ, collecterListe(form, liste)])),
    skills_speciales: textValue(form, 'skills_speciales'),
    bio: textValue(form, 'bio'),
    levelup: textValue(form, 'levelup')
  };
}

export function showMJPopup(joueur) {
  const existingModal = document.querySelector('.modal-overlay');
  if (existingModal) existingModal.remove();

  const overlay = document.createElement('div');
  overlay.classList.add('modal-overlay');

  overlay.innerHTML = `
    <div class="modal modal-mj-player">
      <span class="close-btn" aria-label="Fermer">&times;</span>
      <h2>${escapeHtml(joueur.nom)}</h2>
      <div class="mj-player-summary">
        <p><strong>HP :</strong> ${joueur.hp?.current ?? 0} / ${joueur.hp?.max ?? 0}</p>
        <p><strong>Mana :</strong> ${joueur.mana?.current ?? 0} / ${joueur.mana?.max ?? 0}</p>
        <p><strong>Protection :</strong> ${joueur.armure?.protection?.current ?? 0} / ${joueur.armure?.protection?.max ?? 0}</p>
      </div>
      <div class="mj-popup-actions">
        <button class="edit-player-btn">Modifier le joueur</button>
        <button class="fiche-btn">Voir Fiche Complète</button>
      </div>
    </div>
  `;

  const close = () => overlay.remove();
  overlay.querySelector('.close-btn').addEventListener('click', close);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  });

  overlay.querySelector('.fiche-btn').addEventListener('click', () => {
    // La fiche se charge depuis le serveur : seul l'identifiant est transmis.
    const params = new URLSearchParams();
    if (joueur.id) params.set('PlayerId', joueur.id);
    else params.set('Nom', joueur.nom || '');
    window.open(`fiche_perso.html?${params.toString()}`, '_blank');
  });

  overlay.querySelector('.edit-player-btn').addEventListener('click', () => {
    overlay.querySelector('.modal').innerHTML = `
      <span class="close-btn" aria-label="Fermer">&times;</span>
      <h2>Modifier ${escapeHtml(joueur.nom)}</h2>
      ${buildEditForm(joueur)}`;

    overlay.querySelector('.close-btn').addEventListener('click', close);
    const form = overlay.querySelector('#mj-player-edit-form');
    setupMJInventoryEditor(form, joueur.inventaire || []);
    preparerListes(form);
    bornerRessourcesFormulaire(form);
    form.querySelector('.mj-cancel-btn').addEventListener('click', () => showMJPopup(joueur));

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const message = form.querySelector('.mj-edit-message');
      const submit = form.querySelector('.mj-save-btn');
      submit.disabled = true;
      message.textContent = '';

      try {
        const nouvellesDonnees = collectEditData(form);
        if (!nouvellesDonnees.nom) throw new Error('Le nom du joueur est obligatoire.');
        if (nouvellesDonnees.hp.current > nouvellesDonnees.hp.max) {
          throw new Error('Les HP actuels ne peuvent pas dépasser les HP maximum.');
        }
        if (nouvellesDonnees.mana.current > nouvellesDonnees.mana.max) {
          throw new Error('Le Mana actuel ne peut pas dépasser le Mana maximum.');
        }
        // Règle : Intox : x / Constitution (une Constitution de 0 ne borne pas).
        if (nouvellesDonnees.stats.constitution > 0 && nouvellesDonnees.intox > nouvellesDonnees.stats.constitution) {
          throw new Error("L'intoxication ne peut pas dépasser la Constitution.");
        }

        const response = await fetch('/api/session/player', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: joueur.id, nouvellesDonnees })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || `Erreur HTTP ${response.status}`);

        joueur = { ...joueur, ...result.session };
        message.textContent = 'Modifications enregistrées dans la partie.';
        message.classList.add('success');

        setTimeout(() => {
          close();
        }, 700);
      } catch (error) {
        console.error('Erreur modification joueur MJ:', error);
        message.textContent = error.message || 'Impossible de sauvegarder les modifications.';
        message.classList.add('error');
        submit.disabled = false;
      }
    });
  });

  document.body.appendChild(overlay);
}
