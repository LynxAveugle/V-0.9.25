import fs from 'node:fs';

const html = fs.readFileSync('./index.html','utf8');
const css = fs.readFileSync('./styles.css','utf8');

function assert(condition, message){ if(!condition) throw new Error(message); }

assert(html.includes('class="analysisHeader"'), 'analysis header missing');
assert(html.includes('id="analysisBackBtn"'), 'analysis back button missing');
assert(html.includes('class="analysisLayout"'), 'analysis two-column layout missing');
assert(html.includes('class="analysisSide"'), 'analysis side panel missing');
assert(html.includes('id="analysisMoves"'), 'analysis moves panel missing');
assert(html.includes('id="analysisEval"'), 'analysis evaluation card missing');
assert(html.includes('id="analysisBest"'), 'analysis best moves card missing');
assert(html.includes('id="rotateBoardBtn"'), 'rotate board button missing');
assert(html.includes('class="analysisAnnotationCard"'), 'analysis annotation card missing');
assert(css.includes('.analysisHeader'), 'analysis header styles missing');
assert(css.includes('.analysisLayout'), 'analysis layout styles missing');
assert(css.includes('.analysisSide'), 'analysis side styles missing');
assert(css.includes('@media(max-width:799px)'), 'mobile analysis breakpoint missing');
console.log('ANALYSIS UI TESTS OK');
