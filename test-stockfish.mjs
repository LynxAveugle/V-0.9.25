import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const app=fs.readFileSync('./app.js','utf8');
const worker=fs.readFileSync('./stockfish-worker.js','utf8');
const sw=fs.readFileSync('./sw.js','utf8');
const js=fs.readFileSync('./stockfish-18-lite-single.js');
const wasm=fs.readFileSync('./stockfish-18-lite-single.wasm');

assert.match(app,/stockfish-18-lite-single\.js/);
assert.match(app,/stockfish-18-lite-single\.wasm/);
assert.match(app,/stockfish@18\.0\.8/);
assert.match(app,/new URL\(c\.local\?"\.\/stockfish-18-lite-single\.js":c\.js,import\.meta\.url\)/);
assert.match(app,/base\.hash=`\$\{encodeURIComponent\(c\.wasm\)\},worker`/);
assert.match(app,/base\.hash=`\$\{encodeURIComponent\(c\.wasm\)\},worker`/);
assert.match(worker,/importScripts\(engine\)/);
assert.match(sw,/stockfish-18-lite-single\.js/);
assert.match(sw,/stockfish-18-lite-single\.wasm/);
assert.equal(js.length,20670);
assert.equal(wasm.length,7295411);
assert.equal(crypto.createHash('sha256').update(js).digest('hex'),'2278005057f381491f1c9bb3e44c9f5920b3a00bef9759e33cc6582769a1f1fe');
assert.equal(crypto.createHash('sha256').update(wasm).digest('hex'),'a8fbc05ec6920b56d7485826dcb02c5ffd2826bcbf751cf973046f237a9096f1');
console.log('STOCKFISH 18 LOCAL INTEGRATION TESTS OK');
