// serveur/acces.js
// ---------------------------------------------------------------------------
// Rôle d'une requête HTTP (déclaré par la page, prouvé par le code MJ).
// ---------------------------------------------------------------------------
const mjCode = require('../mjcode');

// Point d'entrée unique du contrôle d'accès MJ.
// La page DÉCLARE son rôle (corps, paramètre ou en-tête X-ArcaneSync-Role) ;
// le rôle MJ n'est accordé qu'avec le code MJ (en-tête X-ArcaneSync-MJ),
// dès qu'un code est défini (voir mjcode.js).
function roleDepuisRequete(req) {
  const role = req.body?.role ?? req.query?.role ?? req.get('X-ArcaneSync-Role');
  return role === 'mj' && mjCode.autorise(req.get('X-ArcaneSync-MJ')) ? 'mj' : 'player';
}

function playerIdDepuisRequete(req) {
  const id = req.body?.playerId ?? req.query?.playerId;
  return typeof id === 'string' && id ? id : null;
}

function refuserSiPasMj(req, res) {
  if (roleDepuisRequete(req) !== 'mj') {
    // L'en-tête permet à la page de redemander le code puis de rejouer.
    res.set('X-ArcaneSync-MJ', 'requis');
    res.status(403).json({
      message: mjCode.estConfigure()
        ? 'Action réservée au Maître du Jeu : code MJ requis.'
        : 'Action réservée au Maître du Jeu.'
    });
    return true;
  }
  return false;
}

module.exports = { roleDepuisRequete, playerIdDepuisRequete, refuserSiPasMj };
