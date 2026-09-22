import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('./app.js','utf8');
assert.match(app,/async function fetchChessComJson\(/,'La synchronisation doit centraliser les requêtes JSON Chess.com');
assert.match(app,/https:\/\/api\.chess\.com\/pub/,'GitHub Pages doit utiliser l’API publique Chess.com directement');
assert.match(app,/async function fetchChessComPgn\(/,'La synchronisation doit télécharger le PGN mensuel');
assert.match(app,/\/pgn/,'Les archives mensuelles doivent utiliser leur endpoint PGN');
assert.match(app,/mode:"cors"/,'Les appels Chess.com doivent expliciter le mode CORS');
assert.match(app,/cache:"no-store"/,'Les appels Chess.com ne doivent pas servir une archive obsolète');
assert.match(app,/chessComPgnIsStandard/,'Les variantes non standard doivent rester exclues');
assert.match(app,/Synchronisation interrompue|Erreur de synchronisation/,'La synchronisation doit exposer une erreur exploitable');
assert.doesNotMatch(app,/\/api\/chesscom/,'La version GitHub Pages ne doit plus dépendre d’un proxy Cloudflare');
assert.doesNotMatch(app,/nécessite l'application hébergée sur Cloudflare Pages/i,'Aucune dépendance Cloudflare ne doit rester dans le client');
console.log('GITHUB PAGES SYNC TESTS OK');
