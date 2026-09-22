import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const root = new URL('.', import.meta.url).pathname;
const app = fs.readFileSync(root + 'app.js', 'utf8');
const worker = fs.readFileSync(root + 'stockfish-worker.js', 'utf8');
const sw = fs.readFileSync(root + 'sw.js', 'utf8');
const version = fs.readFileSync(root + 'version.js', 'utf8');

if (/postMessage\(\{type:\s*["']token/.test(app)) throw new Error('token object still sent to Stockfish');
if (!app.includes('postMessage(`position fen ${fen}`)')) throw new Error('position command missing');
if (!app.includes('postMessage("go depth 16")')) throw new Error('go command missing');
if (!app.includes('new URL(c.local?"./stockfish-18-lite-single.js":c.js,import.meta.url)')) throw new Error('direct Stockfish worker missing');
if (!app.includes('base.hash=`${encodeURIComponent(c.wasm)},worker`')) throw new Error('Stockfish WASM worker hash missing');

if (!sw.includes('isStockfish&&cached')) throw new Error('Stockfish cache-first path missing');
if (!version.includes('0.9.27')) throw new Error('version not bumped');

const js = fs.readFileSync(root + 'stockfish-18-lite-single.js');
const wasm = fs.readFileSync(root + 'stockfish-18-lite-single.wasm');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
if (js.length !== 20670 || sha(js) !== '2278005057f381491f1c9bb3e44c9f5920b3a00bef9759e33cc6582769a1f1fe') throw new Error('Stockfish JS integrity mismatch');
if (wasm.length !== 7295411 || sha(wasm) !== 'a8fbc05ec6920b56d7485826dcb02c5ffd2826bcbf751cf973046f237a9096f1') throw new Error('Stockfish WASM integrity mismatch');

console.log('STOCKFISH 0.9.27 REGRESSION TESTS OK');
console.log('NOTE: this test validates the exact Worker message contract and assets; browser execution still requires a real browser runtime.');
