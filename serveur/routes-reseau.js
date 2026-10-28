// serveur/routes-reseau.js
// ---------------------------------------------------------------------------
// Adresses réseau du serveur, pour que les joueurs rejoignent la partie
// (accueil : adresse et QR code). Lecture libre : ces adresses sont celles
// que les joueurs du réseau local utilisent déjà.
// ---------------------------------------------------------------------------
const express = require('express');
const os = require('os');

const app = express.Router();

// Cartes réseau virtuelles (machines virtuelles, WSL, VPN...) : listées en
// dernier, les joueurs ne peuvent généralement pas les joindre.
const VIRTUELLE = /vethernet|virtualbox|vmware|hyper-v|wsl|docker|loopback|tailscale|zerotier|vpn|bluetooth/i;

function adressesLocales() {
  const adresses = [];
  for (const [nom, cartes] of Object.entries(os.networkInterfaces())) {
    for (const carte of cartes || []) {
      if (carte.family !== 'IPv4' || carte.internal) continue;
      adresses.push({ adresse: carte.address, interface: nom });
    }
  }
  const rang = ({ adresse, interface: nom }) =>
    (VIRTUELLE.test(nom) ? 10 : 0) + (adresse.startsWith('192.168.') ? 0 : adresse.startsWith('10.') ? 1 : 2);
  return adresses.sort((a, b) => rang(a) - rang(b));
}

app.get('/api/reseau', (req, res) => {
  // Le port est celui sur lequel la requête est arrivée : juste, même
  // pour une instance lancée avec PORT=3100.
  res.json({ port: req.socket.localPort, adresses: adressesLocales() });
});

module.exports = () => app;
