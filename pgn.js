import {Chess} from "./chess.js";

function unescapeHeader(v){return v.replace(/\\"/g,'"').replace(/\\\\/g,'\\')}
const HEADER_LINE_RE=/^\s*\[([A-Za-z0-9_]+)\s+"((?:\\.|[^"\n])*)"\]\s*$/gm;
function headersFrom(text){
  const h={};
  for(const m of String(text).matchAll(HEADER_LINE_RE)) h[m[1]]=unescapeHeader(m[2]);
  return h;
}
function stripHeaders(text){return String(text).replace(HEADER_LINE_RE," ")}

function splitGames(text){
  const source=String(text).replace(/^\uFEFF/,"").trim();
  if(!source)return [];
  const starts=[...source.matchAll(/^\s*\[Event\s+/gmi)].map(m=>m.index);
  if(starts.length>1){
    const chunks=[]; for(let i=0;i<starts.length;i++) chunks.push(source.slice(starts[i],starts[i+1]??source.length));
    return chunks;
  }
  // PGNs without Event headers: split after a result token, outside comments/variations.
  const chunks=[]; let start=0, brace=0, lineComment=false, depth=0;
  const result=/^(1-0|0-1|1\/2-1\/2|\*)$/;
  let token="";
  const flushToken=(end)=>{
    if(!result.test(token)) return;
    let j=end; while(j<source.length&&/\s/.test(source[j]))j++;
    // A result followed by another move/header starts a new game.
    if(j<source.length){chunks.push(source.slice(start,end).trim());start=j;}
  };
  for(let i=0;i<=source.length;i++){
    const ch=source[i]||" ";
    if(lineComment){if(ch==='\n')lineComment=false;continue}
    if(brace){if(ch==='}')brace=0;continue}
    if(ch==='{'){brace=1;token="";continue}
    if(ch===';'){lineComment=true;token="";continue}
    if(ch==='('||ch===')'){depth+=ch==='('?1:-1;token="";continue}
    if(/\s/.test(ch)||i===source.length){
      if(token){flushToken(i);token=""}
    } else token+=ch;
  }
  const tail=source.slice(start).trim(); if(tail)chunks.push(tail);
  return chunks.length?chunks:[source];
}

function lexBody(text){
  const out=[]; let i=0;
  while(i<text.length){
    const c=text[i];
    if(/\s/.test(c)){i++;continue}
    if(c===';'){while(i<text.length&&text[i]!=='\n')i++;continue}
    if(c==='{'){
      let j=i+1; while(j<text.length&&text[j]!=='}')j++;
      if(j>=text.length) throw new Error("Commentaire PGN non fermé");
      out.push({type:"comment",value:text.slice(i+1,j)});i=j+1;continue;
    }
    if(c==='('||c===')'){out.push({type:c,value:c});i++;continue}
    // A stray closing brace must never leave the lexer at the same index.
    if(c==='}'){out.push({type:'word',value:c});i++;continue}
    if(c==='$'){
      const m=text.slice(i).match(/^\$(\d+)/); if(m){out.push({type:"nag",value:Number(m[1])});i+=m[0].length;continue}
    }
    let j=i; while(j<text.length&&!/[\s(){};]/.test(text[j]))j++;
    out.push({type:"word",value:text.slice(i,j)});i=j;
  }
  return out;
}

function normalizeMoveToken(raw){
  return String(raw||"").replace(/e\.p\.?$/i,"").replace(/[!?]+$/g,"").replace(/^0-0-0$/i,"O-O-O").replace(/^0-0$/i,"O-O").trim();
}
function stripMoveNumber(raw){return raw.replace(/^\d+\.(?:\.\.)?/,'')}
function sanCore(s){return s.replace(/[+#]+$/g,"").replace(/[!?]+$/g,"")}

function parseAnnotationComment(text){
  const m=String(text||"").match(/HighTaxi\s*:\s*(.*)/i); if(!m)return null;
  const body=m[1].trim();
  const annotations=[...body.matchAll(/!!|\?!|\?\?|❌|★|👍|✓|📖|\?|!|⭐|⚠️|💡|🎯|🧠|⏱️|👀|🔥/g)].map(x=>x[0]);
  const note=body.replace(/!!|\?!|\?\?|❌|★|👍|✓|📖|\?|!|⭐|⚠️|💡|🎯|🧠|⏱️|👀|🔥/g,"").trim();
  return {annotations,note};
}

function chooseMove(chess,token){
  const normalized=normalizeMoveToken(stripMoveNumber(token));
  if(!normalized||/^(1-0|0-1|1\/2-1\/2|\*)$/.test(normalized))return null;
  const castle=normalized.toUpperCase();
  if(castle==="O-O"||castle==="O-O-O"){
    const to=castle==="O-O"?(chess.turn==="w"?"g1":"g8"):(chess.turn==="w"?"c1":"c8");
    return chess.legalMoves().find(m=>m.to===to&&chess.board[m.from]?.[1]==="k")||null;
  }
  const core=sanCore(normalized);
  const m=core.match(/^([KQRBN])?([a-h]?[1-8]?)(x?)([a-h][1-8])(?:=?([QRBN]))?$/);
  if(!m) return null;
  const piece=(m[1]||"").toLowerCase()||"p", dis=m[2]||"", capture=!!m[3], target=m[4].toLowerCase(), promotion=(m[5]||"").toLowerCase();
  let candidates=chess.legalMoves().filter(move=>{
    const p=chess.board[move.from]; if(!p||p[1]!==piece||move.to!==target)return false;
    const actualCapture=!!chess.board[move.to]||(piece==="p"&&move.to===chess.ep);
    if(capture!==actualCapture)return false;
    if(promotion!==(move.promotion||""))return false;
    if(dis && !move.from.includes(dis))return false;
    return true;
  });
  if(candidates.length===1)return candidates[0];
  // Some PGNs omit the capture marker or check suffix. Prefer the legal move whose SAN core matches.
  candidates=chess.legalMoves().filter(move=>sanCore(chess.san(move))===core);
  return candidates.length===1?candidates[0]:null;
}

const SUFFIX_NAGS={"!":1,"?":2,"!!":3,"??":4,"!?":5,"?!":6};

function parseOne(source,index){
  const headers=headersFrom(source);
  let startFen=Chess.START_FEN;
  if(headers.SetUp==="1"&&headers.FEN) startFen=headers.FEN;
  else if(headers.FEN) startFen=headers.FEN;
  const root={id:crypto.randomUUID(),parent:null,children:[],move:null,san:null,fen:startFen,annotations:[],comment:"",note:"",nags:[]};
  const chess=new Chess(startFen); let current=root; const stack=[]; let result=headers.Result||"*";
  for(const tok of lexBody(stripHeaders(source))){
    if(tok.type==='('){
      stack.push({node:current,fen:chess.fen()});
      if(current.parent){current=current.parent;chess.loadFEN(current.fen)}
      continue;
    }
    if(tok.type===')'){
      const state=stack.pop(); if(state){current=state.node;chess.loadFEN(state.fen)}
      continue;
    }
    if(tok.type==='comment'){
      const rawComment=String(tok.value||"");
      const clocks=[...rawComment.matchAll(/\[%clk\s+([^\]]+)\]/gi)].map(m=>m[1].trim());
      if(clocks.length)current.clock=clocks[clocks.length-1];
      const cleaned=rawComment.replace(/\[%clk\s+[^\]]+\]/gi," ").replace(/\s+/g," ").trim();
      const annotation=parseAnnotationComment(cleaned);
      if(annotation){current.annotations=[...new Set([...(current.annotations||[]),...annotation.annotations])];if(annotation.note)current.note=annotation.note;}
      else if(cleaned) current.comment=current.comment?`${current.comment} ${cleaned}`:cleaned;
      continue;
    }
    if(tok.type==='nag'){current.nags=[...(current.nags||[]),tok.value];continue}
    let raw=tok.value;
    raw=stripMoveNumber(raw);
    if(!raw||/^\.+$/.test(raw))continue;
    if(/^(1-0|0-1|1\/2-1\/2|\*)$/.test(raw)){result=raw;continue}
    // Move tokens may carry a NAG suffix such as Bb5! or Nf3?!
    const suffix=raw.match(/([!?]+)$/)?.[1]||"";
    if(suffix)raw=raw.slice(0,-suffix.length);
    const move=chooseMove(chess,raw);
    if(!move) throw new Error(`PGN invalide : coup non reconnu "${tok.value}"`);
    const played=chess.play(move);
    const node={id:crypto.randomUUID(),parent:current,children:[],move,san:played.san,fen:played.fen,annotations:[],comment:"",note:"",clock:null,nags:suffix&&SUFFIX_NAGS[suffix]?[SUFFIX_NAGS[suffix]]:[]};
    current.children.push(node);current=node;
  }
  return {id:root.id,headers,result,root,startFen,parseVersion:2};
}

export function parsePGN(text){
  const games=[]; const errors=[];
  for(const [i,source] of splitGames(text).entries()){
    if(!source.trim())continue;
    try{games.push(parseOne(source,i))}catch(e){errors.push({index:i+1,error:e.message,source});}
  }
  Object.defineProperty(games,"errors",{value:errors,enumerable:false});
  if(!games.length&&errors.length) throw new Error(errors[0].error);
  return games;
}

function escapeHeader(v){return String(v??"").replace(/\\/g,"\\\\").replace(/"/g,'\\"')}
function nodeComment(node){
  const parts=[];
  if(node.clock)parts.push(`{[%clk ${String(node.clock).replace(/[{}]/g,"").trim()}]}`);
  if(node.comment)parts.push(`{${String(node.comment).replace(/[{}]/g,"(").trim()}}`);
  const anns=[...(node.annotations||[])]; const note=(node.note||"").trim().replace(/[{}]/g,"(");
  if(anns.length||note) parts.push(`{HighTaxi: ${anns.join(" ")}${anns.length&&note?" ":""}${note}`.trim()+"}");
  return parts.join(" ");
}
function nodeNags(node){return (node.nags||[]).map(n=>`$${n}`).join(" ")}
function moveNumber(fen){return Number(fen.split(/\s+/)[5]||1)}

export function exportPGN(game){
  const headers={...(game.headers||{})};
  if(game.result&&game.result!=="*")headers.Result=game.result; else if(!headers.Result)headers.Result="*";
  if(game.startFen&&game.startFen!==Chess.START_FEN){headers.SetUp="1";headers.FEN=game.startFen;}
  const lines=Object.entries(headers).map(([k,v])=>`[${k} "${escapeHeader(v)}"]`); lines.push("");
  const out=[];
  function emitLine(node,forceBlackNumber=false,inVariation=false){
    const parent=node.parent; const fields=String(parent?.fen||Chess.START_FEN).split(/\s+/),turn=fields[1],num=Number(fields[5]||1);
    if(turn==="w")out.push(`${num}.`); else if(forceBlackNumber||inVariation)out.push(`${num}...`);
    out.push(node.san);
    const nags=nodeNags(node); if(nags)out.push(nags);
    const c=nodeComment(node); if(c)out.push(c);
    const siblings=parent?.children||[], index=siblings.indexOf(node),alts=index===0&&siblings.length>1;
    if(alts){for(const alt of siblings.slice(1)){out.push("(");emitLine(alt,true,true);out.push(")");}}
    if(node.children?.[0])emitLine(node.children[0],alts,inVariation);
  }
  if(game.root?.comment)out.push(`{${String(game.root.comment).replace(/[{}]/g,"(").trim()}}`);
  if(game.root?.children?.[0])emitLine(game.root.children[0],true,false);
  out.push(headers.Result||"*");
  return lines.concat(out.join(" ")).join("\n");
}

function fastChooseMove(chess,token){
  const normalized=normalizeMoveToken(stripMoveNumber(token));
  if(!normalized||/^(1-0|0-1|1\/2-1\/2|\*)$/.test(normalized))return null;
  const upper=normalized.toUpperCase();
  if(upper==='O-O'||upper==='O-O-O'){
    const from=chess.turn==='w'?'e1':'e8',to=upper==='O-O'?(chess.turn==='w'?'g1':'g8'):(chess.turn==='w'?'c1':'c8');
    return chess.isLegal(from,to)?{from,to,promotion:null}:null;
  }
  const core=sanCore(normalized);
  const m=core.match(/^([KQRBN])?([a-h]?[1-8]?)(x?)([a-h][1-8])(?:=?([QRBN]))?$/);
  if(!m)return null;
  const piece=(m[1]||'').toLowerCase()||'p',dis=m[2]||'',capture=!!m[3],target=m[4].toLowerCase(),promotion=(m[5]||'').toLowerCase();
  const candidates=[];
  for(const from of Object.keys(chess.board)){
    const p=chess.board[from];
    if(!p||p[0]!==chess.turn||p[1]!==piece)continue;
    if(dis&&!from.includes(dis))continue;
    if(!chess.pseudo(from).includes(target))continue;
    const actualCapture=!!chess.board[target]||(piece==='p'&&target===chess.ep);
    if(capture!==actualCapture)continue;
    if(promotion){
      if(piece!=='p')continue;
      if(chess.isLegal(from,target,promotion))candidates.push({from,to:target,promotion});
    }else if(piece==='p'&&(target[1]===(p[0]==='w'?'8':'1'))){
      // A promotion must be explicit in the PGN.
      continue;
    }else if(chess.isLegal(from,target,null)){
      candidates.push({from,to:target,promotion:null});
    }
  }
  if(candidates.length===1)return candidates[0];
  if(candidates.length>1){
    for(const move of candidates){if(sanCore(chess.san(move))===core)return move;}
  }
  return null;
}

function ultraChooseMove(chess,token){
  const normalized=normalizeMoveToken(stripMoveNumber(token));
  if(!normalized||/^(1-0|0-1|1\/2-1\/2|\*)$/.test(normalized))return null;
  const upper=normalized.toUpperCase();
  if(upper==='O-O'||upper==='O-O-O'){
    const from=chess.turn==='w'?'e1':'e8',to=upper==='O-O'?(chess.turn==='w'?'g1':'g8'):(chess.turn==='w'?'c1':'c8');
    return chess.isLegal(from,to)?{from,to,promotion:null}:null;
  }
  const core=sanCore(normalized);
  const m=core.match(/^([KQRBN])?([a-h]?[1-8]?)(x?)([a-h][1-8])(?:=?([QRBN]))?$/);
  if(!m)return null;
  const piece=(m[1]||'').toLowerCase()||'p',dis=m[2]||'',capture=!!m[3],target=m[4].toLowerCase(),promotion=(m[5]||'').toLowerCase();
  const candidates=[];
  for(const from of Object.keys(chess.board)){
    const p=chess.board[from];
    if(!p||p[0]!==chess.turn||p[1]!==piece)continue;
    if(dis&&!from.includes(dis))continue;
    if(!chess.pseudo(from).includes(target))continue;
    const actualCapture=!!chess.board[target]||(piece==='p'&&target===chess.ep);
    if(capture!==actualCapture)continue;
    if(promotion!==((piece==='p'&&promotion)?promotion:''))continue;
    if(piece==='p'&&(target[1]===(p[0]==='w'?'8':'1'))&&!promotion)continue;
    candidates.push({from,to:target,promotion:promotion||null});
  }
  if(candidates.length===1)return candidates[0];
  if(candidates.length>1){
    for(const move of candidates){if(chess.isLegal(move.from,move.to,move.promotion))return move}
    for(const move of candidates){if(sanCore(chess.san(move))===core)return move}
  }
  return null;
}

export function openingLineUltraFast(text,maxPlies=24){
  const source=String(text||'');
  const headers=headersFrom(source);
  const startFen=headers.FEN||Chess.START_FEN;
  const chess=new Chess(startFen);
  const out=[]; let depth=0;
  for(const tok of lexBody(stripHeaders(source))){
    if(tok.type==='('){depth++;continue} if(tok.type===')'){depth=Math.max(0,depth-1);continue}
    if(depth>0||tok.type!=='word')continue;
    let raw=stripMoveNumber(tok.value);
    if(!raw||/^(1-0|0-1|1\/2-1\/2|\*)$/.test(raw))continue;
    const suffix=raw.match(/([!?]+)$/)?.[1]||'';
    if(suffix)raw=raw.slice(0,-suffix.length);
    const move=ultraChooseMove(chess,raw);
    if(!move)break;
    const fromFen=chess.fen();
    chess.makeRaw(move.from,move.to,move.promotion||null);
    out.push({fen:chess.fen(),san:normalizeMoveToken(raw),move,from:fromFen});
    if(out.length>=maxPlies)break;
  }
  return {startFen,out};
}

export function openingLineFast(text,maxPlies=24){
  const source=String(text||'');
  const headers=headersFrom(source);
  const startFen=headers.FEN||Chess.START_FEN;
  const chess=new Chess(startFen);
  const out=[]; let depth=0;
  for(const tok of lexBody(stripHeaders(source))){
    if(tok.type==='('){depth++;continue} if(tok.type===')'){depth=Math.max(0,depth-1);continue}
    if(depth>0||tok.type!=='word')continue;
    let raw=stripMoveNumber(tok.value);
    if(!raw||/^(1-0|0-1|1\/2-1\/2|\*)$/.test(raw))continue;
    const suffix=raw.match(/([!?]+)$/)?.[1]||'';
    if(suffix)raw=raw.slice(0,-suffix.length);
    let move=fastChooseMove(chess,raw);
    if(!move)move=chooseMove(chess,raw);
    if(!move)break;
    const fromFen=chess.fen();
    chess.makeRaw(move.from,move.to,move.promotion||null);
    out.push({fen:chess.fen(),san:normalizeMoveToken(raw),move,from:fromFen});
    if(out.length>=maxPlies)break;
  }
  return {startFen,out};
}

export function openingLine(text,maxPlies=18){
  const source=String(text||"");
  const headers=headersFrom(source);
  const startFen=headers.FEN||Chess.START_FEN;
  const chess=new Chess(startFen);
  const out=[]; let depth=0;
  for(const tok of lexBody(stripHeaders(source))){
    if(tok.type==='('){depth++;continue}
    if(tok.type===')'){depth=Math.max(0,depth-1);continue}
    if(depth>0||tok.type!=='word')continue;
    let raw=stripMoveNumber(tok.value);
    if(!raw||/^(1-0|0-1|1\/2-1\/2|\*)$/.test(raw))continue;
    const suffix=raw.match(/([!?]+)$/)?.[1]||"";
    if(suffix)raw=raw.slice(0,-suffix.length);
    const move=chooseMove(chess,raw);
    if(!move)break;
    const fromFen=chess.fen();
    const played=chess.play(move);
    out.push({fen:played.fen,san:played.san,move,from:fromFen});
    if(out.length>=maxPlies)break;
  }
  return {startFen,out};
}

export {headersFrom,splitGames};
