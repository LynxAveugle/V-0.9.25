import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('./app.js','utf8');
assert.match(app,/const openingPrefixCache=new Map\(\)/);
assert.match(app,/function openingPrefixForGame\(g,maxPlies=24\)/);
assert.match(app,/openingPrefixCache\.get\(id\)/);
assert.match(app,/openingPrefixCache\.set\(id,\{key,maxPlies,line\}\)/);
assert.match(app,/line=openingPrefixForGame\(g,MAX_PLIES\)/);
assert.match(app,/const cacheKey=String\(g\.updatedAt\|\|0\)/);
assert.doesNotMatch(app,/JSON\.stringify\(g\.analysisTree\)\.length/);
assert.match(app,/let gameSearch="",gameSearchTimer=null,gameResultFilter="all",gameColorFilter="all",gameSourceFilter="all",gameRenderLimit=100/);
assert.match(app,/const visible=a\.slice\(0,gameRenderLimit\)/);
assert.match(app,/more\.className="loadMoreGames"/);
assert.match(app,/gameRenderLimit\+=100/);
console.log('PERFORMANCE/CACHE/PAGINATION TESTS OK');
