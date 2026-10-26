/* ---------------------------------------------------------------------------
 * map-core.js — ArcaneSync V1.13
 *
 * Moteur de rendu partagé entre l'outil MJ (map.html) et la vue joueur
 * (map_joueur.html).
 *
 * Ce fichier ne contient AUCUNE logique de droits : il se contente
 * d'afficher la projection reçue du serveur. Les deux interfaces reçoivent
 * des charges utiles de formes différentes (le joueur ne reçoit jamais les
 * champs réservés au MJ) et le rendu s'adapte à ce qui est présent.
 *
 * Aucune dépendance externe : cohérent avec le reste du projet (vanilla JS,
 * pas d'étape de build).
 * ------------------------------------------------------------------------- */

window.ArcaneMap = (function () {
  'use strict';

  // Marge réservée aux règles de coordonnées (en unités logiques).
  const GUTTER = 22;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function cellKey(x, y) {
    return `${x},${y}`;
  }

  /**
   * Contexte utilisateur déduit de l'URL.
   * On accepte `PlayerId` (convention historique du projet) et `playerId`.
   */
  function readContext() {
    const params = new URLSearchParams(location.search);
    const playerId = params.get('PlayerId') || params.get('playerId') || '';
    let role = params.get('role');
    if (role !== 'mj' && role !== 'player') {
      role = playerId ? 'player' : 'player';
    }
    return { role, playerId, params };
  }

  /**
   * Socket configuré comme dans le reste du projet : le rôle et le joueur
   * voyagent dans le handshake, ce qui permet au serveur de choisir la
   * projection à envoyer sans faire confiance au contenu des messages.
   */
  function connect(role, playerId) {
    return io({
      query: { role, playerId: playerId || '' },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity
    });
  }

  // -------------------------------------------------------------------------
  // Renderer
  // -------------------------------------------------------------------------

  function createRenderer(canvas, options) {
    const opts = options || {};
    const ctx = canvas.getContext('2d');

    const state = {
      map: null,
      // Ensembles de cases, recalculés à chaque setMap().
      visible: null,     // null = aucune restriction
      explored: null,
      blocked: new Set(),
      // Options d'affichage pilotées par l'interface.
      showGrid: true,
      showCoords: true,
      showPlayerVision: false,   // aperçu MJ du champ de vision du groupe
      selectedId: null,
      hoverCell: null,
      ghost: null,               // token en cours de déplacement (aperçu local)
      showAnnotations: true,
      previews: new Map(),       // tracés en cours des autres clients
      localStroke: null,         // tracé en cours sur ce poste
      mesure: null,              // outil de mesure, purement local
      aura: { actif: false, cases: 1 },   // portee affichee autour de la selection
      // 1 = la carte est ajustée à l'espace disponible.
      // > 1 = échelle agrandie, le conteneur prend le relais en défilement.
      zoom: 1
    };

    function grid() {
      return state.map?.grid || { cols: 1, rows: 1, cellSize: 48, showGrid: true };
    }

    function logicalWidth() {
      return grid().cols * grid().cellSize + GUTTER;
    }

    function logicalHeight() {
      return grid().rows * grid().cellSize + GUTTER;
    }

    /**
     * Ajuste le canvas à l'espace RÉELLEMENT disponible.
     *
     * V1.13.5 — Correction du grand espace vide.
     * L'implémentation précédente ne tenait compte que de la LARGEUR :
     *     dispo = rect.width - 4 ; hauteur = dispo * ratio
     * Une carte 40x28 dans une colonne large produisait donc un canvas de
     * près de 1000 px de haut. La page débordait du viewport, tandis que
     * les colonnes latérales — dimensionnées par leur contenu — s'arrêtaient
     * bien avant : d'où la large bande vide sur le côté.
     *
     * On ajuste désormais sur les DEUX dimensions, `zoom` permettant au MJ
     * de repasser à l'échelle réelle avec défilement.
     */
    function resize() {
      const rect = canvas.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      if (!state.map) {
        // Sans carte active, le canvas doit tout de même occuper son
        // conteneur : sinon il reste figé sur ses attributs HTML (600x400)
        // et laisse un grand rectangle vide à côté de lui.
        const largeurVide = Math.max(120, rect.width - 4);
        const hauteurVide = Math.max(80, rect.height - 4);

        canvas.style.width = `${Math.round(largeurVide)}px`;
        canvas.style.height = `${Math.round(hauteurVide)}px`;
        canvas.width = Math.round(largeurVide * dpr);
        canvas.height = Math.round(hauteurVide * dpr);

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      const dispoL = Math.max(200, rect.width - 4);
      const dispoH = Math.max(160, rect.height - 4);

      // Échelle d'ajustement : la plus contraignante des deux dimensions.
      const ajustement = Math.min(dispoL / logicalWidth(), dispoH / logicalHeight());
      const echelleCss = ajustement * (state.zoom || 1);

      const largeur = Math.round(logicalWidth() * echelleCss);
      const hauteur = Math.round(logicalHeight() * echelleCss);

      canvas.style.width = `${largeur}px`;
      canvas.style.height = `${hauteur}px`;
      canvas.width = Math.round(largeur * dpr);
      canvas.height = Math.round(hauteur * dpr);

      const echelle = (largeur * dpr) / logicalWidth();
      ctx.setTransform(echelle, 0, 0, echelle, 0, 0);
      render();
    }

    /** Convertit un événement pointeur en case de grille (peut être hors carte). */
    function cellFromEvent(event) {
      const rect = canvas.getBoundingClientRect();
      const g = grid();
      const lx = ((event.clientX - rect.left) / rect.width) * logicalWidth() - GUTTER;
      const ly = ((event.clientY - rect.top) / rect.height) * logicalHeight() - GUTTER;
      return {
        x: Math.floor(lx / g.cellSize),
        y: Math.floor(ly / g.cellSize)
      };
    }

    /**
     * Position fractionnaire en unités de grille (x = 3.5 = milieu de la
     * colonne 3). C'est le référentiel des annotations : contrairement au
     * tableau blanc V1.10 qui travaillait en pixels d'un canvas figé, un
     * tracé reste bien placé si la taille de case change.
     */
    function pointFromEvent(event) {
      const rect = canvas.getBoundingClientRect();
      const g = grid();
      return {
        x: (((event.clientX - rect.left) / rect.width) * logicalWidth() - GUTTER) / g.cellSize,
        y: (((event.clientY - rect.top) / rect.height) * logicalHeight() - GUTTER) / g.cellSize
      };
    }

    function inBounds(cell) {
      const g = grid();
      return cell && cell.x >= 0 && cell.y >= 0 && cell.x < g.cols && cell.y < g.rows;
    }

    function tokenAt(cell) {
      if (!state.map || !inBounds(cell)) return null;
      const tokens = Object.values(state.map.tokens || {});
      // Parcours inverse : le dernier dessiné est le premier attrapé.
      for (let i = tokens.length - 1; i >= 0; i -= 1) {
        const t = tokens[i];
        const taille = t.size || 1;
        if (cell.x >= t.x && cell.x < t.x + taille &&
            cell.y >= t.y && cell.y < t.y + taille) {
          return t;
        }
      }
      return null;
    }

    function elementAt(cell) {
      if (!state.map || !inBounds(cell)) return null;
      const elements = Object.values(state.map.elements || {});
      for (let i = elements.length - 1; i >= 0; i -= 1) {
        const e = elements[i];
        if (cell.x >= e.x && cell.x < e.x + e.w &&
            cell.y >= e.y && cell.y < e.y + e.h) {
          return e;
        }
      }
      return null;
    }

    /**
     * V1.13.11 — Applique une projection, éventuellement ALLÉGÉE.
     *
     * Le serveur retire les champs lourds identiques au dernier envoi et
     * liste leurs noms dans `reprises` : le client les reprend de l'état
     * qu'il détient déjà. Une projection sans `reprises` est complète et
     * s'applique comme avant.
     *
     * Retourne false quand la fusion est IMPOSSIBLE — pas d'état antérieur,
     * ou carte différente. L'appelant doit alors redemander un état complet
     * (`mapRequest`), qui remet le serveur à zéro pour ce socket. Sans ce
     * retour, un client afficherait une carte amputée sans le savoir.
     */
    function setMap(map) {
      if (map && Array.isArray(map.reprises) && map.reprises.length) {
        const ancien = state.map;
        if (!ancien || ancien.id !== map.id) return false;
        map.reprises.forEach(champ => { map[champ] = ancien[champ]; });
        delete map.reprises;
      }

      const memeTaille = state.map &&
        map &&
        state.map.grid.cols === map.grid.cols &&
        state.map.grid.rows === map.grid.rows &&
        state.map.grid.cellSize === map.grid.cellSize;

      state.map = map;

      if (!map) {
        state.visible = null;
        state.explored = null;
        state.blocked = new Set();
        return true;
      }

      // Vue joueur : le serveur transmet les cases autorisées.
      // Vue MJ : `playerVision` est un aperçu, pas une restriction.
      if (map.role === 'player' && map.vision) {
        state.visible = map.vision.visible ? new Set(map.vision.visible) : null;
        state.explored = map.vision.explored ? new Set(map.vision.explored) : null;
      } else {
        state.visible = null;
        state.explored = null;
      }

      state.blocked = new Set();
      Object.values(map.elements || {}).forEach(element => {
        if (!element.blocksMovement) return;
        for (let dx = 0; dx < element.w; dx += 1) {
          for (let dy = 0; dy < element.h; dy += 1) {
            state.blocked.add(cellKey(element.x + dx, element.y + dy));
          }
        }
      });

      if (!memeTaille) resize();
      else render();
      return true;
    }

    // --- Primitives de dessin ---------------------------------------------

    function px(coord) {
      return GUTTER + coord * grid().cellSize;
    }

    function dessinerFond() {
      const g = grid();
      ctx.fillStyle = '#e8dcc3';
      ctx.fillRect(0, 0, logicalWidth(), logicalHeight());
      ctx.fillStyle = state.map.background?.color || '#fffdf7';
      ctx.fillRect(GUTTER, GUTTER, g.cols * g.cellSize, g.rows * g.cellSize);
    }

    function dessinerGrille() {
      const g = grid();
      if (!state.showGrid || g.showGrid === false) return;

      ctx.strokeStyle = 'rgba(139,94,60,0.25)';
      ctx.lineWidth = 1;

      for (let c = 0; c <= g.cols; c += 1) {
        ctx.beginPath();
        ctx.moveTo(px(c), GUTTER);
        ctx.lineTo(px(c), GUTTER + g.rows * g.cellSize);
        ctx.stroke();
      }
      for (let r = 0; r <= g.rows; r += 1) {
        ctx.beginPath();
        ctx.moveTo(GUTTER, px(r));
        ctx.lineTo(GUTTER + g.cols * g.cellSize, px(r));
        ctx.stroke();
      }
    }

    /** Règles de coordonnées : colonnes en haut, lignes à gauche. */
    function dessinerCoordonnees() {
      if (!state.showCoords) return;
      const g = grid();
      const taille = Math.max(8, Math.min(13, g.cellSize / 3.6));

      ctx.fillStyle = '#6b4b2f';
      ctx.font = `${taille}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let c = 0; c < g.cols; c += 1) {
        ctx.fillText(String(c), px(c) + g.cellSize / 2, GUTTER / 2);
      }
      ctx.textAlign = 'right';
      for (let r = 0; r < g.rows; r += 1) {
        ctx.fillText(String(r), GUTTER - 4, px(r) + g.cellSize / 2);
      }
    }

    function dessinerElement(element) {
      const g = grid();
      const x = px(element.x);
      const y = px(element.y);
      const w = element.w * g.cellSize;
      const h = element.h * g.cellSize;

      // Un élément « remembered » est un souvenir : le joueur sait qu'il
      // existe mais ne le voit pas actuellement.
      ctx.globalAlpha = element.remembered ? 0.45 : 1;

      ctx.fillStyle = element.color || '#6b4b2f';
      ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
      ctx.strokeStyle = 'rgba(59,47,30,0.55)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

      if (element.icone) {
        ctx.fillStyle = '#fff';
        ctx.font = `${Math.min(w, h) * 0.55}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(element.icone, x + w / 2, y + h / 2);
      }

      // V1.13.11 — État d'une porte, lisible d'un coup d'œil.
      //
      // Le mécanisme d'ouverture existait déjà : le bouton de l'inspecteur
      // bascule blocksMovement et blocksVision, et le moteur de vision en
      // tient compte immédiatement (mesuré : 93 cases visibles porte
      // ouverte, 81 fermée). Ce qui manquait, c'était de le VOIR : une
      // porte ouverte et une porte fermée se ressemblaient trait pour
      // trait, seul leur nom changeait dans l'inspecteur.
      //
      // Fermée  : un battant plein en travers du passage.
      // Ouverte : le battant rabattu sur le côté, l'ouverture dégagée.
      //
      // blocksMovement est transmis aux joueurs pour les éléments qu'ils
      // connaissent : leur carte montre donc le même état que celle du MJ,
      // sans traitement particulier.
      if (element.kind === 'porte') {
        const fermee = !!element.blocksMovement;
        const epaisseur = Math.max(2, Math.min(w, h) * 0.22);
        ctx.save();
        ctx.fillStyle = fermee ? 'rgba(52,38,22,0.92)' : 'rgba(52,38,22,0.55)';
        if (fermee) {
          // Battant en travers, dans le sens le plus long de l'ouverture.
          if (w >= h) ctx.fillRect(x + 1, y + h / 2 - epaisseur / 2, w - 2, epaisseur);
          else ctx.fillRect(x + w / 2 - epaisseur / 2, y + 1, epaisseur, h - 2);
        } else {
          // Battant rabattu : un simple montant sur un bord.
          if (w >= h) ctx.fillRect(x + 1, y + 1, Math.max(2, w * 0.18), h - 2);
          else ctx.fillRect(x + 1, y + 1, w - 2, Math.max(2, h * 0.18));
        }
        ctx.restore();
      }

      // Halo discret des sources de lumière : repère de MJ, jamais
      // transmis au joueur (lightRange est filtré par la projection).
      if (Number(element.lightRange) > 0) {
        const cx = x + w / 2;
        const cy = y + h / 2;
        const rayon = element.lightRange * g.cellSize;
        const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, rayon);
        halo.addColorStop(0, 'rgba(255,214,130,0.30)');
        halo.addColorStop(1, 'rgba(255,214,130,0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(cx, cy, rayon, 0, Math.PI * 2);
        ctx.fill();
      }

      // Un élément masqué aux joueurs n'existe que dans la vue MJ.
      if (element.visibleToPlayers === false) {
        ctx.strokeStyle = '#9b2c2c';
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 2.5;
        ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
        ctx.setLineDash([]);
      }

      ctx.globalAlpha = 1;
    }

    function dessinerToken(token, apercu) {
      const g = grid();
      const taille = token.size || 1;
      const cx = px(apercu ? apercu.x : token.x) + (taille * g.cellSize) / 2;
      const cy = px(apercu ? apercu.y : token.y) + (taille * g.cellSize) / 2;
      const rayon = (taille * g.cellSize) / 2 - 3;

      ctx.globalAlpha = apercu ? 0.6 : 1;

      // Halo de portée de vision (uniquement pour son propre personnage).
      if (!apercu && token.own && state.map.self?.visionRange) {
        ctx.beginPath();
        ctx.arc(cx, cy, state.map.self.visionRange * g.cellSize, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(63,98,135,0.35)';
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.beginPath();
      ctx.arc(cx, cy, rayon, 0, Math.PI * 2);
      ctx.fillStyle = token.color || (token.kind === 'mob' ? '#7d3f3f' : '#3f6287');
      ctx.fill();
      ctx.lineWidth = state.selectedId === token.id ? 4 : 2.5;
      ctx.strokeStyle = state.selectedId === token.id ? '#d4af37' : '#3b2f1e';
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = `${rayon}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(token.kind === 'mob' ? '👹' : '👤', cx, cy);

      const nom = token.label || token.entity?.nom || (token.kind === 'mob' ? 'Créature' : 'Personnage');
      const libelle = nom.length > 14 ? `${nom.slice(0, 13)}…` : nom;
      const policeNom = Math.max(9, g.cellSize / 4.2);

      ctx.font = `bold ${policeNom}px sans-serif`;
      const largeur = ctx.measureText(libelle).width + 8;
      ctx.fillStyle = 'rgba(255,248,220,0.92)';
      ctx.fillRect(cx - largeur / 2, cy + rayon + 1, largeur, policeNom + 5);
      ctx.strokeStyle = '#8b5e3c';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - largeur / 2, cy + rayon + 1, largeur, policeNom + 5);
      ctx.fillStyle = '#3b2f1e';
      ctx.fillText(libelle, cx, cy + rayon + 3 + policeNom / 2);

      // Barre de vie.
      if (token.entity?.hp) {
        const max = Math.max(1, Number(token.entity.hp.max) || 1);
        const cur = Math.max(0, Number(token.entity.hp.current) || 0);
        const pct = Math.max(0, Math.min(1, cur / max));
        const bw = taille * g.cellSize - 10;
        const by = cy - rayon - 7;
        ctx.fillStyle = '#fff';
        ctx.fillRect(cx - bw / 2, by, bw, 5);
        ctx.fillStyle = pct > 0.5 ? '#3f7d4a' : pct > 0.2 ? '#b08948' : '#8b3e3c';
        ctx.fillRect(cx - bw / 2, by, bw * pct, 5);
        ctx.strokeStyle = '#3b2f1e';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx - bw / 2, by, bw, 5);
      }

      // Marqueurs réservés à la vue MJ.
      if (token.visibleToPlayers === false) {
        ctx.fillStyle = '#9b2c2c';
        ctx.font = `bold ${Math.max(8, g.cellSize / 5)}px sans-serif`;
        ctx.fillText('CACHÉ', cx, cy - rayon - 13);
      }
      if (token.locked) {
        ctx.fillStyle = '#3b2f1e';
        ctx.font = `${Math.max(9, g.cellSize / 4)}px sans-serif`;
        ctx.fillText('🔒', cx + rayon - 4, cy - rayon + 4);
      }

      ctx.globalAlpha = 1;
    }

    /**
     * Voile de brouillard.
     *  - Vue joueur : masquage réel (le serveur n'a de toute façon rien
     *    envoyé pour les cases inconnues).
     *  - Vue MJ : aperçu semi-transparent, activable, de ce que le groupe
     *    ne voit pas.
     */
    function dessinerBrouillard() {
      const g = grid();

      let visibles = state.visible;
      let explorees = state.explored;
      let apercu = false;

      if (state.map.role === 'mj') {
        if (!state.showPlayerVision || !state.map.fog?.enabled) return;
        visibles = new Set(state.map.playerVision?.visible || []);
        explorees = new Set(state.map.playerVision?.explored || []);
        apercu = true;
      }

      if (!visibles) return;

      for (let c = 0; c < g.cols; c += 1) {
        for (let r = 0; r < g.rows; r += 1) {
          const cle = cellKey(c, r);
          if (visibles.has(cle)) continue;

          const connue = explorees && explorees.has(cle);
          if (apercu) {
            ctx.fillStyle = connue ? 'rgba(59,47,30,0.22)' : 'rgba(59,47,30,0.5)';
          } else {
            ctx.fillStyle = connue ? 'rgba(20,16,10,0.55)' : '#14100a';
          }
          ctx.fillRect(px(c), px(r), g.cellSize, g.cellSize);
        }
      }
    }

    // --- Annotations (tableau blanc de la carte) ---------------------------

    function pointVersPx(point) {
      const g = grid();
      return { x: GUTTER + point.x * g.cellSize, y: GUTTER + point.y * g.cellSize };
    }

    /** Épaisseur et corps de police suivent le zoom de la carte. */
    function epaisseur(taille) {
      return Math.max(1, (Number(taille) || 3) * (grid().cellSize / 24));
    }

    function corpsTexte(taille) {
      return Math.max(9, (Number(taille) || 3) * (grid().cellSize / 8));
    }

    function tracerPolyligne(points, couleur, taille, alpha) {
      if (!points || points.length < 2) return;

      ctx.save();
      ctx.globalAlpha = alpha ?? 1;
      ctx.strokeStyle = couleur || '#9b2c2c';
      ctx.lineWidth = epaisseur(taille);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      const depart = pointVersPx(points[0]);
      ctx.moveTo(depart.x, depart.y);
      for (let i = 1; i < points.length; i += 1) {
        const p = pointVersPx(points[i]);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.restore();
    }

    function dessinerAnnotation(annotation) {
      if (annotation.type === 'texte') {
        const p = pointVersPx(annotation.points[0]);
        const corps = corpsTexte(annotation.size);

        ctx.save();
        ctx.font = `bold ${corps}px 'Uncial Antiqua', serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        // Liseré clair pour rester lisible sur n'importe quel décor.
        ctx.lineWidth = Math.max(2, corps / 6);
        ctx.strokeStyle = 'rgba(255,248,220,0.9)';
        ctx.strokeText(annotation.text, p.x, p.y);
        ctx.fillStyle = annotation.color || '#9b2c2c';
        ctx.fillText(annotation.text, p.x, p.y);

        // Un texte du calque MJ est souligné en pointillés (vue MJ seule).
        if (annotation.visibleToPlayers === false) {
          const largeur = ctx.measureText(annotation.text).width;
          ctx.setLineDash([4, 3]);
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#9b2c2c';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y + corps * 0.6);
          ctx.lineTo(p.x + largeur, p.y + corps * 0.6);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.restore();
        return;
      }

      // Un tracé du calque MJ est rendu en pointillés dans la vue MJ.
      if (annotation.visibleToPlayers === false) {
        ctx.save();
        ctx.setLineDash([7, 5]);
        tracerPolyligne(annotation.points, annotation.color, annotation.size, 0.95);
        ctx.restore();
        return;
      }

      tracerPolyligne(annotation.points, annotation.color, annotation.size, 1);
    }

    function dessinerAnnotations() {
      if (!state.showAnnotations) return;

      Object.values(state.map.annotations || {}).forEach(dessinerAnnotation);

      // Tracés en cours : le sien en premier, puis ceux des autres postes.
      if (state.localStroke) {
        tracerPolyligne(state.localStroke.points, state.localStroke.color, state.localStroke.size, 0.85);
      }
      state.previews.forEach(apercu => {
        tracerPolyligne(apercu.points, apercu.color, apercu.size, 0.6);
      });
    }

    /** Test de proximité utilisé par la gomme d'annotations. */
    function annotationAt(point, tolerance) {
      if (!state.map) return null;
      const seuil = tolerance ?? 0.45;
      const annotations = Object.values(state.map.annotations || {});

      for (let i = annotations.length - 1; i >= 0; i -= 1) {
        const annotation = annotations[i];

        if (annotation.type === 'texte') {
          const ancre = annotation.points[0];
          const largeur = Math.max(1, annotation.text.length * 0.35);
          if (point.x >= ancre.x - 0.3 && point.x <= ancre.x + largeur &&
              Math.abs(point.y - ancre.y) <= 0.5) {
            return annotation;
          }
          continue;
        }

        for (let s = 0; s < annotation.points.length - 1; s += 1) {
          if (distancePointSegment(point, annotation.points[s], annotation.points[s + 1]) <= seuil) {
            return annotation;
          }
        }
      }
      return null;
    }

    function distancePointSegment(p, a, b) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const longueur = dx * dx + dy * dy;
      if (longueur === 0) return Math.hypot(p.x - a.x, p.y - a.y);
      let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / longueur;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    }

    // --- Outil de mesure ---------------------------------------------------
    //
    // Purement local : rien n'est envoye au serveur, rien n'est persiste.
    // La distance affichee est EUCLIDIENNE, comme celle qu'emploie le moteur
    // de vision (Math.hypot dans calculerCellulesVisibles) : le MJ mesure
    // ainsi dans la meme unite que les portees de vue.

    /**
     * V1.13.11 — Aura de portée autour du jeton sélectionné.
     *
     * Répond d'un regard à « est-ce que je peux l'atteindre ? ». C'est un
     * repère de LECTURE, purement local : rien n'est envoyé au serveur, et
     * l'aura n'apparaît sur aucun autre poste.
     *
     * Le rayon est mesuré depuis le CENTRE du jeton et tient compte de sa
     * taille : une créature de 2×2 atteint plus loin qu'une de 1×1, ce qui
     * est la règle de toutes les tables. La distance reste euclidienne,
     * comme l'outil de mesure et comme le moteur de vision — trois
     * géométries différentes se contrediraient à l'écran.
     *
     * L'aura ignore les murs, volontairement : c'est une portée, pas une
     * ligne de vue. Le champ de vision, lui, est déjà rendu ailleurs.
     */
    function dessinerAura() {
      if (!state.aura || !state.aura.actif || !state.map) return;

      // V1.13.12 — Ancrage de repli sur le jeton du spectateur.
      //
      // La première version exigeait une sélection. Un joueur qui cochait
      // la case sans avoir rien sélectionné ne voyait RIEN, et concluait
      // logiquement à une panne. Or celui qui coche « aura de portée »
      // veut d'abord connaître la SIENNE : c'est le repli naturel.
      //
      // Le MJ, lui, n'a pas de jeton propre — d'où le message d'interface
      // côté map.html quand rien n'est sélectionné.
      const token = state.map.tokens?.[state.selectedId]
        || (state.map.self ? state.map.tokens?.[state.map.self.tokenId] : null);
      if (!token) return;

      const g = grid();
      const taille = token.size || 1;

      // px() ajoute la GOUTTIÈRE, la marge où sont écrits les repères de
      // colonnes et de lignes. La première version multipliait la case par
      // cellSize sans elle : le cercle était décalé de la gouttière vers le
      // haut et vers la gauche, donc jamais centré sur le jeton. Tout le
      // reste du rendu passe par px() — l'aura doit en faire autant.
      const cx = px(token.x + taille / 2);
      const cy = px(token.y + taille / 2);
      const rayon = (state.aura.cases + taille / 2) * g.cellSize;

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, rayon, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(60,94,139,.10)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(60,94,139,.75)';
      ctx.lineWidth = Math.max(1.2, g.cellSize * 0.045);
      ctx.setLineDash([g.cellSize * 0.3, g.cellSize * 0.2]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Étiquette sur fond clair : lisible sur un décor sombre comme clair.
      const texte = `${state.aura.cases} case${state.aura.cases > 1 ? 's' : ''}`;
      ctx.font = `600 ${Math.max(10, g.cellSize * 0.34)}px system-ui, sans-serif`;
      const largeur = ctx.measureText(texte).width;
      const hauteur = Math.max(14, g.cellSize * 0.46);
      // Sur une grande portée, le haut du cercle sort du canvas et
      // l'étiquette avec lui. On la ramène à l'intérieur plutôt que de la
      // laisser se faire rogner : elle porte le chiffre, c'est elle qu'on
      // vient lire.
      const bx = Math.max(2, Math.min(logicalWidth() - largeur - 12, cx - largeur / 2 - 5));
      const by = Math.max(2, Math.min(logicalHeight() - hauteur - 2, cy - rayon - hauteur - 3));
      ctx.fillStyle = 'rgba(245,236,216,.94)';
      ctx.strokeStyle = 'rgba(60,94,139,.75)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(bx, by, largeur + 10, hauteur);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#3c5e8b';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(texte, bx + 5, by + hauteur / 2);
      ctx.restore();
    }

    function dessinerMesure() {
      if (!state.mesure || !state.mesure.arrivee) return;

      const g = grid();
      const a = pointVersPx(state.mesure.depart);
      const b = pointVersPx(state.mesure.arrivee);

      const dx = state.mesure.arrivee.x - state.mesure.depart.x;
      const dy = state.mesure.arrivee.y - state.mesure.depart.y;
      const distance = Math.hypot(dx, dy);

      ctx.save();

      ctx.strokeStyle = '#7a2222';
      ctx.lineWidth = Math.max(2, g.cellSize / 18);
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);

      [a, b].forEach(point => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, Math.max(3, g.cellSize / 10), 0, Math.PI * 2);
        ctx.fillStyle = '#7a2222';
        ctx.fill();
      });

      // Etiquette : distance, puis le delta en cases pour lever l'ambiguite.
      const texte = `${distance.toFixed(1)} cases   Δ ${Math.abs(Math.round(dx))} × ${Math.abs(Math.round(dy))}`;
      const corps = Math.max(11, g.cellSize / 3.2);

      ctx.font = `bold ${corps}px 'Segoe UI', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const largeur = ctx.measureText(texte).width + 14;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2 - corps;

      ctx.fillStyle = 'rgba(255,248,220,0.95)';
      ctx.fillRect(mx - largeur / 2, my - corps * 0.8, largeur, corps * 1.6);
      ctx.strokeStyle = '#7a2222';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(mx - largeur / 2, my - corps * 0.8, largeur, corps * 1.6);

      ctx.fillStyle = '#7a2222';
      ctx.fillText(texte, mx, my);

      ctx.restore();
    }

    function dessinerSurvol() {
      if (!state.hoverCell || !inBounds(state.hoverCell)) return;
      const g = grid();
      ctx.strokeStyle = '#d4af37';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(px(state.hoverCell.x) + 1, px(state.hoverCell.y) + 1, g.cellSize - 2, g.cellSize - 2);
    }

    function render() {
      if (!state.map) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      ctx.clearRect(0, 0, logicalWidth(), logicalHeight());
      dessinerFond();

      Object.values(state.map.elements || {}).forEach(dessinerElement);
      dessinerGrille();

      // Le brouillard passe AU-DESSUS du décor mais SOUS les tokens :
      // les tokens transmis sont par construction dans une case visible.
      dessinerBrouillard();

      Object.values(state.map.tokens || {}).forEach(token => {
        if (state.ghost && state.ghost.id === token.id) return;
        dessinerToken(token, null);
      });

      if (state.ghost) {
        const token = state.map.tokens[state.ghost.id];
        if (token) dessinerToken(token, state.ghost);
      }

      // Les annotations sont une couche par-dessus la scène.
      dessinerAnnotations();

      dessinerAura();
      dessinerMesure();
      dessinerSurvol();
      dessinerCoordonnees();

      if (typeof opts.onAfterRender === 'function') opts.onAfterRender(state);
    }

    window.addEventListener('resize', resize);

    // Le panneau central change aussi de taille sans que la fenêtre bouge
    // (ouverture d'une section, apparition d'une barre d'outils).
    if (typeof ResizeObserver === 'function' && canvas.parentElement) {
      new ResizeObserver(() => resize()).observe(canvas.parentElement);
    }

    // Purge des aperçus : si un poste se déconnecte en plein tracé, son
    // trait ne doit pas rester figé sur la carte des autres.
    setInterval(() => {
      if (!state.previews.size) return;
      const limite = Date.now() - 1500;
      let modifie = false;
      state.previews.forEach((apercu, cle) => {
        if (apercu.ts < limite) { state.previews.delete(cle); modifie = true; }
      });
      if (modifie) render();
    }, 600);

    return {
      state,
      ctx,
      canvas,
      setMap,
      render,
      resize,
      cellFromEvent,
      pointFromEvent,
      inBounds,
      tokenAt,
      elementAt,
      annotationAt,
      isBlocked: cell => state.blocked.has(cellKey(cell.x, cell.y)),
      setSelection(id) { state.selectedId = id; render(); },
      setAura(actif, cases) {
        state.aura = {
          actif: !!actif,
          cases: Math.max(1, Math.min(60, Math.round(Number(cases) || 1)))
        };
        render();
      },
      getAura() { return { ...state.aura }; },

      /**
       * L'aura a-t-elle un jeton sur lequel s'ancrer ?
       * Permet à l'interface de dire POURQUOI rien n'apparaît, au lieu de
       * laisser une case cochée sans effet visible.
       */
      auraAncree() {
        if (!state.map) return false;
        return !!(state.map.tokens?.[state.selectedId]
          || (state.map.self && state.map.tokens?.[state.map.self.tokenId]));
      },
      setHover(cell) {
        const memeCase = state.hoverCell && cell &&
          state.hoverCell.x === cell.x && state.hoverCell.y === cell.y;
        if (memeCase) return;
        state.hoverCell = cell;
        render();
      },
      setGhost(ghost) { state.ghost = ghost; render(); },
      setOption(nom, valeur) { state[nom] = valeur; render(); },

      /** 1 = ajusté à l'espace disponible ; au-delà, le conteneur défile. */
      setZoom(valeur) {
        state.zoom = Math.max(0.25, Math.min(4, Number(valeur) || 1));
        resize();
        return state.zoom;
      },
      getZoom() { return state.zoom; },

      // --- Tracé local en cours -----------------------------------------
      demarrerTrace(point, couleurTrace, taille) {
        state.localStroke = { points: [point], color: couleurTrace, size: taille };
        render();
      },
      prolongerTrace(point) {
        if (!state.localStroke) return null;
        const precedent = state.localStroke.points[state.localStroke.points.length - 1];
        // Filtre les micro-déplacements : moins de points, moins de trafic.
        if (Math.hypot(point.x - precedent.x, point.y - precedent.y) < 0.08) return null;
        state.localStroke.points.push(point);
        render();
        return [precedent, point];
      },
      terminerTrace() {
        const trace = state.localStroke;
        state.localStroke = null;
        render();
        return trace;
      },

      // --- Aperçus reçus des autres postes -------------------------------
      pushPreview(apercu) {
        if (!apercu?.strokeId || !Array.isArray(apercu.points)) return;
        const existant = state.previews.get(apercu.strokeId);

        if (existant) {
          const dernier = existant.points[existant.points.length - 1];
          apercu.points.forEach(point => {
            if (dernier && point.x === dernier.x && point.y === dernier.y) return;
            existant.points.push(point);
          });
          existant.ts = Date.now();
        } else {
          state.previews.set(apercu.strokeId, {
            points: [...apercu.points],
            color: apercu.color,
            size: apercu.size,
            ts: Date.now()
          });
        }
        render();
      },
      clearPreviews() { state.previews.clear(); render(); },

      // --- Mesure (locale, jamais transmise) -----------------------------
      demarrerMesure(point) { state.mesure = { depart: point, arrivee: null }; render(); },
      prolongerMesure(point) {
        if (!state.mesure) return;
        state.mesure.arrivee = point;
        render();
      },
      terminerMesure() { state.mesure = null; render(); },
      exportPng(nomFichier) {
        const lien = document.createElement('a');
        lien.download = nomFichier || 'arcanesync-carte.png';
        lien.href = canvas.toDataURL('image/png');
        lien.click();
      }
    };
  }

  return { createRenderer, readContext, connect, escapeHtml, cellKey, GUTTER };
})();
