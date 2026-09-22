import fs from 'node:fs';
import assert from 'node:assert/strict';

assert.ok(fs.existsSync('.nojekyll'),'.nojekyll doit être présent pour un hébergement GitHub Pages prévisible');
assert.ok(!fs.existsSync('functions'),'Aucune fonction Cloudflare ne doit être requise');
assert.ok(!fs.existsSync('_headers'),'Le fichier _headers Cloudflare ne doit pas être présenté comme actif sur GitHub Pages');
for(const file of ['index.html','app.js','styles.css','chess.js','pgn.js','db.js','version.js','piece-assets.js','stockfish-worker.js','sw.js','manifest.webmanifest']) assert.ok(fs.existsSync(file),`Fichier manquant: ${file}`);
for(const file of ['stockfish-18-lite-single.js','stockfish-18-lite-single.wasm']) assert.ok(fs.existsSync(file),`Stockfish local manquant: ${file}`);
for(const key of ['wP','wN','wB','wR','wQ','wK','bP','bN','bB','bR','bQ','bK']){const file=`${key}.png`;assert.ok(fs.existsSync(file),`Pièce manquante: ${file}`);assert.ok(fs.statSync(file).size>1000,`Pièce vide: ${file}`)}
const version=fs.readFileSync('version.js','utf8');assert.match(version,/APP_VERSION="0\.9\.26"/);
const app=fs.readFileSync('app.js','utf8');assert.doesNotMatch(app,/Cloudflare|\/api\/chesscom/i);assert.match(app,/CHESSCOM_BASE.*player/);
const worker=fs.readFileSync('stockfish-worker.js','utf8');assert.match(worker,/importScripts\(engine\)/);assert.match(fs.readFileSync('app.js','utf8'),/stockfish-18-lite-single\.wasm/);assert.match(fs.readFileSync('app.js','utf8'),/stockfish@18\.0\.8/);
console.log('GITHUB PAGES PACKAGE TESTS OK');

const assets=fs.readFileSync('piece-assets.js','utf8');
for(const key of ['wP','wN','wB','wR','wQ','wK','bP','bN','bB','bR','bQ','bK']) assert.match(assets,new RegExp(`${key}:\"data:image/png;base64,`),`Pièce embarquée manquante: ${key}`);
assert.match(app,/PIECE_DATA\[key\]/,'Les pièces doivent utiliser les assets embarqués avant le chemin relatif');
assert.match(app,/setTimeout\(\(\)=>buildGlobalTree\(\),0\)/,'La construction de l’arbre global ne doit pas bloquer le changement d’onglet');
console.log('V0.9.17 REGRESSION TESTS OK');
