const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const fetch = require('node-fetch');
const crypto = require('crypto');

const GITHUB_REPO = 'TheAmazingArtixx/ouche-nation-launcher'; // ← CHANGE ÇA !
const GITHUB_BRANCH = 'main';
const LAUNCHER_DIR = path.join(app.getPath('appData'), '.ouchenation');
const FILES_DIR = path.join(LAUNCHER_DIR, 'files');
const VERSION_FILE = path.join(LAUNCHER_DIR, 'version.json');

let mainWindow;
let realApp = null;

// Fichiers à synchroniser depuis GitHub
const FILES_TO_SYNC = [
  'main.js',
  'renderer.js',
  'index.html',
  'supabase.js'
];

function createLoadingWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 450,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    autoHideMenuBar: true,
    resizable: false,
    frame: false,
    backgroundColor: '#0f172a',
    transparent: false
  });

  mainWindow.loadFile('loading.html');
}

// Calculer le hash d'un fichier
function getFileHash(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
  } catch (e) {
    return null;
  }
}

// Télécharger un fichier depuis GitHub
async function downloadFile(filename) {
  try {
    const url = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/${filename}`;
    console.log(`[UPDATE] Téléchargement: ${filename}`);
    
    mainWindow.webContents.send('update-log', `Téléchargement: ${filename}`);
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const content = await response.text();
    const filePath = path.join(FILES_DIR, filename);
    
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, content, 'utf8');
    
    console.log(`[UPDATE] ✓ ${filename}`);
    return true;
  } catch (error) {
    console.error(`[UPDATE] ✗ ${filename}:`, error.message);
    return false;
  }
}

// Vérifier et mettre à jour les fichiers
async function checkAndUpdate() {
  try {
    await fs.ensureDir(FILES_DIR);
    
    mainWindow.webContents.send('update-status', 'Vérification des mises à jour...');
    
    // Télécharger les hashes depuis GitHub
    const versionUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/version.json`;
    let remoteVersion = {};
    
    try {
      const response = await fetch(versionUrl);
      if (response.ok) {
        remoteVersion = await response.json();
      }
    } catch (e) {
      console.log('[UPDATE] Pas de fichier version.json distant, téléchargement complet');
    }
    
    // Charger la version locale
    let localVersion = {};
    if (fs.existsSync(VERSION_FILE)) {
      localVersion = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
    }
    
    // Vérifier quels fichiers doivent être mis à jour
    const filesToUpdate = [];
    
    for (const file of FILES_TO_SYNC) {
      const localPath = path.join(FILES_DIR, file);
      const localHash = getFileHash(localPath);
      const remoteHash = remoteVersion[file];
      
      // Télécharger si : fichier n'existe pas OU hash différent OU pas de version distante
      if (!fs.existsSync(localPath) || localHash !== remoteHash || !remoteHash) {
        filesToUpdate.push(file);
      }
    }
    
    if (filesToUpdate.length === 0) {
      mainWindow.webContents.send('update-status', 'Tous les fichiers sont à jour !');
      console.log('[UPDATE] Aucune mise à jour nécessaire');
    } else {
      mainWindow.webContents.send('update-status', `Mise à jour de ${filesToUpdate.length} fichier(s)...`);
      console.log('[UPDATE] Fichiers à mettre à jour:', filesToUpdate);
      
      for (let i = 0; i < filesToUpdate.length; i++) {
        const file = filesToUpdate[i];
        const percent = Math.round(((i + 1) / filesToUpdate.length) * 100);
        
        mainWindow.webContents.send('update-progress', { percent, file });
        
        await downloadFile(file);
      }
      
      // Sauvegarder les nouveaux hashes
      const newVersion = {};
      for (const file of FILES_TO_SYNC) {
        const localPath = path.join(FILES_DIR, file);
        newVersion[file] = getFileHash(localPath);
      }
      
      await fs.writeFile(VERSION_FILE, JSON.stringify(newVersion, null, 2));
    }
    
    mainWindow.webContents.send('update-status', 'Démarrage...');
    
    // Attendre 500ms puis lancer le vrai launcher
    setTimeout(() => {
      launchRealApp();
    }, 500);
    
  } catch (error) {
    console.error('[UPDATE] Erreur:', error);
    mainWindow.webContents.send('update-status', `Erreur: ${error.message}`);
    
    // En cas d'erreur, essayer quand même de lancer l'app si les fichiers existent
    setTimeout(() => {
      launchRealApp();
    }, 2000);
  }
}

function launchRealApp() {
  const realMainPath = path.join(FILES_DIR, 'main.js');
  
  if (!fs.existsSync(realMainPath)) {
    console.error('[UPDATE] main.js introuvable !');
    mainWindow.webContents.send('update-status', 'Erreur: Fichiers manquants');
    return;
  }
  
  try {
    // Fermer la fenêtre de loading
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
    
    // Changer le répertoire de travail vers FILES_DIR
    process.chdir(FILES_DIR);
    
    // Charger et exécuter le vrai main.js
    delete require.cache[require.resolve(realMainPath)];
    realApp = require(realMainPath);
    
    console.log('[UPDATE] Application lancée avec succès');
  } catch (error) {
    console.error('[UPDATE] Erreur lors du lancement:', error);
  }
}

app.whenReady().then(() => {
  createLoadingWindow();
  
  mainWindow.webContents.on('did-finish-load', () => {
    checkAndUpdate();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
