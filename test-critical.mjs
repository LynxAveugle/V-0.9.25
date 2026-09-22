import assert from 'node:assert/strict';
import {Chess} from './chess.js';
import {parsePGN,exportPGN,headersFrom} from './pgn.js';
const promo=`[Event "A]"]\n[SetUp "1"]\n[FEN "k7/4P3/8/8/8/8/8/4K3 w - - 0 1"]\n\n{racine} 1. e8Q+ {[%clk 0:09:59]} *`;
const games=parsePGN(promo); assert.equal(games.errors.length,0); assert.equal(games[0].headers.Event,'A]'); assert.equal(games[0].root.comment,'racine'); const n=games[0].root.children[0]; assert.equal(n.san,'e8=Q+'); assert.equal(n.clock,'0:09:59');
const out=exportPGN(games[0]); assert.ok(out.includes('[Event "A]"]')); assert.ok(out.includes('{racine}')); assert.ok(out.includes('{[%clk 0:09:59]}')); assert.ok(!String(n.comment).includes('[%clk'));
const c=new Chess(); assert.equal(c.clone().fen(),c.fen());
console.log('CRITICAL PGN/CHESS TESTS OK');

const braceGame=parsePGN(`1. e4 *`)[0]; braceGame.root.children[0].note="note } dangereux"; const braceOut=exportPGN(braceGame); assert.ok(braceOut.includes("note ( dangereux"));
