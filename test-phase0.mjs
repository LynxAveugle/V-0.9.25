import assert from 'node:assert/strict';
import {parsePGN, exportPGN} from './pgn.js';

const source = `[Event "Phase 0"]
[White "HighTaxi"]
[Black "Opponent"]
[Result "1-0"]

1. e4!! e5 2. Nf3 (2. Bc4 Nf6) 2... Nc6 3. Bb5 {commentaire} {HighTaxi: ⭐ idée importante} a6 1-0`;
const parsed = parsePGN(source);
assert.equal(parsed.length, 1);
assert.deepEqual(parsed[0].root.children[0].nags, [3], '!! doit être NAG 3 sur e4');
const exported = exportPGN(parsed[0]);
assert.match(exported, /1\. e4 \$3/);
assert.match(exported, /\( 2\. Bc4 2\.\.\. Nf6 \)/);
assert.match(exported, /2\.\.\. Nc6/);
assert.match(exported, /\{commentaire\} \{HighTaxi: ⭐ idée importante\}/);
const roundTrip = parsePGN(exported);
assert.equal(roundTrip.errors?.length || 0, 0);
assert.deepEqual(roundTrip[0].root.children[0].nags, [3]);
assert.deepEqual(roundTrip[0].root.children[0].children[0].children[0].children[0].children[0].annotations, ['⭐']);
assert.equal(roundTrip[0].root.children[0].children[0].children[0].children[0].children[0].note, 'idée importante');
assert.throws(() => parsePGN('1. e4 } e5 *'), /coup non reconnu/);
console.log('PHASE 0 REGRESSION TESTS OK');
