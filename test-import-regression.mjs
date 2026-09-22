import assert from 'node:assert/strict';
import fs from 'node:fs';
import {splitGames,headersFrom} from './pgn.js';

const index=fs.readFileSync('./index.html','utf8');
const app=fs.readFileSync('./app.js','utf8');

assert.match(index,/id="importBtn"[^>]*>Importer PGN/,'Le bouton d’import PGN doit rester présent');
assert.match(index,/id="pgnFile"[^>]*type="file"[^>]*accept="\.pgn,text\/plain"/,'Le sélecteur de fichier PGN doit rester présent');
assert.match(index,/id="pgnCollections"/,'La zone des PGN importés doit rester présente');
assert.match(index,/data-pgn-color="w"/,'L’onglet HighTaxi blanc doit rester présent');
assert.match(index,/data-pgn-color="b"/,'L’onglet HighTaxi noir doit rester présent');
assert.match(app,/renderPgnCollections\(\)/,'L’import doit rafraîchir la collection PGN');

const text=fs.readFileSync('/mnt/data/ChessCom_hightaxi_202609.pgn','utf8');
const games=splitGames(text);
assert.equal(games.length,153,'Le PGN Chess.com fourni doit contenir 153 parties');
assert.equal(headersFrom(games[0]).White,'HighTaxi');
assert.equal(headersFrom(games[0]).Black,'pankaj365');
console.log('IMPORT REGRESSION TESTS OK');
