import fs from 'node:fs';

const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');

if(!app.includes('target[a]=(target[a]||0)+1')) throw new Error('annotation counts do not increment');
if(app.includes('if(gm&&!edge.annotationApplied)')) throw new Error('annotationApplied guard still blocks per-game aggregation');
if(!app.includes('const gameAnnotations=analysisChild?.annotations||[]')) throw new Error('global tree does not aggregate current-game annotations');
if(!app.includes('for(const a of new Set(gameAnnotations))counts[annotationKind(a)]++')) throw new Error('annotation kind counts are not deduplicated per game');

// Execute the same accumulation contract independently of the application DOM.
const mergeSource=app.match(/function mergeAnnotationCounts\(target,annotations\)\{[^}]+\}/)?.[0];
if(!mergeSource) throw new Error('mergeAnnotationCounts not found');
const merge=Function(`${mergeSource}; return mergeAnnotationCounts`)();
const counts={};
merge(counts,['!','?','!']);
merge(counts,['!','❌']);
if(counts['!']!==2||counts['?']!==1||counts['❌']!==1) throw new Error(`unexpected aggregate: ${JSON.stringify(counts)}`);

console.log('ANNOTATION AGGREGATION REGRESSION TESTS OK');
