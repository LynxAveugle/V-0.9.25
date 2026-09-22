import assert from "node:assert/strict";
import fs from "node:fs";

const app=fs.readFileSync("./app.js","utf8");
const version=fs.readFileSync("./version.js","utf8");
const sw=fs.readFileSync("./sw.js","utf8");

assert.match(version,/APP_VERSION="0\.9\.25"/);
assert.match(sw,/v0\.9\.25/);

const openStart=app.indexOf("async function openGame(id)");
const openEnd=app.indexOf("let boardRotated=false;",openStart);
assert.ok(openStart>=0 && openEnd>openStart,"openGame() introuvable");
const openGame=app.slice(openStart,openEnd);

assert.match(openGame,/const nextScope=userSide\(g\)\|\|"all"/);
assert.match(openGame,/analysisScope=nextScope/);
assert.match(openGame,/if\(globalTreeSideFilter!==nextScope\)/);
assert.match(openGame,/globalTree=null;globalTreeBuiltFor=0/);
assert.match(openGame,/globalTreePendingFilter=null/);
assert.equal((openGame.match(/globalTree=null/g)||[]).length,1,"openGame ne doit invalider l'arbre qu'à l'intérieur du garde de filtre");

console.log("V0.9.25 OPEN-GAME GLOBAL-TREE REGRESSION TEST OK");
