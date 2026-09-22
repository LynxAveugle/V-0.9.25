import {Chess} from "./chess.js";
function perft(c,d){if(d===0)return 1;let n=0;for(const m of c.legalMoves()){const x=c.clone();x.play(m);n+=perft(x,d-1)}return n}
let c=new Chess();if(perft(c,1)!==20||perft(c,2)!==400||perft(c,3)!==8902)throw Error("start perft");
const castle=new Chess("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
if(!castle.legalMoves().some(m=>m.to==="c1")||!castle.legalMoves().some(m=>m.to==="g1"))throw Error("castling");
const dis=new Chess("4k3/8/8/R7/8/8/8/R3K2R w KQ - 0 1");
const m=dis.legalMoves().find(x=>x.from==="a1"&&x.to==="a3");if(!m||dis.san(m)!=="R1a3")throw Error("rank disambiguation");
let p=new Chess("8/P7/8/8/8/8/8/k6K w - - 0 1");let pm=p.legalMoves().find(x=>x.from==="a7"&&x.to==="a8"&&x.promotion==="q");if(!pm||p.play(pm).san!=="a8=Q+")throw Error("promotion");
console.log("CHESS v0.9.6 TESTS OK");
