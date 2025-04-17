const express = require('express');
const app = express();
const port = 3000;
const os = require('os');
const interfaces = os.networkInterfaces();
const interfaceName = 'Ethernet 5';

// Recuperer l'adresse IP automatiquement
function getIPAddress(interfaceName) {
    const interfaces = os.networkInterfaces();
    
    // Vérifier si l'interface existe
    if (interfaces[interfaceName]) {
      for (const iface of interfaces[interfaceName]) {
        // Vérifier si l'IP est IPv4 et non interne
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address; // Retourne l'IP
        }
      }
    }
    return null; // Retourne null si l'interface n'est pas trouvée ou si aucune IP valide n'est trouvée
  }
const ip = getIPAddress(interfaceName);
// Sert les fichiers statiques dans le dossier "public"
app.use(express.static('website'));

app.listen(port,ip, () => {
  console.log(`Serveur en ligne : http://${ip}:${port}`);
});