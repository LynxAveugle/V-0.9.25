import {Chess} from "./chess.js";
import {APP_VERSION,DATA_SCHEMA_VERSION} from "./version.js";
import {PIECE_DATA} from "./piece-assets.js";
import {parsePGN,exportPGN,headersFrom,splitGames,openingLineUltraFast} from "./pgn.js";
import {getAll,put,putMany,remove,clearAll,replaceAll,migrateLegacy,requestPersistence,estimateStorage} from "./db.js";

const DEFAULT_USER="HighTaxi";
const ANNOTATION_DEFS=[
  {icon:"!!",label:"Excellent / décisif",kind:"good",nag:3},
  {icon:"!",label:"Bon coup",kind:"good",nag:1},
  {icon:"★",label:"Coup brillant",kind:"good",nag:3},
  {icon:"👍",label:"Bon coup",kind:"good",nag:1},
  {icon:"✓",label:"Coup correct",kind:"good",nag:null},
  {icon:"📖",label:"Coup théorique",kind:"neutral",nag:null},
  {icon:"?!",label:"Coup douteux",kind:"bad",nag:6},
  {icon:"?",label:"Erreur",kind:"bad",nag:2},
  {icon:"❌",label:"Mauvais coup",kind:"bad",nag:2},
  {icon:"??",label:"Grosse erreur",kind:"bad",nag:4}
];
const CHESS_DRAW_RESULTS=new Set(["agreed","stalemate","repetition","insufficient","timevsinsufficient","50move","50_moves","draw"]);
const CHESS_SYNC_KEY="ht_chess_sync_archives_v3";
const CHESS_SYNC_STATUS_KEY="ht_chess_sync_status_v1";
function loadSyncStatus(){try{return JSON.parse(localStorage.getItem(CHESS_SYNC_STATUS_KEY)||"null")}catch{return null}}
function saveSyncStatus(status){try{localStorage.setItem(CHESS_SYNC_STATUS_KEY,JSON.stringify(status))}catch{}}
function renderSyncStatus(){const el=$("syncStatus");if(!el)return;const s=loadSyncStatus();if(!s){el.textContent="Aucune synchronisation effectuée";return}const when=s.at?new Date(s.at).toLocaleString("fr-FR"):"inconnue";el.textContent=`Dernière sync : ${s.ok?"réussie":"échouée"} · ${when}${s.message?` · ${s.message}`:""}`;}
let allGames=[],activeGame=null,currentNode=null,chess=new Chess(),selectedSquare=null,lastMove=null;
let globalTree=null,globalTreeBuilding=false,globalTreeBuiltFor=0,globalTreeProgress={done:0,total:0},globalTreeSideFilter="all",globalTreePendingFilter=null,analysisScope="all";
let dataRevision=0,trainingCacheRevision=-1,trainingCache=[];
let pgnRenderToken=0;
let persistTimer=null,engineWorker=null,engineReadyPromise=null,engineSearchToken=0,engineLastFen="",enginePendingFen=null,engineBusy=false,engineUnavailable=false,clubState=null;
let gameSearch="",gameSearchTimer=null,gameResultFilter="all",gameColorFilter="all",gameSourceFilter="all",gameRenderLimit=100;
let globalMoveAnnotations=loadGlobalMoveAnnotations();
let appSettings={autoEngine:true,showArrows:true,compactMoves:false,chesscomUser:DEFAULT_USER};
try{appSettings={...appSettings,...JSON.parse(localStorage.getItem("ht_settings_v2")||"{}")}}catch{}
appSettings.chesscomUser=String(appSettings.chesscomUser||DEFAULT_USER).trim()||DEFAULT_USER;
function currentUser(){return appSettings.chesscomUser;}
function saveAppSettings(){try{localStorage.setItem("ht_settings_v2",JSON.stringify(appSettings))}catch{}}
function migrateBackupGames(games,schemaVersion){
  let out=games.map(g=>({...g}));
  const from=Math.max(1,Number(schemaVersion||1));
  if(from<=1)out=out.map(g=>({...g,source:g.source||"PGN",analysisTree:g.analysisTree||null,annotationCount:Number(g.annotationCount||0)}));
  if(from<=2)out=out.map(g=>({...g,updatedAt:Number(g.updatedAt||((Number(g.timestamp)||0)*1000)||Date.now())}));
  return out;
}


const $=id=>document.getElementById(id);
function toast(t){const x=$("toast");x.textContent=t;x.style.display="block";clearTimeout(window._toast);window._toast=setTimeout(()=>x.style.display="none",3200)}
function nav(id){
  if(id!=="boardScreen"&&document.body.classList.contains("analysisActive"))scheduleBackgroundPersist();
  document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));
  $(id).classList.add("active");
  document.body.classList.toggle("analysisActive",id==="boardScreen");
  document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b.dataset.screen===id));
  if(id==="home")renderHome();
  if(id==="games"){renderGames();renderPgnCollections();}
  if(id==="boardScreen"){renderBoard();if(!globalTree&&!globalTreeBuilding)setTimeout(()=>buildGlobalTree(),0);onPositionChanged();}
  if(id==="stats")renderStats();
  if(id==="training")renderTraining();
}
document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>nav(b.dataset.screen)));
$("gameSearch")?.addEventListener("input",e=>{gameSearch=e.target.value;gameRenderLimit=100;clearTimeout(gameSearchTimer);gameSearchTimer=setTimeout(renderGames,180)});
$("gameResultFilter")?.addEventListener("change",e=>{gameResultFilter=e.target.value;gameRenderLimit=100;renderGames()});
$("gameColorFilter")?.addEventListener("change",e=>{gameColorFilter=e.target.value;gameRenderLimit=100;renderGames()});
$("gameSourceFilter")?.addEventListener("change",e=>{gameSourceFilter=e.target.value;gameRenderLimit=100;renderGames()});

let pgnColor="w";
function gamesForPgnColor(){return sorted().filter(g=>userSide(g)===pgnColor);}
const recreatedPgnCache=new Map();
function recreatedPgn(g){
  const cacheKey=String(g.updatedAt||0);
  const cached=recreatedPgnCache.get(String(g.id));
  if(cached?.key===cacheKey)return cached.value;
  try{const parsed=parsePGN(g.pgn||"")[0];if(!parsed)return "";if(g.analysisTree){parsed.root=restoreTree(g.analysisTree);parsed.startFen=parsed.root.fen;}const value=exportPGN(parsed);recreatedPgnCache.set(String(g.id),{key:cacheKey,value});return value}catch{return ""}
}
function renderPgnCollections(){
  const token=++pgnRenderToken,games=gamesForPgnColor(),title=$("pgnPanelTitle");
  if(title)title.textContent=pgnColor==="w"?"HighTaxi avec les Blancs":"HighTaxi avec les Noirs";
  const a=$("originalPgnCollection"),b=$("recreatedPgnCollection");
  if(a)a.value=games.map(g=>String(g.pgn||"").trim()).filter(Boolean).join("\n\n");
  if(b)b.value="Génération du PGN recréé…";
  document.querySelectorAll(".pgnTab").forEach(x=>x.classList.toggle("active",x.dataset.pgnColor===pgnColor));
  let index=0,out=[];
  const step=()=>{if(token!==pgnRenderToken)return;const end=Math.min(index+8,games.length);for(;index<end;index++){const value=recreatedPgn(games[index]);if(value)out.push(value)}if(b)b.value=out.join("\n\n");if(index<games.length)setTimeout(step,0)};
  setTimeout(step,0);
}
async function copyPgnOutput(id){const el=$(id);if(!el)return;try{await navigator.clipboard.writeText(el.value);}catch{el.focus();el.select();document.execCommand("copy");}toast("PGN copié");}
document.querySelectorAll(".pgnTab").forEach(b=>b.addEventListener("click",()=>{pgnColor=b.dataset.pgnColor;renderPgnCollections();}));
$("copyOriginalPgn")?.addEventListener("click",()=>copyPgnOutput("originalPgnCollection"));
$("copyRecreatedPgn")?.addEventListener("click",()=>copyPgnOutput("recreatedPgnCollection"));
function ts(g){return Number(g.timestamp||0)||0}
function sorted(){return [...allGames].sort((a,b)=>ts(b)-ts(a))}
function safeGames(){return Array.isArray(allGames)?allGames:[]}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function loadGlobalMoveAnnotations(){try{const raw=localStorage.getItem("ht_global_move_annotations_v1");const data=raw?JSON.parse(raw):{};return data&&typeof data==="object"?data:{}}catch{return {}}}
function saveGlobalMoveAnnotations(){try{localStorage.setItem("ht_global_move_annotations_v1",JSON.stringify(globalMoveAnnotations))}catch{}}
function globalMoveKey(parentFen,move){const m=typeof move==="string"?null:move;return `${positionKeyFromFen(parentFen)}|${m?`${m.from}-${m.to}-${m.promotion||""}`:String(move)}`}
function legacyGlobalMoveKey(parentFen,san){return `${positionKeyFromFen(parentFen)}|${san}`}
function annotationKind(a){
  const def=ANNOTATION_DEFS.find(x=>x.icon===a);
  if(def)return def.kind;
  if(["❌","⚠️"].includes(a))return "bad";
  if(["⭐","💡","🎯"].includes(a))return "good";
  return "neutral";
}
function annotationDef(a){return ANNOTATION_DEFS.find(x=>x.icon===a)||{icon:a,label:"Annotation personnelle",kind:annotationKind(a),nag:null}}
function mergeAnnotationCounts(target,annotations){for(const a of new Set(annotations||[]))target[a]=(target[a]||0)+1}
function findMoveBySan(fen,san){try{const c=new Chess(fen);for(const m of c.legalMoves())if(c.san(m)===san)return m}catch{}return null}

const CHESSCOM_BASE="https://api.chess.com/pub";
const CHESSCOM_TIMEOUT_MS=25000;

async function fetchWithTimeout(url,options={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),options.timeout||CHESSCOM_TIMEOUT_MS);
  try{
    return await fetch(url,{...options,signal:controller.signal,mode:"cors",cache:"no-store"});
  }catch(e){
    if(e?.name==="AbortError")throw new Error("Délai dépassé");
    throw e;
  }finally{clearTimeout(timer)}
}

async function fetchChessComJson(url){
  try{
    const r=await fetchWithTimeout(url,{headers:{Accept:"application/json"}});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }catch(e){
    throw new Error(`Connexion directe à Chess.com impossible (${e.message}). Vérifie la connexion Internet et que l’API publique Chess.com autorise encore les requêtes navigateur.`);
  }
}

async function fetchChessComPgn(archiveUrl){
  const url=`${String(archiveUrl).replace(/\/$/,"")}/pgn`;
  try{
    const r=await fetchWithTimeout(url,{headers:{Accept:"application/x-chess-pgn,text/plain,*/*"}});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    return await r.text();
  }catch(e){
    throw new Error(`Archive Chess.com inaccessible (${e.message})`);
  }
}

function chessComMonthKey(url){
  const m=String(url).match(/\/games\/(\d{4})\/(\d{2})\/?$/);
  return m?`${m[1]}/${m[2]}`:String(url);
}
function chessComPgnIsStandard(h){
  const variant=String(h.Variant||h.Rules||"").trim().toLowerCase();
  return !variant||variant==="standard"||variant==="chess";
}

function hashId(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}return `pgn-${(h>>>0).toString(16)}-${text.length}`}
function chessComStableId(game,pgn){const raw=String(game?.url||"");const m=raw.match(/\/(?:live|daily|game)\/(\d+)/i);if(m)return `chesscom-${m[1]}`;if(game?.uuid)return `chesscom-${game.uuid}`;return hashId(`Chess.com|${pgn}`)}

async function migrateChessComStableIds(){
  const games=await getAll();
  const chessGames=games.filter(g=>g.source==="Chess.com");
  if(!chessGames.length)return 0;
  const byId=new Map(games.map(g=>[String(g.id),g]));
  const updates=[],deletes=[];let changed=0;
  for(const g of chessGames){
    const target=chessComStableId(g,g.pgn||"");
    if(!target||String(g.id)===target)continue;
    const existing=byId.get(target);
    if(existing&&existing!==g){
      const keep=(existing.analysisTree||existing.annotationCount>0)?existing:g;
      const other=keep===existing?g:existing;
      const merged={...other,...keep,id:target};
      if((other.annotationCount||0)>(keep.annotationCount||0))merged.annotationCount=other.annotationCount;
      if(!merged.analysisTree&&(other.analysisTree||keep.analysisTree))merged.analysisTree=other.analysisTree||keep.analysisTree;
      merged.updatedAt=Math.max(keep.updatedAt||0,other.updatedAt||0);
      updates.push(merged);
      deletes.push(g.id);
      byId.set(target,merged);changed++;
    }else{
      const migrated={...g,id:target,updatedAt:g.updatedAt||Date.now()};
      updates.push(migrated);deletes.push(g.id);byId.delete(String(g.id));byId.set(target,migrated);changed++;
    }
  }
  if(updates.length)await putMany(updates);
  for(const id of deletes)await remove(id);
  return changed;
}
function userSide(g){if(!g)return null;const w=String(g.white||"").trim().toLowerCase()===currentUser().toLowerCase(),b=String(g.black||"").trim().toLowerCase()===currentUser().toLowerCase();return w&&!b?"w":b&&!w?"b":null}
function resultForUser(g){
  const r=g.result||"*",side=userSide(g); if(!side||r==="*")return "unknown"; if(r==="1/2-1/2")return "draw"; return (side==="w"&&r==="1-0")||(side==="b"&&r==="0-1")?"win":"loss";
}
function parseTimestamp(h,fallback){
  if(h.UTCDate&&h.UTCTime){const d=Date.parse(`${h.UTCDate.replace(/\./g,"-")}T${h.UTCTime.replace(/\./g,":")}Z`);if(Number.isFinite(d))return d/1000}
  if(h.Date){const d=Date.parse(h.Date.replace(/\./g,"-"));if(Number.isFinite(d))return d/1000}
  return fallback;
}
function openingName(value){
  const raw=String(value||"").trim();
  if(!raw)return "";
  try{
    const u=new URL(raw);
    if(/chess\.com$/i.test(u.hostname)&&u.pathname.startsWith("/openings/")){
      const slug=u.pathname.split("/").filter(Boolean).pop()||"";
      return decodeURIComponent(slug).replace(/-/g," ").replace(/\s+/g," ").trim();
    }
  }catch{}
  return raw;
}
function normalizeChessResult(game,h){
  const pgnResult=String(h.Result||"").trim();
  if(["1-0","0-1","1/2-1/2","*"].includes(pgnResult))return pgnResult;
  const wr=String(game?.white?.result||"").toLowerCase(),br=String(game?.black?.result||"").toLowerCase();
  if(CHESS_DRAW_RESULTS.has(wr)||CHESS_DRAW_RESULTS.has(br))return "1/2-1/2";
  if(wr==="win"||br==="win")return wr==="win"?"1-0":"0-1";
  if(wr==="checkmated"||wr==="timeout"||wr==="resigned"||wr==="abandoned")return "0-1";
  if(br==="checkmated"||br==="timeout"||br==="resigned"||br==="abandoned")return "1-0";
  return "*";
}
function mainlineSignature(root){const out=[];let n=root;while(n?.children?.[0]){n=n.children[0];out.push(n.san)}return out.join(" ")}
function validateParsedGame(parsed){
  if(!parsed?.root)throw new Error("Partie sans arbre de coups");
  const c=new Chess(parsed.startFen||Chess.START_FEN);
  if(!c.king("w")||!c.king("b"))throw new Error("FEN de départ invalide : roi manquant");
  const st=c.status();
  if(!Number.isInteger(st.legal)||st.legal<0)throw new Error("Position de départ incohérente");
}
function gameIdentity(source,parsed,headers){return hashId(`${source}|${headers.Link||headers.URL||""}|${headers.White||""}|${headers.Black||""}|${headers.Date||""}|${headers.UTCDate||""}|${headers.UTCTime||""}|${headers.Round||""}|${headers.Result||"*"}|${parsed.startFen||Chess.START_FEN}|${mainlineSignature(parsed.root)}`)}
function metaFromHeaders(h,source,fallback,pgn,extra={}){return {id:hashId(`${source}|${pgn}`),source,timestamp:parseTimestamp(h,fallback),date:h.Date||"",time:h.UTCTime||"",white:h.White||"?",black:h.Black||"?",result:h.Result||"*",eco:openingName(h.ECO||""),time_control:h.TimeControl||"",event:h.Event||"",site:h.Site||"",round:h.Round||"",pgn,analysisTree:null,annotationCount:0,...extra}}
function serializeTree(root){
  function clean(n){return {move:n.move||null,san:n.san||null,fen:n.fen,annotations:[...(n.annotations||[])],comment:n.comment||"",note:n.note||"",clock:n.clock||null,nags:[...(n.nags||[])],children:(n.children||[]).map(clean)}}
  return clean(root)
}
function restoreTree(data,parent=null){
  const n={id:crypto.randomUUID(),parent,children:[],move:data.move||null,san:data.san||null,fen:data.fen,annotations:[...(data.annotations||[])],comment:data.comment||"",note:data.note||"",clock:data.clock||null,nags:[...(data.nags||[])]};
  n.children=(data.children||[]).map(c=>restoreTree(c,n));return n;
}
function countAnnotations(n){let x=(n.annotations?.length||0)+(n.note?.trim()?1:0);for(const c of n.children||[])x+=countAnnotations(c);return x}
function findNode(root,id){if(root.id===id)return root;for(const c of root.children||[]){const f=findNode(c,id);if(f)return f}return null}

const openingPrefixCache=new Map();
function openingPrefixForGame(g,maxPlies=24){
  const id=String(g.id);
  const key=String(g.pgn||"");
  const cached=openingPrefixCache.get(id);
  if(cached?.key===key&&cached.maxPlies===maxPlies)return cached.line;
  let line=[];
  try{line=openingLineUltraFast(key,maxPlies).out||[]}catch{}
  openingPrefixCache.set(id,{key,maxPlies,line});
  return line;
}

function positionKeyFromFen(fen){
  const p=String(fen||"").trim().split(/\s+/); if(p.length<4)return fen;
  let ep=p[3];
  if(ep!=="-"){
    const f="abcdefgh".indexOf(ep[0]), targetRank=Number(ep[1]), sourceRank=p[1]==="w"?5:4, expectedTarget=p[1]==="w"?6:3;
    let ok=false;
    if(f>=0&&targetRank===expectedTarget){
      const row=p[0].split("/")[8-sourceRank], wanted=p[1]==="w"?"P":"p"; let file=0;
      for(const ch of row){if(/\d/.test(ch))file+=Number(ch);else{if((file===f-1||file===f+1)&&ch===wanted)ok=true;file++;}}
    }
    if(!ok)ep="-";
  }
  return [p[0],p[1],p[2],ep].join(" ");
}
async function buildGlobalTree(){
  if(globalTreeBuilding)return;
  const filterKey=globalTreeSideFilter;
  if(globalTree&&globalTreeBuiltFor===dataRevision&&globalTree._filter===filterKey)return;
  globalTreeBuilding=true;
  const games=safeGames().filter(g=>g.pgn&&(!globalTreeSideFilter||globalTreeSideFilter==="all"||userSide(g)===globalTreeSideFilter));
  globalTreeProgress={done:0,total:games.length};
  renderGlobalTree(currentNode?.fen||Chess.START_FEN);
  const nodes=new Map();
  const getNode=(key,fen,gameId=null,ply=0)=>{let n=nodes.get(key);if(!n){n={key,fen,count:0,children:new Map(),incoming:new Map(),sampleGameId:gameId,samplePly:ply};nodes.set(key,n)}else if(!n.sampleGameId&&gameId){n.sampleGameId=gameId;n.samplePly=ply}return n};
  getNode(positionKeyFromFen(Chess.START_FEN),Chess.START_FEN);
  const BATCH=20, MAX_PLIES=24;
  const resultBucket=(g)=>g.result==="1-0"?"white":g.result==="0-1"?"black":g.result==="1/2-1/2"?"draw":null;
  try{
    for(let i=0;i<games.length;i+=BATCH){
      const end=Math.min(i+BATCH,games.length);
      for(let j=i;j<end;j++){
        const g=games[j];
        let line=[];
        line=openingPrefixForGame(g,MAX_PLIES)
        const startFen=line[0]?.from||Chess.START_FEN;
        let parent=getNode(positionKeyFromFen(startFen),startFen,g.id,0);
        parent.count++;
        const bucket=resultBucket(g);
        const analysisRoot=g.analysisTree?restoreTree(g.analysisTree):null;
        let analysisNode=analysisRoot;
        const seen=new Set([parent.key]),seenEdges=new Set();
        for(const step of line){
          const child=getNode(positionKeyFromFen(step.fen),step.fen,g.id,parent.count);
          const moveKey=`${step.move?.from||""}-${step.move?.to||""}-${step.move?.promotion||""}`;
          let edge=parent.children.get(moveKey);
          if(!edge){edge={node:child,san:step.san,move:step.move,count:0,stats:{white:0,draw:0,black:0},sampleGameId:g.id,playedByUser:0,annotations:{},good:0,bad:0,neutral:0};parent.children.set(moveKey,edge)}
          const edgeSeenKey=`${parent.key}|${moveKey}`;
          if(!seenEdges.has(edgeSeenKey)){
            seenEdges.add(edgeSeenKey);
            edge.count++;
            if(bucket)edge.stats[bucket]++;
            const turn=String(step.from||"").trim().split(/\s+/)[1]||"";
            if((turn==="w"&&userSide(g)==="w")||(turn==="b"&&userSide(g)==="b"))edge.playedByUser++;
            const moveKeyGlobal=globalMoveKey(step.from,step.move);
            let gm=globalMoveAnnotations[moveKeyGlobal]||globalMoveAnnotations[legacyGlobalMoveKey(step.from,step.san)];
            const analysisChild=analysisNode?.children?.find(n=>n.san===step.san);
            if(!gm&&analysisChild&&(analysisChild.annotations?.length||analysisChild.note?.trim())){
              const anns=[...(analysisChild.annotations||[])];const counts={good:0,bad:0,neutral:0};anns.forEach(a=>counts[annotationKind(a)]++);
              gm={annotations:anns,kindCounts:counts};globalMoveAnnotations[moveKeyGlobal]=gm;
            }
            // Aggregate annotations from the current game's analysis tree.
            // Each game reaches this block at most once per edge via seenEdges,
            // so every distinct game contributes exactly once to the global count.
            const gameAnnotations=analysisChild?.annotations||[];
            if(gameAnnotations.length){
              mergeAnnotationCounts(edge.annotations,gameAnnotations);
              const counts={good:0,bad:0,neutral:0};
              for(const a of new Set(gameAnnotations))counts[annotationKind(a)]++;
              edge.good+=counts.good;edge.bad+=counts.bad;edge.neutral+=counts.neutral;
            }
            analysisNode=analysisChild||null;
          }
          child.incoming.set(`${parent.key}|${step.san}`,step.san);
          const wasSeen=seen.has(child.key);
          if(!wasSeen){child.count++;seen.add(child.key);}
          parent=child;
          if(wasSeen)break;
        }
      }
      globalTreeProgress.done=end;
      globalTree={nodes,_filter:filterKey};
      renderGlobalTree(currentNode?.fen||Chess.START_FEN);
      renderMoves();
      await new Promise(r=>setTimeout(r,0));
    }
    saveGlobalMoveAnnotations();
    globalTree={nodes,_filter:filterKey};
    globalTreeBuiltFor=dataRevision;
    renderMoves();
  }finally{
    globalTreeBuilding=false;
    renderGlobalTree(currentNode?.fen||Chess.START_FEN);
    renderMoves();
    if(globalTreePendingFilter!==null && globalTreePendingFilter!==globalTree?._filter){const next=globalTreePendingFilter;globalTreePendingFilter=null;globalTreeSideFilter=next;analysisScope=next;globalTree=null;globalTreeBuiltFor=0;setTimeout(()=>buildGlobalTree(),0);}
  }
}
function gaugeMarkup(stats,total){
  const white=stats?.white||0,draw=stats?.draw||0,black=stats?.black||0,known=white+draw+black;
  if(!known)return `<div class="treeGaugeWrap"><div class="muted">Résultat indisponible</div></div>`;
  const w=Math.round(white/known*100),d=Math.round(draw/known*100),b=Math.max(0,100-w-d),unknown=Math.max(0,(total||0)-known);
  return `<div class="treeGaugeWrap"><div class="treeGauge" aria-label="Blancs ${w} %, nulles ${d} %, Noirs ${b} %"><span class="gWhite" style="width:${w}%"></span><span class="gDraw" style="width:${d}%"></span><span class="gBlack" style="width:${b}%"></span></div><div class="treeGaugeLabels"><span>Bl ${w}%</span><span>= ${d}%</span><span>No ${b}%</span></div>${unknown?`<div class="treeGaugeUnknown">${unknown} résultat(s) inconnu(s)</div>`:""}</div>`;
}

function renderGlobalArrows(fen){
  if(!appSettings.showArrows)return;
  const board=$("board");if(!board||!globalTree)return;
  board.querySelector(".moveArrows")?.remove();
  const node=globalTree.nodes.get(positionKeyFromFen(fen));if(!node?.children?.size)return;
  const sideToMove=String(fen||"").split(/\s+/)[1]||"w";
  const mine=globalTreeSideFilter==="w"||globalTreeSideFilter==="b"?globalTreeSideFilter:userSide(activeGame);
  let edges=[...node.children.values()];
  if(mine===sideToMove){const mineEdges=edges.filter(e=>e.playedByUser>0);if(mineEdges.length)edges=mineEdges;}
  edges=edges.sort((a,b)=>b.playedByUser-a.playedByUser||b.count-a.count).slice(0,12);
  const {files,ranks}=boardSquares();
  const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.classList.add("moveArrows");svg.setAttribute("viewBox","0 0 100 100");svg.setAttribute("aria-hidden","true");
  const defs=document.createElementNS("http://www.w3.org/2000/svg","defs");
  const marker=document.createElementNS("http://www.w3.org/2000/svg","marker");marker.setAttribute("id","htArrow");marker.setAttribute("markerWidth","7");marker.setAttribute("markerHeight","7");marker.setAttribute("refX","6");marker.setAttribute("refY","3.5");marker.setAttribute("orient","auto");
  const path=document.createElementNS("http://www.w3.org/2000/svg","path");path.setAttribute("d","M0,0 L7,3.5 L0,7 z");path.setAttribute("fill","currentColor");marker.appendChild(path);defs.appendChild(marker);svg.appendChild(defs);
  const seen=[];
  const center=s=>{const f=s[0],r=Number(s[1]),col=files.indexOf(f),row=ranks.indexOf(r);return {x:(col+.5)*100,y:(row+.5)*100}};
  for(const e of edges){const m=e.move||findMoveBySan(fen,e.san);if(!m)continue;const a=center(m.from),b=center(m.to);const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;const nx=-dy/len*3.2,ny=dx/len*3.2;const offset=(seen.length-(edges.length-1)/2)*2.4;const x1=a.x+nx*offset,y1=a.y+ny*offset,x2=b.x+nx*offset,y2=b.y+ny*offset;seen.push(e);
    const g=document.createElementNS("http://www.w3.org/2000/svg","g");g.classList.add(...["moveArrow",e.playedByUser?"mine":"opponent",e.bad?"hasBad":"",e.good?"hasGood":""].filter(Boolean));
    const line=document.createElementNS("http://www.w3.org/2000/svg","line");line.setAttribute("x1",x1);line.setAttribute("y1",y1);line.setAttribute("x2",x2);line.setAttribute("y2",y2);line.setAttribute("marker-end","url(#htArrow)");line.setAttribute("stroke","currentColor");line.setAttribute("stroke-width",e.playedByUser?7:5);line.setAttribute("stroke-linecap","round");line.setAttribute("vector-effect","non-scaling-stroke");g.appendChild(line);
    const label=document.createElementNS("http://www.w3.org/2000/svg","text");label.setAttribute("x",(x1+x2)/2+4);label.setAttribute("y",(y1+y2)/2-4);label.setAttribute("text-anchor","middle");label.textContent=e.playedByUser?`${e.san} · ${e.count}`:`${e.san} · ${e.count}`;g.appendChild(label);
    svg.appendChild(g);
  }
  board.appendChild(svg);
}
function renderGlobalTree(fen){
  const box=$("globalTree");if(!box)return;
  if(globalTreeBuilding){const d=globalTreeProgress.done,t=globalTreeProgress.total,p=t?Math.round(d/t*100):0;box.innerHTML=`<div class="treeProgress"><b>Construction de l’arbre global…</b><div class="treeProgressBar"><span style="width:${p}%"></span></div><div class="muted">${d.toLocaleString("fr-FR")} / ${t.toLocaleString("fr-FR")} parties · ${p}%</div></div>`;return}
  if(!globalTree){box.innerHTML='<div class="muted">L’arbre sera construit à partir de ta base.</div>';return}
  const node=globalTree.nodes.get(positionKeyFromFen(fen))||globalTree.nodes.get(positionKeyFromFen(Chess.START_FEN));
  if(!node){box.innerHTML='<div class="muted">Position absente de l’arbre global.</div>';return}
  const edges=[...node.children.values()].sort((a,b)=>b.count-a.count);
  if(!edges.length){box.innerHTML=`<div class="treeTitle">Aucun coup enregistré depuis cette position.</div>`;return}
  const filterLabel=globalTreeSideFilter==="w"?"tes parties avec les Blancs":globalTreeSideFilter==="b"?"tes parties avec les Noirs":"toutes tes parties";
  box.innerHTML=`<div class="analysisScopeTabs" role="tablist"><button class="analysisScopeTab ${globalTreeSideFilter==="all"?"active":""}" data-side="all">Toutes</button><button class="analysisScopeTab ${globalTreeSideFilter==="w"?"active":""}" data-side="w">HighTaxi Blancs</button><button class="analysisScopeTab ${globalTreeSideFilter==="b"?"active":""}" data-side="b">HighTaxi Noirs</button></div><div class="treeTitle">${node.count.toLocaleString("fr-FR")} partie(s) · ${edges.length} prochain(s) coup(s) · ${filterLabel}</div><div class="treeBranches">${edges.map(e=>{const anns=Object.entries(e.annotations||{}).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([a,n])=>`${a}${n>1?`×${n}`:""}`).join(" ");return `<button class="treeBranch" data-fen="${esc(e.node.fen)}" data-game="${esc(e.sampleGameId||"")}"><div class="treeMoveBlock"><span class="treeMove">${esc(e.san)}</span><span class="treeCount">${e.count.toLocaleString("fr-FR")} partie(s)</span>${e.playedByUser?`<span class="treeMine">${e.playedByUser}× par toi</span>`:""}</div>${gaugeMarkup(e.stats,e.count)}<div class="treeAnnotations">${anns||"—"}</div></button>`}).join("")}</div>`;
  box.querySelectorAll(".analysisScopeTab").forEach(b=>b.addEventListener("click",()=>setAnalysisScope(b.dataset.side||"all")));
  box.querySelectorAll(".treeBranch").forEach(b=>b.addEventListener("click",async()=>{renderGlobalTree(b.dataset.fen);if(b.dataset.game){await openGame(b.dataset.game);gotoPositionKey(positionKeyFromFen(b.dataset.fen));}}));
  try{renderGlobalArrows(fen)}catch(err){console.warn("Global arrows disabled for this render",err)}
}

function invalidateGlobalTree(){globalTree=null;globalTreeBuiltFor=0;globalTreeProgress={done:0,total:0};dataRevision++;trainingCacheRevision=-1;trainingCache=[];pgnRenderToken++;}
function renderHome(){
  $("homeGames").textContent=safeGames().length;
  const g=sorted()[0];$("homeLast").textContent=g?`${g.white||"?"} — ${g.black||"?"} · ${g.result||"*"} · ${g.source||"PGN"}`:"Aucune partie";
  const ann=safeGames().reduce((n,g)=>n+(g.annotationCount||0),0);$("homeReview").textContent=ann?`${ann} annotation(s) à revoir`:`Aucune position annotée`;
}
function renderStats(){
  const a=safeGames(),played=a.filter(g=>resultForUser(g)!=="unknown");
  const wins=played.filter(g=>resultForUser(g)==="win").length,draws=played.filter(g=>resultForUser(g)==="draw").length,losses=played.filter(g=>resultForUser(g)==="loss").length;
  $("sGames").textContent=a.length;$("sWins").textContent=wins;$("sDraws").textContent=draws;$("sLoss").textContent=losses;
  const w=a.filter(g=>String(g.white).toLowerCase()===currentUser().toLowerCase()).length,b=a.filter(g=>String(g.black).toLowerCase()===currentUser().toLowerCase()).length;
  $("sColors").textContent=`Blancs ${w} · Noirs ${b} · Non terminées/inconnues ${a.length-played.length}`;
  const openings=new Map();for(const g of a){const key=g.eco||"Inconnue";openings.set(key,(openings.get(key)||0)+1)}
  const top=[...openings.entries()].sort((x,y)=>y[1]-x[1]).slice(0,5),box=$("sOpenings");
  if(box)box.innerHTML=top.length?top.map(([k,v])=>`<div class="statLine"><span>${esc(k)}</span><b>${v}</b></div>`).join(""):"<span class=\"muted\">Aucune donnée</span>";
}
function renderTraining(){
  const box=$("trainingList");if(!box)return;
  if(trainingCacheRevision!==dataRevision){
    const items=[];
    for(const g of safeGames()){
      if(!g.analysisTree)continue;
      try{const root=restoreTree(g.analysisTree);const walk=n=>{for(const c of n.children||[]){if((c.annotations?.length||0)||c.note?.trim())items.push({g,node:c});walk(c)}};walk(root)}catch{}
    }
    trainingCache=items;trainingCacheRevision=dataRevision;
  }
  const items=trainingCache;
  $("trainingText").textContent=items.length?`${items.length} position(s) à revoir.`:"Tes positions annotées apparaîtront ici.";
  if(!items.length){box.innerHTML='<div class="empty">Aucune position annotée. Depuis une partie, ajoute une annotation ou une note.</div>';return}
  box.innerHTML=items.slice(0,100).map((x,i)=>`<button class="trainingItem" data-game="${esc(x.g.id)}" data-fen="${esc(x.node.fen)}"><b>#${i+1} · ${esc(x.g.white||"?")} — ${esc(x.g.black||"?")}</b><span>${esc((x.node.annotations||[]).join(" "))}${x.node.note?.trim()?" · "+esc(x.node.note.trim().slice(0,70)):""}</span></button>`).join("");
  box.querySelectorAll(".trainingItem").forEach(b=>b.addEventListener("click",async()=>{await openGame(b.dataset.game);gotoPositionKey(positionKeyFromFen(b.dataset.fen));}));
}
function renderGames(){
  const query=gameSearch.trim().toLowerCase();
  const a=sorted().filter(g=>{const hay=[g.white,g.black,g.eco,g.date,g.event,g.source,g.time_control].join(" ").toLowerCase();const result=gameResultFilter==="all"||resultForUser(g)===gameResultFilter;const color=gameColorFilter==="all"||userSide(g)===gameColorFilter;const source=gameSourceFilter==="all"||String(g.source||"").toLowerCase()===gameSourceFilter;return(!query||hay.includes(query))&&result&&color&&source});
  const el=$("gameList");if(!a.length){el.innerHTML='<div class="empty">Aucune partie ne correspond aux filtres.</div>';return}
  const visible=a.slice(0,gameRenderLimit);
  el.innerHTML=visible.map(g=>`<div class="game"><button class="gameOpen" data-id="${esc(g.id)}"><b>${esc(g.white||"?")}</b> — <b>${esc(g.black||"?")}</b><div class="meta">${esc(g.result||"*")} · ${esc(g.source||"PGN")} · ${esc(g.date||"")}${g.time_control?" · "+esc(g.time_control):""}${g.eco?" · "+esc(g.eco):""}</div></button><button class="deleteGame" data-id="${esc(g.id)}" title="Supprimer">×</button></div>`).join("");
  if(visible.length<a.length){
    const more=document.createElement("button");
    more.className="loadMoreGames";
    more.type="button";
    more.textContent=`Afficher ${Math.min(100,a.length-visible.length).toLocaleString("fr-FR")} partie(s) de plus · ${visible.length.toLocaleString("fr-FR")} / ${a.length.toLocaleString("fr-FR")}`;
    more.addEventListener("click",()=>{gameRenderLimit+=100;renderGames()});
    el.appendChild(more);
  }
  el.querySelectorAll(".gameOpen").forEach(b=>b.addEventListener("click",()=>openGame(b.dataset.id)));
  el.querySelectorAll(".deleteGame").forEach(b=>b.addEventListener("click",async e=>{e.stopPropagation();const g=allGames.find(x=>String(x.id)===String(b.dataset.id));if(!g)return;if(!confirm(`Supprimer ${g.white} — ${g.black} ?`))return;await remove(g.id);allGames=await getAll();invalidateGlobalTree();if(activeGame?.id===g.id){activeGame=null;currentNode=null;chess=new Chess()}renderGames();renderHome();renderStats();renderTraining();toast("Partie supprimée")}));
}


async function openGame(id){
  await flushPendingPersist();
  saveNoteBeforeNavigation();
  const g=allGames.find(x=>String(x.id)===String(id));if(!g)return;
  try{
    const parsed=parsePGN(g.pgn||"")[0];
    if(!parsed)throw new Error("PGN inexploitable");
    const tree=g.analysisTree?restoreTree(g.analysisTree):parsed.root;
    // Keep the parsed headers/result while replacing only the analysis tree.
    parsed.root=tree; if(g.analysisTree)parsed.startFen=tree.fen;
    activeGame={...g,parsed};currentNode=tree;chess=new Chess(tree.fen);selectedSquare=null;lastMove=null;boardRotated=false;const nextScope=userSide(g)||"all";analysisScope=nextScope;if(globalTreeSideFilter!==nextScope){globalTreeSideFilter=nextScope;globalTree=null;globalTreeBuiltFor=0;globalTreePendingFilter=null;}nav("boardScreen");
  }catch(e){toast("Impossible de charger la partie : "+e.message)}
}
let boardRotated=false;
function boardSquares(){const scopeSide=analysisScope==="w"||analysisScope==="b"?analysisScope:userSide(activeGame);const black=scopeSide==="b";const flip=black!==boardRotated;const files=flip?["h","g","f","e","d","c","b","a"]:["a","b","c","d","e","f","g","h"];const ranks=flip?[1,2,3,4,5,6,7,8]:[8,7,6,5,4,3,2,1];return {files,ranks}}
function pieceSVG(p){
  const key=`${p[0]}${({p:'P',n:'N',b:'B',r:'R',q:'Q',k:'K'})[p[1]]||String(p[1]||'').toUpperCase()}`;
  const src=PIECE_DATA[key]||new URL(`./pieces/${key}.png`,import.meta.url).href;
  return `<img class="pieceSvg ${p[0]==="w"?"whitePiece":"blackPiece"} data-piece="${key}" src="${src}" alt="" draggable="false" aria-hidden="true">`;
}
const PIECE_FALLBACK={wK:"♔",wQ:"♕",wR:"♖",wB:"♗",wN:"♘",wP:"♙",bK:"♚",bQ:"♛",bR:"♜",bB:"♝",bN:"♞",bP:"♟"};
function installPieceFallbacks(container){
  container?.querySelectorAll("img.pieceSvg").forEach(img=>img.addEventListener("error",()=>{
    const span=document.createElement("span");span.className=`pieceFallback ${img.className}`;span.textContent=PIECE_FALLBACK[img.dataset.piece]||"♟";span.setAttribute("aria-hidden","true");img.replaceWith(span);
  },{once:true}));
}
let boardResizeObserver=null;
function syncBoardPixelSize(){
  const board=$("board");if(board){board.style.width="";board.style.height="";}
}
function installBoardResizeObserver(){
  const wrap=document.querySelector(".boardWrap");
  if(!wrap||boardResizeObserver)return;
  boardResizeObserver=new ResizeObserver(()=>syncBoardPixelSize());
  boardResizeObserver.observe(wrap);
  window.addEventListener("orientationchange",()=>setTimeout(syncBoardPixelSize,80));
}

function formatEval(cp,mate){if(mate!==null&&mate!==undefined){const n=Number(mate);if(n===0)return "MATE";return `${n>0?"#":"-#"}${Math.abs(n)}`}const v=Number(cp||0)/100;if(Math.abs(v)<0.005)return "0.00";return `${v>0?"+":""}${v.toFixed(2)}`}
function renderEvalBar(cp=0,mate=null,depth=null){const fill=$("evalFill"),label=$("evalValue"),bar=$("evalBar");if(!fill||!label||!bar)return;const pct=mate!==null?(mate>0?100:0):Math.max(0,Math.min(100,50+50*Math.tanh(Number(cp||0)/500)));fill.style.height=`${pct}%`;label.textContent=formatEval(cp,mate);bar.setAttribute("aria-label",`Évaluation Stockfish ${label.textContent}`);const progress=$("evalProgressFill");if(progress)progress.style.width=`${pct}%`;const depthEl=$("evalDepth");if(depthEl)depthEl.textContent=`Profondeur ${depth||"—"}`;const e=document.querySelector(".evalEngine");if(e)e.textContent=depth?`SF ${depth}`:"STOCKFISH";}
function setEngineUnavailable(message="Stockfish indisponible"){$("evalValue")?.replaceChildren(document.createTextNode("—"));$("engineDiagnosticsText")?.replaceChildren(document.createTextNode(message));const e=document.querySelector(".evalEngine");if(e)e.textContent=message;const b=$("engineRetry");if(b)b.hidden=false;engineUnavailable=true;}
function setEngineReady(){engineUnavailable=false;const b=$("engineRetry");if(b)b.hidden=true;}
function uciToSan(fen,uci){try{if(!uci||uci.length<4)return uci||"—";const c=new Chess(fen);const move={from:uci.slice(0,2),to:uci.slice(2,4)};if(uci.length>4)move.promotion=uci[4];return c.san(move)}catch{return uci||"—"}}
function handleEngineLine(line,token){
  if(line.includes("HighTaxi engine load error")){setEngineUnavailable(line);return}
  if(token!==engineSearchToken||!line.startsWith("info ")||!line.includes(" score "))return;
  if(/\b(lowerbound|upperbound)\b/.test(line))return;
  const mcp=line.match(/ score cp (-?\d+)/),mm=line.match(/ score mate (-?\d+)/),md=line.match(/ depth (\d+)/),mpv=line.match(/\s+pv\s+([^\s]+)/);if(!mcp&&!mm)return;
  let cp=mcp?Number(mcp[1]):0,mate=mm?Number(mm[1]):null;
  try{const turn=new Chess(engineLastFen).turn;if(turn==="b"){cp=-cp;if(mate!==null)mate=-mate}}catch{}
  renderEvalBar(cp,mate,md?Number(md[1]):null);
  const best=$("bestMovePrimary");if(best&&mpv)best.textContent=uciToSan(engineLastFen,mpv[1]);
  const bestEval=$("bestMoveEval");if(bestEval)bestEval.textContent=formatEval(cp,mate);
}
function startEngineSearch(fen){
  if(!engineWorker||!engineReadyPromise)return;
  const token=engineSearchToken;
  enginePendingFen=null;engineLastFen=fen;engineBusy=true;setEngineReady();
  try{engineWorker.postMessage(`position fen ${fen}`);engineWorker.postMessage("go depth 16")}catch(e){engineBusy=false;setEngineUnavailable(e.message)}
}
function ensureEngine(){
  if(engineReadyPromise)return engineReadyPromise;
  engineReadyPromise=new Promise((resolve,reject)=>{
    const workerCandidates=[
      {
        js:new URL("./stockfish/stockfish-18-lite-single.js",import.meta.url).href,
        wasm:new URL("./stockfish/stockfish-18-lite-single.wasm",import.meta.url).href,
        label:"local Stockfish 18",
        local:true
      },
      {
        js:"https://cdn.jsdelivr.net/npm/stockfish@18.0.8/bin/stockfish-18-lite-single.js",
        wasm:"https://cdn.jsdelivr.net/npm/stockfish@18.0.8/bin/stockfish-18-lite-single.wasm",
        label:"jsDelivr Stockfish 18"
      },
      {
        js:"https://github.com/nmrugg/stockfish.js/releases/download/v18.0.8/stockfish-18-lite-single.js",
        wasm:"https://github.com/nmrugg/stockfish.js/releases/download/v18.0.8/stockfish-18-lite-single.wasm",
        label:"GitHub Stockfish 18"
      }
    ];
    let candidateIndex=0;
    const makeWorker=()=>{
      const c=workerCandidates[candidateIndex];
      // Always use the same-origin bootstrap worker. It imports the Stockfish
      // runtime inside the worker and keeps the WASM URL in the worker hash.
      // This is more reliable on GitHub Pages/iOS than constructing the
      // Stockfish worker directly from a script URL with a fragment.
      const base=new URL("./stockfish-worker.js",import.meta.url);
      base.search=`?engine=${encodeURIComponent(c.js)}&label=${encodeURIComponent(c.label)}`;
      base.hash=`${encodeURIComponent(c.wasm)},worker`;
      return new Worker(base);
    };
    const w=makeWorker();engineWorker=w;let ready=false,done=false;
    const fail=(err)=>{
      if(done)return;
      done=true;engineBusy=false;
      try{w.terminate()}catch{}
      engineWorker=null;engineReadyPromise=null;setEngineUnavailable(err?.message||"Stockfish indisponible");
      reject(err);
    };
    const timer=setTimeout(()=>fail(new Error("Stockfish ne répond pas")),20000);
    w.onmessage=e=>{
      const msg=e.data;
      const line=typeof msg==="string"?msg:msg?.line||"";
      const token=typeof msg==="string"?engineSearchToken:Number(msg?.token);
      if(line.includes("HighTaxi engine load error")){fail(new Error(line));return}
      if($("engineDiagnosticsText")&&line)$("engineDiagnosticsText").textContent=line;
      if(line.includes("uciok")){
        w.postMessage("setoption name MultiPV value 1");
        w.postMessage("isready");
      }
      if(line.includes("readyok")&&!ready){
        ready=true;done=true;clearTimeout(timer);setEngineReady();resolve(w);
        if(enginePendingFen&&!engineBusy)startEngineSearch(enginePendingFen);
      }
      if(line.startsWith("bestmove")){
        engineBusy=false;
        const next=enginePendingFen;enginePendingFen=null;
        if(next)startEngineSearch(next);
      }
      handleEngineLine(line,token);
    };
    w.onerror=()=>{
      if(done)return;
      if(candidateIndex<workerCandidates.length-1){
        candidateIndex++;
        try{w.terminate()}catch{}
        engineWorker=null;engineReadyPromise=null;
        setTimeout(()=>{
          ensureEngine().then(()=>{
            if(enginePendingFen&&!engineBusy)startEngineSearch(enginePendingFen);
          }).catch(()=>{});
        },0);
        return;
      }
      fail(new Error("Moteur indisponible"));
    };
    try{w.postMessage("uci")}catch(e){fail(e)}
  }).catch(e=>{setEngineUnavailable(e.message);throw e});
  return engineReadyPromise;
}

function scheduleEngineAnalysis(fen){
  if(!fen||!appSettings.autoEngine)return;
  if(engineUnavailable)return;
  if(engineLastFen===fen&&engineBusy)return;
  if(engineLastFen===fen&&!engineBusy&&engineWorker)return;
  engineSearchToken++;
  enginePendingFen=fen;
  if(engineWorker&&engineBusy){try{engineWorker.postMessage("stop")}catch{};return}
  ensureEngine().then(()=>{if(enginePendingFen&&!engineBusy)startEngineSearch(enginePendingFen)}).catch(()=>{});
}
function onPositionChanged(){if(currentNode?.fen)scheduleEngineAnalysis(currentNode.fen);}
$("engineRetry")?.addEventListener("click",()=>{engineUnavailable=false;engineReadyPromise=null;engineWorker=null;enginePendingFen=currentNode?.fen||Chess.START_FEN;engineSearchToken++;ensureEngine().then(()=>{if(enginePendingFen&&!engineBusy)startEngineSearch(enginePendingFen)}).catch(()=>{})});

function renderAnalysisScope(){
  const box=$("analysisScopeBar");if(!box)return;
  const current=analysisScope;
  box.querySelectorAll(".analysisScopeTopTab").forEach(b=>b.classList.toggle("active",b.dataset.side===current));
  const label=current==="w"?"HighTaxi — Blancs":current==="b"?"HighTaxi — Noirs":"Toutes les parties";
  const hint=$("analysisScopeHint");if(hint)hint.textContent=label;
}
function setAnalysisScope(side){
  const next=side==="w"||side==="b"?side:"all";
  if(next===analysisScope){renderAnalysisScope();return;}
  analysisScope=next;globalTreeSideFilter=next;analysisScope=next;globalTree=null;globalTreeBuiltFor=0;globalTreePendingFilter=null;
  renderAnalysisScope();renderBoard();
  if(!globalTreeBuilding)buildGlobalTree();
}
function renderBoard(){
  const board=$("board");if(!board)return;board.innerHTML="";renderAnalysisScope();
  if(!currentNode){currentNode={fen:Chess.START_FEN,children:[],annotations:[],comment:"",note:"",nags:[]};chess=new Chess();}
  const {files,ranks}=boardSquares(),legal=new Set(selectedSquare?chess.legalMoves(selectedSquare).map(m=>m.to):[]);
  for(let row=0;row<8;row++)for(let col=0;col<8;col++){
    const file=files[col],rank=ranks[row],s=file+rank,x="abcdefgh".indexOf(file),y=Number(rank)-1;
    const d=document.createElement("div");d.className=`square ${((x+y)%2===0)?"dark":"light"}`;d.dataset.square=s;
    if(s===selectedSquare)d.classList.add("selected");if(lastMove?.includes(s))d.classList.add("last");if(legal.has(s))d.classList.add(chess.board[s]?"capture":"legal");
    const p=chess.board[s];if(p)d.insertAdjacentHTML("beforeend",pieceSVG(p));
    const nodeAnno=currentNode?.annotations||[];
    if(nodeAnno.length && currentNode?.move && currentNode.move.to===s){
      const badge=document.createElement("span");const lastDef=annotationDef(nodeAnno[nodeAnno.length-1]);badge.className=`squareAnnotation ${lastDef.kind}`;badge.dataset.annotation=lastDef.icon;badge.textContent=lastDef.icon;badge.title=nodeAnno.join(" ");d.appendChild(badge);
    }
    if(currentNode?.note?.trim() && currentNode?.move?.to===s){
      const note=document.createElement("span");note.className="squareNote";note.textContent="✎";note.title=currentNode.note.trim();d.appendChild(note);
    }
    if(row===7){const c=document.createElement("span");c.className="coord file";c.textContent=file;d.appendChild(c)}
    if(col===0){const c=document.createElement("span");c.className="coord rank";c.textContent=rank;d.appendChild(c)}
    board.appendChild(d);
  }
  installPieceFallbacks(board);
  const st=chess.status();$("position").textContent=st.checkmate?"Échec et mat":st.stalemate?"Pat":`${st.check?"Échec · ":""}Trait aux ${chess.turn==="w"?"Blancs":"Noirs"}`;
  $("boardPlayers").textContent=activeGame?`${activeGame.white||"?"} — ${activeGame.black||"?"} · ${activeGame.result||"*"}`:"Position initiale · HighTaxi Chess";
  renderMoves();renderAnnotations();renderNav();renderAnalysisMeta();try{renderGlobalTree(currentNode.fen)}catch(err){console.warn("Global tree render failed",err)}
  syncBoardPixelSize();
}
$("board").addEventListener("click",e=>{
  const cell=e.target.closest(".square");if(!cell)return;const s=cell.dataset.square;
  if(!currentNode)return;
  if(selectedSquare){
    const candidates=chess.legalMoves(selectedSquare).filter(m=>m.to===s);
    if(candidates.length){
      const existing=currentNode.children?.find(n=>n.move?.from===candidates[0].from&&n.move?.to===candidates[0].to&&String(n.move?.promotion||"")===String(candidates[0].promotion||""));
      if(existing){gotoNode(existing.id);return}
      saveNoteBeforeNavigation();
      let move=candidates[0];if(candidates.length>1){const promo=(prompt("Promotion : Q, R, B ou N","Q")||"Q").toLowerCase();move=candidates.find(m=>m.promotion===promo)||candidates[0]}
      const played=chess.play(move),node={id:crypto.randomUUID(),parent:currentNode,children:[],move,san:played.san,fen:played.fen,annotations:[],comment:"",note:"",clock:null,nags:[]};currentNode.children.push(node);currentNode=node;lastMove=[move.from,move.to];selectedSquare=null;schedulePersistAnalysis();renderBoard();onPositionChanged();return;
    }
  }
  if(chess.board[s]&&chess.board[s][0]===chess.turn){selectedSquare=s;renderBoard()}else{selectedSquare=null;renderBoard()}
});
function currentPath(){const path=[];let n=currentNode;while(n&&n.parent){path.unshift(n);n=n.parent}return path}
function moveOutcomeStats(node){
  if(!globalTree||!node?.parent?.fen||!node?.move)return null;
  const parent=globalTree.nodes.get(positionKeyFromFen(node.parent.fen));
  if(!parent)return null;
  const key=`${node.move.from||""}-${node.move.to||""}-${node.move.promotion||""}`;
  return parent.children.get(key)?.stats||null;
}
function moveGaugeMarkup(stats){
  const white=stats?.white||0,draw=stats?.draw||0,black=stats?.black||0,known=white+draw+black;
  if(!known)return "";
  const w=Math.round(white/known*100),d=Math.round(draw/known*100),b=Math.max(0,100-w-d);
  return `<span class="moveGaugeWrap" aria-label="Après ce coup : Blancs ${w} %, nulles ${d} %, Noirs ${b} %"><span class="moveGauge"><i class="gWhite" style="width:${w}%"></i><i class="gDraw" style="width:${d}%"></i><i class="gBlack" style="width:${b}%"></i></span><span class="moveGaugeLabels"><span>Bl ${w}%</span><span>= ${d}%</span><span>No ${b}%</span></span></span>`;
}
function renderMoves(){
  const root=currentNodeRoot();let html="";
  const walk=(n,d=0)=>{for(const c of n.children||[]){const fields=String(c.parent?.fen||Chess.START_FEN).split(/\s+/),turn=fields[1]||"w",num=Number(fields[5]||1),prefix=d?`↳ `:"",gauge=moveGaugeMarkup(moveOutcomeStats(c));html+=`<button class="move ${c===currentNode?"current":""} ${d?"variationMove":""}" style="margin-left:${Math.min(d,6)*10}px" data-node="${esc(c.id)}"><span class="moveMain">${prefix}${turn==="w"?num+".":num+"..."} ${esc(c.san)}</span>${gauge}</button>`;walk(c,d+1)}};
  walk(root);
  ["moves","analysisMoves"].forEach(id=>{const el=$(id);if(!el)return;el.innerHTML=html||'<span class="muted">Position initiale</span>';const cur=el.querySelector(".move.current");if(cur)requestAnimationFrame(()=>cur.scrollIntoView({block:"nearest",inline:"nearest"}))});
  renderSelectedMoveInsights();
}
function renderAnalysisMeta(){const head=$("annotationHeadline"),summary=$("annotationSummary"),icon=$("annotationIcon");const anns=currentNode?.annotations||[];const defs=anns.map(annotationDef);if(icon)icon.textContent=defs[defs.length-1]?.icon||"♟";if(head)head.textContent=defs.length?defs.map(d=>d.label).join(" · "):currentNode?.san?`${currentNode.san} — position analysée`:"Position initiale";if(summary)summary.textContent=currentNode?.note?.trim()|| (anns.length?`${anns.map(d=>d.icon).join(" ")} · Annotation enregistrée sur cette position.`:"Ajoute une annotation ou une note à cette position.");}
function findNodeByPositionKey(root,key){if(positionKeyFromFen(root?.fen||"")===key)return root;for(const c of root?.children||[]){const found=findNodeByPositionKey(c,key);if(found)return found}return null}
function gotoPositionKey(key){saveNoteBeforeNavigation();const n=findNodeByPositionKey(currentNodeRoot(),key);if(!n)return false;currentNode=n;chess=new Chess(n.fen);selectedSquare=null;lastMove=n.move?[n.move.from,n.move.to]:null;renderBoard();onPositionChanged();return true}
function gotoNode(id){saveNoteBeforeNavigation();const n=findNode(currentNodeRoot(),id);if(!n)return;currentNode=n;chess=new Chess(n.fen);selectedSquare=null;lastMove=n.move?[n.move.from,n.move.to]:null;renderBoard();onPositionChanged()}
function currentNodeRoot(){let n=currentNode;while(n?.parent)n=n.parent;return n}
function renderNav(){$("prevBtn").disabled=!currentNode?.parent;$("nextBtn").disabled=!currentNode?.children?.[0]}
$("prevBtn").addEventListener("click",()=>{saveNoteBeforeNavigation();if(currentNode?.parent){currentNode=currentNode.parent;chess=new Chess(currentNode.fen);selectedSquare=null;lastMove=currentNode.move?[currentNode.move.from,currentNode.move.to]:null;renderBoard();onPositionChanged()}});
$("nextBtn").addEventListener("click",()=>{saveNoteBeforeNavigation();if(currentNode?.children?.[0]){currentNode=currentNode.children[0];chess=new Chess(currentNode.fen);selectedSquare=null;lastMove=currentNode.move?[currentNode.move.from,currentNode.move.to]:null;renderBoard();onPositionChanged()}});
["moves","analysisMoves"].forEach(id=>$(id)?.addEventListener("click",e=>{const b=e.target.closest(".move[data-node]");if(b)gotoNode(b.dataset.node)}));

let noteSaveTimer=null;
function saveNoteDraft(){if(!currentNode)return;const value=$("note")?.value?.trim()||"";if(value===String(currentNode.note||""))return;currentNode.note=value;schedulePersistAnalysis();}
$("note")?.addEventListener("input",()=>{clearTimeout(noteSaveTimer);noteSaveTimer=setTimeout(saveNoteDraft,350)});
function saveNoteBeforeNavigation(){clearTimeout(noteSaveTimer);saveNoteDraft();}

function renderAnnotations(){
  const row=$("annotationRow");if(!row)return;row.innerHTML="";const set=new Set(currentNode?.annotations||[]);
  ANNOTATION_DEFS.forEach(def=>{const b=document.createElement("button");b.type="button";b.className=`anno ${def.kind} ${set.has(def.icon)?"active":""}`;b.dataset.annotation=def.icon;b.dataset.label=def.label;b.textContent=def.icon;b.title=`${def.icon} · ${def.label}`;b.setAttribute("aria-label",def.label);b.setAttribute("aria-pressed",set.has(def.icon)?"true":"false");b.addEventListener("click",()=>{
    currentNode.annotations=currentNode.annotations||[];
    currentNode.annotations=currentNode.annotations.includes(def.icon)?currentNode.annotations.filter(x=>x!==def.icon):[...currentNode.annotations,def.icon];b.setAttribute("aria-pressed",currentNode.annotations.includes(def.icon)?"true":"false");
    if(currentNode.parent&&currentNode.san){const key=globalMoveKey(currentNode.parent.fen,currentNode.move);const next=[...currentNode.annotations];const counts={good:0,bad:0,neutral:0};next.forEach(x=>counts[annotationKind(x)]++);globalMoveAnnotations[key]={annotations:next,kindCounts:counts};saveGlobalMoveAnnotations();}
    renderAnnotations();renderBoard();schedulePersistAnalysis();
  });row.appendChild(b)});
  const noteEl=$("note");if(noteEl&&document.activeElement!==noteEl)noteEl.value=currentNode?.note||"";
}
function renderSelectedMoveInsights(){
  const box=$("moveInsights");if(!box)return;
  const node=currentNode;
  if(!node?.move){box.innerHTML='<div class="muted">Sélectionne un coup pour voir ses statistiques.</div>';return}
  const stats=moveOutcomeStats(node),white=stats?.white||0,draw=stats?.draw||0,black=stats?.black||0,total=white+draw+black;
  const anns=(node.annotations||[]).map(annotationDef);
  box.innerHTML=`<div class="insightMove"><b>${esc(node.san||"—")}</b><span class="muted">${node.parent?.fen===Chess.START_FEN?"Position initiale":"Position sélectionnée"}</span></div>${total?gaugeMarkup(stats,total):'<div class="muted">Pas encore assez de données dans la base pour ce coup.</div>'}<div class="insightAnnotations"><b>Annotations</b><div>${anns.length?anns.map(a=>`<span title="${esc(a.label)}">${esc(a.icon)}</span>`).join(" "):"Aucune"}</div></div>${node.note?.trim()?`<div class="insightNote">${esc(node.note.trim())}</div>`:""}`;
}

async function persistAnalysisSnapshot(snapshot){if(!snapshot)return;await put(snapshot);allGames=allGames.map(g=>g.id===snapshot.id?{...snapshot}:g);if(activeGame?.id===snapshot.id){activeGame={...activeGame,analysisTree:snapshot.analysisTree,annotationCount:snapshot.annotationCount,updatedAt:snapshot.updatedAt}}invalidateGlobalTree();}
async function persistAnalysis(){if(!activeGame||!currentNode)return;const root=currentNodeRoot();const stored={...activeGame,analysisTree:serializeTree(root),annotationCount:countAnnotations(root),updatedAt:Date.now()};delete stored.parsed;await persistAnalysisSnapshot(stored);}
function scheduleBackgroundPersist(){if(!activeGame||!currentNode)return;clearTimeout(persistTimer);persistTimer=setTimeout(()=>{persistTimer=null;void persistAnalysis().then(()=>{renderHome();renderTraining()}).catch(e=>toast("Autosauvegarde impossible : "+e.message));},80)}
async function flushPendingPersist(){if(!persistTimer)return;clearTimeout(persistTimer);persistTimer=null;await new Promise(resolve=>setTimeout(()=>{void persistAnalysis().finally(resolve)},0));}
function schedulePersistAnalysis(){if(!activeGame||!currentNode)return;clearTimeout(persistTimer);persistTimer=setTimeout(()=>{persistTimer=null;void persistAnalysis().then(()=>{renderHome();renderTraining()}).catch(e=>toast("Autosauvegarde impossible : "+e.message));},500)}
$("rotateBoardBtn")?.addEventListener("click",()=>{boardRotated=!boardRotated;renderBoard();});
$("analysisBackBtn")?.addEventListener("click",()=>{nav(activeGame?"games":"home")});
$("analysisSearchBtn")?.addEventListener("click",()=>{nav("games");setTimeout(()=>$("gameSearch")?.focus(),0)});
$("analysisEngineBtn")?.addEventListener("click",()=>$("analysisEval")?.scrollIntoView({behavior:"smooth",block:"center"}));
$("analysisBookBtn")?.addEventListener("click",()=>$("globalTree")?.closest(".analysisTreePanel")?.classList.toggle("is-open"));
$("analysisTreeBtn")?.addEventListener("click",()=>$("globalTree")?.closest(".analysisTreePanel")?.classList.toggle("is-open"));
$("analysisControlSettings")?.addEventListener("click",()=>$("analysisSettingsBtn")?.click());
$("analysisSettingsBtn")?.addEventListener("click",()=>$("settingsBtn")?.click());

$("saveNote").addEventListener("click",async()=>{if(!currentNode)return;$("annotationPanel")?.classList.toggle("editorOpen");$("note")?.focus();if(activeGame){try{await persistAnalysis();renderHome();renderTraining()}catch(e){toast("Enregistrement impossible : "+e.message)}}});
$("annotationRow").addEventListener("click",()=>{if(!currentNode||!activeGame)return;schedulePersistAnalysis();renderHome();renderTraining()});

$("importBtn").addEventListener("click",()=>$("pgnFile").click());
$("pgnFile").addEventListener("change",async e=>{
  const f=e.target.files?.[0];if(!f)return;
  try{
    const text=await f.text(),chunks=splitGames(text),added=[],existing=new Set(allGames.map(g=>g.id)),invalid=[];
    for(const source of chunks){
      const parsedGames=parsePGN(source);
      if(parsedGames.errors?.length){invalid.push(parsedGames.errors[0]);continue}
      const parsed=parsedGames[0]; if(!parsed)continue;
      try{validateParsedGame(parsed)}catch(err){invalid.push({error:err.message});continue}
      const h=headersFrom(source),g={...metaFromHeaders(h,"PGN",Date.now()/1000,source),id:gameIdentity("PGN",parsed,h)};
      if(existing.has(g.id))continue; existing.add(g.id); added.push(g);
    }
    if(invalid.length)throw new Error(`${invalid.length} partie(s) invalide(s), import annulé · première erreur : ${invalid[0].error}`);
    await putMany(added);allGames=await getAll();invalidateGlobalTree();renderGames();renderPgnCollections();renderHome();renderStats();toast(`${chunks.length} partie(s) validée(s) · ${added.length} ajoutée(s)`);
  }catch(err){toast("Import PGN refusé : "+err.message)}finally{e.target.value=""}
});

function exportActiveGamePgn(){
  if(!activeGame?.parsed){toast("Aucune partie ouverte");return}
  try{const out=exportPGN(activeGame.parsed);const blob=new Blob([out],{type:"application/x-chess-pgn"});const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;const safeName=v=>String(v||"").replace(/[\\/:*?"<>|]+/g,"_").replace(/\s+/g," ").trim()||"Unknown";a.download=`HighTaxi_${safeName(activeGame.white)}_${safeName(activeGame.black)}.pgn`;a.click();setTimeout(()=>URL.revokeObjectURL(url),500);toast("PGN exporté")}
  catch(e){toast("Export impossible : "+e.message)}
}
$("exportBtn")?.addEventListener("click",exportActiveGamePgn);
$("analysisExportBtn")?.addEventListener("click",exportActiveGamePgn);

$("backupBtn").addEventListener("click",async()=>{try{const games=await getAll();const data=JSON.stringify({format:"HighTaxi Chess Backup",version:APP_VERSION,schemaVersion:DATA_SCHEMA_VERSION,exportedAt:new Date().toISOString(),gameCount:games.length,globalMoveAnnotations,chessSyncArchives:JSON.parse(localStorage.getItem(CHESS_SYNC_KEY)||"[]"),games});const blob=new Blob([data],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`HighTaxiChess-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),500);toast(`${games.length} partie(s) sauvegardée(s)`)}catch(e){toast("Sauvegarde impossible : "+e.message)}});
$("restoreBtn").addEventListener("click",()=>$("backupFile").click());
$("backupFile").addEventListener("change",async e=>{const f=e.target.files?.[0];if(!f)return;try{const data=JSON.parse(await f.text());if(data.format!=="HighTaxi Chess Backup"||!Array.isArray(data.games))throw new Error("Format de sauvegarde invalide");if(data.schemaVersion&&Number(data.schemaVersion)>DATA_SCHEMA_VERSION)throw new Error("Sauvegarde créée par une version plus récente");const rawGames=data.games.filter(g=>g&&g.id&&typeof g.pgn==="string");if(rawGames.length!==data.games.length)throw new Error("Certaines parties sont invalides");const games=migrateBackupGames(rawGames,Number(data.schemaVersion||1));const importedGlobalAnnotations=data.globalMoveAnnotations&&typeof data.globalMoveAnnotations==="object"?data.globalMoveAnnotations:null;const importedSyncArchives=Array.isArray(data.chessSyncArchives)?data.chessSyncArchives:null;const mode=confirm(`Restaurer ${games.length} partie(s).\n\nOK = remplacer la base actuelle\nAnnuler = fusionner avec la base actuelle`)?"replace":"merge";if(mode==="replace"){if(!confirm("Dernière confirmation : toutes les parties actuellement présentes seront supprimées."))throw new Error("Restauration annulée");await replaceAll(games);if(importedGlobalAnnotations){globalMoveAnnotations=importedGlobalAnnotations;saveGlobalMoveAnnotations()}if(importedSyncArchives)localStorage.setItem(CHESS_SYNC_KEY,JSON.stringify(importedSyncArchives))}else{const existing=await getAll();const byId=new Map(existing.map(g=>[String(g.id),g]));for(const g of games){const old=byId.get(String(g.id));if(!old||(Number(g.updatedAt||0)>=Number(old.updatedAt||0)))byId.set(String(g.id),g)}await putMany([...byId.values()]);if(importedGlobalAnnotations){globalMoveAnnotations={...globalMoveAnnotations,...importedGlobalAnnotations};saveGlobalMoveAnnotations()}if(importedSyncArchives)localStorage.setItem(CHESS_SYNC_KEY,JSON.stringify(importedSyncArchives))}allGames=await getAll();invalidateGlobalTree();renderGames();renderPgnCollections();renderHome();renderStats();renderTraining();toast(`${games.length} partie(s) restaurée(s) · ${mode==="replace"?"base remplacée":"base fusionnée"}`)}catch(err){toast("Restauration impossible : "+err.message)}finally{e.target.value=""}});

$("syncBtn").addEventListener("click",async()=>{
  const b=$("syncBtn"),progress=$("syncProgress"),wrap=$("syncProgressWrap"),label=$("syncProgressText");
  b.disabled=true;
  saveSyncStatus({at:Date.now(),ok:false,message:"Synchronisation en cours…"});renderSyncStatus();
  const setProgress=(done,total,text)=>{
    if(wrap)wrap.style.display="block";
    if(progress){progress.max=Math.max(total,1);progress.value=done;}
    if(label)label.textContent=text;
    b.textContent=total?`Synchronisation ${done}/${total}…`:"Synchronisation…";
  };
  try{
    const data=await fetchChessComJson(`${CHESSCOM_BASE}/player/${encodeURIComponent(currentUser())}/games/archives`);
    const archives=Array.isArray(data?.archives)?data.archives.filter(Boolean):[];
    if(!archives.length)throw new Error(`Aucune archive trouvée pour ${currentUser()}.`);
    const ordered=[...archives].reverse();
    const synced=new Set(JSON.parse(localStorage.getItem(CHESS_SYNC_KEY)||"[]"));
    const now=new Date();
    const currentKey=`${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,"0")}`;
    const existingArchiveKeys=new Set(allGames.filter(g=>g.source==="Chess.com"&&g.chessArchive).map(g=>String(g.chessArchive)));
    const pending=ordered.filter(url=>{
      const key=chessComMonthKey(url);
      return key===currentKey||!synced.has(key)||!existingArchiveKeys.has(key);
    });
    const total=pending.length;
    let processed=0,fetched=0,added=0,skipped=archives.length-pending.length,errors=0,invalid=0;
    const existing=new Set(allGames.filter(g=>g.source==="Chess.com").map(g=>String(g.id||g.url)));
    setProgress(0,total,`0/${total} mois à traiter · ${skipped} déjà synchronisés`);

    for(const archiveUrl of pending){
      const monthKey=chessComMonthKey(archiveUrl);
      let source="",last=null;
      for(let attempt=0;attempt<3&&!source;attempt++){
        try{source=await fetchChessComPgn(archiveUrl)}
        catch(e){last=e;if(attempt<2)await new Promise(r=>setTimeout(r,600*(attempt+1)))}
      }
      processed++;
      if(!source){errors++;setProgress(processed,total,`${processed}/${total} mois · ${errors} erreur(s)`);continue}
      const batchAdds=[];
      for(const raw of splitGames(source)){
        const h=headersFrom(raw);
        if(!chessComPgnIsStandard(h))continue;
        let parsed;
        try{
          const result=parsePGN(raw);
          if(!result.length||result.errors?.length)throw new Error(result.errors?.[0]?.error||"PGN invalide");
          parsed=result[0];
          validateParsedGame(parsed);
        }catch{invalid++;continue}
        fetched++;
        const pgn=String(raw).trim();
        const id=gameIdentity("Chess.com",parsed,h);
        if(existing.has(id))continue;
        const result=String(h.Result||"*").trim();
        const g=metaFromHeaders({...h,Result:["1-0","0-1","1/2-1/2","*"].includes(result)?result:"*"},"Chess.com",parseTimestamp(h,0),pgn,{id,eco:openingName(h.ECO||""),time_control:h.TimeControl||"",chessArchive:monthKey,url:archiveUrl});
        batchAdds.push(g);existing.add(id);
      }
      if(batchAdds.length){await putMany(batchAdds);added+=batchAdds.length;allGames.push(...batchAdds)}
      if(monthKey!==currentKey)synced.add(monthKey);
      setProgress(processed,total,`${processed}/${total} mois · ${added} nouvelle(s)${errors?` · ${errors} erreur(s)`:""}`);
    }
    localStorage.setItem(CHESS_SYNC_KEY,JSON.stringify([...synced].slice(-120)));
    allGames=await getAll();invalidateGlobalTree();renderHome();renderGames();renderPgnCollections();renderStats();renderTraining();
    const details=[`${fetched} parties lues`,`${added} ajoutée(s)`,`${skipped} mois déjà synchronisés`];
    if(errors)details.push(`${errors} archive(s) en erreur`);
    if(invalid)details.push(`${invalid} PGN invalide(s)`);
    toast(details.join(" · "));
    if(label)label.textContent=`Terminé · ${added} ajoutée(s) · ${errors||invalid?"avec avertissements":"sans erreur"}`;saveSyncStatus({at:Date.now(),ok:!(errors||invalid),message:`${added} ajoutée(s)${errors||invalid?` · ${errors} erreur(s), ${invalid} PGN invalide(s)`:""}`});renderSyncStatus();
  }catch(e){
    toast("Erreur de synchronisation : "+e.message);
    if(label)label.textContent="Synchronisation interrompue";saveSyncStatus({at:Date.now(),ok:false,message:e.message||"Erreur inconnue"});renderSyncStatus();
  }finally{
    b.disabled=false;b.textContent="Synchroniser Chess.com";
  }
});

$("settingsBtn").addEventListener("click",async()=>{const panel=$("settingsPanel");if(panel){panel.classList.add("open");panel.setAttribute("aria-hidden","false");}await renderSettings();});
$("settingsClose")?.addEventListener("click",()=>{const p=$("settingsPanel");p?.classList.remove("open");p?.setAttribute("aria-hidden","true")});
$("settingsPanel")?.addEventListener("click",e=>{if(e.target.id==="settingsPanel")$("settingsClose")?.click()});
async function renderSettings(){const est=await estimateStorage();const account=$("settingsAccount");if(account)account.value=currentUser();$("settingsVersion")?.replaceChildren(document.createTextNode(APP_VERSION));$("settingsStorage")?.replaceChildren(document.createTextNode(est?.usage?`${(est.usage/1024/1024).toFixed(1)} Mo utilisés`:"Indisponible"));["autoEngine","showArrows","compactMoves"].forEach(k=>{const el=$("setting_"+k);if(el)el.checked=!!appSettings[k]});}
$("settingsAccount")?.addEventListener("change",e=>{const value=String(e.target.value||"").trim();if(!value){e.target.value=currentUser();return}appSettings.chesscomUser=value;saveAppSettings();renderHome();toast(`Compte Chess.com : ${value}`)});
["autoEngine","showArrows","compactMoves"].forEach(k=>$("setting_"+k)?.addEventListener("change",e=>{appSettings[k]=e.target.checked;saveAppSettings();if(k==="showArrows")renderBoard();if(k==="compactMoves")document.body.classList.toggle("compactMoves",!!appSettings.compactMoves);if(k==="autoEngine"&&appSettings.autoEngine)onPositionChanged()}));
$("settingsRebuild")?.addEventListener("click",()=>{invalidateGlobalTree();if(document.body.classList.contains("analysisActive"))buildGlobalTree();toast("Arbre global en reconstruction")});
$("settingsEngineReset")?.addEventListener("click",()=>{try{engineWorker?.terminate()}catch{}engineWorker=null;engineReadyPromise=null;engineUnavailable=false;engineSearchToken++;if(appSettings.autoEngine)onPositionChanged();toast("Stockfish réinitialisé")});
$("settingsClearCaches")?.addEventListener("click",()=>{recreatedPgnCache.clear();openingPrefixCache.clear();trainingCache=[];trainingCacheRevision=-1;invalidateGlobalTree();toast("Caches locaux vidés")});

async function boot(){
  try{await migrateLegacy();await migrateChessComStableIds();requestPersistence().catch(()=>{});allGames=await getAll();renderHome();renderGames();renderStats();renderTraining();renderSyncStatus();installBoardResizeObserver();document.body.classList.toggle("compactMoves",!!appSettings.compactMoves);renderBoard();
    const hash=location.hash;if(hash==="#board"||hash==="#games")nav(hash.slice(1)==="board"?"boardScreen":"games");else nav("boardScreen");
  }catch(e){toast("Erreur de stockage : "+e.message);renderBoard()}
}
if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});
boot();

function clubHeaders(){
  return {Event:"Club",Site:"HighTaxi Chess",Date:new Date().toISOString().slice(0,10).replace(/-/g,"."),White:$("manualWhite").value.trim()||currentUser(),Black:$("manualBlack").value.trim()||"Adversaire",Result:$("manualResult").value};
}
function clubPGN(){
  if(!clubState)return "";
  const h=clubHeaders();
  return exportPGN({headers:h,result:h.Result,startFen:Chess.START_FEN,root:clubState.root});
}
function renderClubMoves(){
  const el=$("clubMoves");if(!el||!clubState)return;
  const path=[];let n=clubState.current;while(n&&n.parent){path.unshift(n);n=n.parent}
  el.innerHTML=path.length?path.map(n=>`<button class="move ${n===clubState.current?"current":""}" data-node="${esc(n.id)}">${esc(n.san)}</button>`).join(""):'<span class="muted">Aucun coup</span>';
  el.querySelectorAll(".move").forEach(b=>b.addEventListener("click",()=>{const n=findNode(clubState.root,b.dataset.node);if(!n)return;clubState.current=n;clubState.chess=new Chess(n.fen);renderClubBoard()}));
}
function renderClubBoard(){
  const board=$("clubBoard");if(!board||!clubState)return;board.innerHTML="";
  const c=clubState.chess,selected=clubState.selected,legal=new Set(selected?c.legalMoves(selected).map(m=>m.to):[]);
  const files=["a","b","c","d","e","f","g","h"],ranks=[8,7,6,5,4,3,2,1];
  for(let row=0;row<8;row++)for(let col=0;col<8;col++){
    const s=files[col]+ranks[row],x=col,y=7-row,d=document.createElement("div");d.className=`square ${((x+y)%2===0)?"dark":"light"}`;d.dataset.square=s;
    if(s===selected)d.classList.add("selected");if(legal.has(s))d.classList.add(c.board[s]?"capture":"legal");
    const p=c.board[s];if(p)d.insertAdjacentHTML("beforeend",pieceSVG(p));board.appendChild(d);
  }
  installPieceFallbacks(board);
  const status=c.status();$("clubStatus").textContent=status.checkmate?"Échec et mat":status.stalemate?"Pat":`${status.check?"Échec · ":""}Trait aux ${c.turn==="w"?"Blancs":"Noirs"}`;
  $("clubPgnPreview").textContent=clubPGN();renderClubMoves();
}
$("clubStart")?.addEventListener("click",()=>{
  if(!$("manualWhite").value.trim()||!$("manualBlack").value.trim()){toast("Renseigne les deux joueurs");return}
  const root={id:crypto.randomUUID(),parent:null,children:[],move:null,san:null,fen:Chess.START_FEN,annotations:[],comment:"",note:"",nags:[]};
  clubState={root,current:root,chess:new Chess(),selected:null};$("clubComposer").style.display="block";renderClubBoard();
});
$("clubBoard")?.addEventListener("click",e=>{
  const cell=e.target.closest(".square");if(!cell||!clubState)return;const s=cell.dataset.square,c=clubState.chess;
  if(clubState.selected){
    const candidates=c.legalMoves(clubState.selected).filter(m=>m.to===s);
    if(candidates.length){let move=candidates[0];if(candidates.length>1){const promo=(prompt("Promotion : Q, R, B ou N","Q")||"Q").toLowerCase();move=candidates.find(m=>m.promotion===promo)||candidates[0]}
      const existing=clubState.current.children.find(n=>n.move?.from===move.from&&n.move?.to===move.to&&String(n.move?.promotion||"")===String(move.promotion||""));
      if(existing){clubState.current=existing;clubState.chess=new Chess(existing.fen);clubState.selected=null;renderClubBoard();return}
      const played=c.play(move),node={id:crypto.randomUUID(),parent:clubState.current,children:[],move,san:played.san,fen:played.fen,annotations:[],comment:"",note:"",nags:[]};clubState.current.children.push(node);clubState.current=node;clubState.selected=null;renderClubBoard();return;
    }
  }
  clubState.selected=c.board[s]&&c.board[s][0]===c.turn?s:null;renderClubBoard();
});
$("clubUndo")?.addEventListener("click",()=>{if(!clubState?.current?.parent)return;const p=clubState.current.parent;p.children=p.children.filter(n=>n!==clubState.current);clubState.current=p;clubState.chess=new Chess(p.fen);clubState.selected=null;renderClubBoard()});
$("clubCancel")?.addEventListener("click",()=>{clubState=null;$("clubComposer").style.display="none"});

$("manualAdd")?.addEventListener("click",async()=>{
  if(!clubState){toast("Ouvre d’abord l’échiquier de saisie");return}
  const h=clubHeaders();if(!h.White||!h.Black){toast("Renseigne les joueurs");return}
  try{
    const canonicalPgn=clubPGN(),g={...metaFromHeaders(h,"Club",Date.now()/1000,canonicalPgn),id:hashId(`Club|${canonicalPgn}`),headers:h,updatedAt:Date.now()};
    await put(g);allGames=await getAll();invalidateGlobalTree();renderGames();renderStats();renderHome();clubState=null;$("clubComposer").style.display="none";$("manualWhite").value="";$("manualBlack").value="";toast("Partie de club ajoutée · PGN généré automatiquement");
  }catch(e){toast("Ajout impossible : "+e.message)}
});

document.addEventListener("visibilitychange",()=>{if(document.hidden){void flushPendingPersist();if(engineWorker){try{engineWorker.postMessage("stop")}catch{}engineBusy=false;enginePendingFen=engineLastFen;engineSearchToken++;}return}if(engineLastFen){engineBusy=false;engineLastFen="";scheduleEngineAnalysis(enginePendingFen||currentNode?.fen||Chess.START_FEN)}});
window.addEventListener("pagehide",()=>{void flushPendingPersist()});
