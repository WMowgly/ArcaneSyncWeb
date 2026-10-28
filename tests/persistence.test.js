// Bac a sable de donnees : DOIT rester le tout premier require.
const bacDonnees = require('./_donnees');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataFile = bacDonnees.chemin('data.json');
const backupFile = `${dataFile}.backup-test`;

const original = fs.readFileSync(dataFile, 'utf8');
fs.writeFileSync(backupFile, original, 'utf8');

try {
  // Force a clean module load for the temporary test state.
  delete require.cache[require.resolve('../joueur')];
  const {
    getJoueurs,
    getJoueurById,
    sauvegardeData
  } = require('../joueur');

  const players = getJoueurs();

  if (!players.length) {
    throw new Error('Aucun joueur de test disponible.');
  }

  const player = players[0];

  if (!player.id) {
    throw new Error('Le joueur de test ne possède pas d\'ID stable.');
  }

  const byId = getJoueurById(player.id);
  if (!byId || byId.nom !== player.nom) {
    throw new Error('Recherche par ID impossible.');
  }

  const originalStats = JSON.stringify(player.stats);
  const originalSpells = JSON.stringify(player.spells);
  const originalAttacks = JSON.stringify(player.attaques_speciales);
  const originalHp = player.hp?.current ?? 0;
  // Valeur valide : sous le maximum (la sauvegarde borne désormais actuel/max).
  const newHp = originalHp > 0 ? originalHp - 1 : Math.min(1, player.hp?.max ?? 0);

  const success = sauvegardeData(
    { id: player.id },
    {
      hp: {
        current: newHp
      }
    }
  );

  if (!success) {
    throw new Error('sauvegardeData() par ID a échoué.');
  }

  const after = JSON.parse(fs.readFileSync(dataFile, 'utf8'))[0];

  if (after.id !== player.id) {
    throw new Error('L\'ID stable a été modifié pendant la sauvegarde.');
  }

  if (after.hp.current !== newHp) {
    throw new Error('La modification HP n’a pas été persistée.');
  }

  if (JSON.stringify(after.stats) !== originalStats) {
    throw new Error('Les statistiques ont été modifiées alors qu’elles étaient absentes de la requête.');
  }

  if (JSON.stringify(after.spells) !== originalSpells) {
    throw new Error('Les sorts ont été modifiés alors qu’ils étaient absents de la requête.');
  }

  if (JSON.stringify(after.attaques_speciales) !== originalAttacks) {
    throw new Error('Les attaques spéciales ont été modifiées alors qu’elles étaient absentes de la requête.');
  }

  console.log('PASS: ID stable + sauvegarde par ID + champs non modifiés conservés');
} finally {
  fs.writeFileSync(dataFile, original, 'utf8');

  if (fs.existsSync(backupFile)) {
    fs.unlinkSync(backupFile);
  }

  delete require.cache[require.resolve('../joueur')];
}
