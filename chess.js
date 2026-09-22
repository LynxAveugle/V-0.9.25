
const FILES="abcdefgh";
const PIECES="pnbrqk";
const DIRS={
 b:[[1,1],[1,-1],[-1,1],[-1,-1]],
 r:[[1,0],[-1,0],[0,1],[0,-1]],
 q:[[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]],
 n:[[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]],
 k:[[1,1],[1,0],[1,-1],[0,1],[0,-1],[-1,1],[-1,0],[-1,-1]]
};
export function sq(x,y){return x>=0&&x<8&&y>=0&&y<8?FILES[x]+(y+1):null}
export function xy(s){return [FILES.indexOf(s[0]),Number(s[1])-1]}
export function opposite(c){return c==="w"?"b":"w"}

export class Chess {
  constructor(fen){this.loadFEN(fen||Chess.START_FEN)}
  static START_FEN="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  clone(){const c=Object.create(Chess.prototype);c.board={...this.board};c.turn=this.turn;c.castle=this.castle;c.ep=this.ep;c.halfmove=this.halfmove;c.fullmove=this.fullmove;return c}
  loadFEN(fen){
    const p=String(fen).trim().split(/\s+/);
    if(p.length<4) throw new Error("FEN invalide");
    this.board={}; const rows=p[0].split("/");
    if(rows.length!==8) throw new Error("FEN invalide");
    for(let r=0;r<8;r++){let x=0;for(const ch of rows[r]){
      if(/[1-8]/.test(ch)) x+=Number(ch);
      else if(/[prnbqkPRNBQK]/.test(ch)){if(x>7)throw new Error("FEN invalide");this.board[sq(x,7-r)]=(ch===ch.toUpperCase()?"w":"b")+ch.toLowerCase();x++}
      else throw new Error("FEN invalide");
    } if(x!==8)throw new Error("FEN invalide")}
    this.turn=p[1]; this.castle=p[2]==="-"?"":p[2]; this.ep=p[3]==="-"?null:p[3];
    this.halfmove=Number(p[4]||0);this.fullmove=Number(p[5]||1);
    if(!["w","b"].includes(this.turn)||!/^(?:[KQkq]{0,4})$/.test(this.castle))throw new Error("FEN invalide");
    return this;
  }
  fen(){
    let rows=[];
    for(let y=7;y>=0;y--){let s="",empty=0;for(let x=0;x<8;x++){const p=this.board[sq(x,y)];if(!p)empty++;else{if(empty){s+=empty;empty=0}s+=p[0]==="w"?p[1].toUpperCase():p[1]}}if(empty)s+=empty;rows.push(s)}
    return `${rows.join("/")} ${this.turn} ${this.castle||"-"} ${this.ep||"-"} ${this.halfmove} ${this.fullmove}`;
  }
  king(c){return Object.keys(this.board).find(s=>this.board[s]===c+"k")}
  isAttacked(target,by){
    const [tx,ty]=xy(target);
    for(const from of Object.keys(this.board)){
      const p=this.board[from]; if(p[0]!==by)continue;
      const [x,y]=xy(from),dx=tx-x,dy=ty-y,t=p[1];
      if(t==="p"){const d=by==="w"?1:-1;if(dy===d&&Math.abs(dx)===1)return true}
      else if(t==="n"&&DIRS.n.some(([a,b])=>a===dx&&b===dy))return true;
      else if(t==="k"&&Math.max(Math.abs(dx),Math.abs(dy))===1)return true;
      else if((t==="b"||t==="q")&&Math.abs(dx)===Math.abs(dy)&&this.clearPath(from,target))return true;
      else if((t==="r"||t==="q")&&(dx===0||dy===0)&&this.clearPath(from,target))return true;
    } return false;
  }
  clearPath(a,b){
    let [x,y]=xy(a),[tx,ty]=xy(b),dx=Math.sign(tx-x),dy=Math.sign(ty-y);
    x+=dx;y+=dy;while(x!==tx||y!==ty){if(this.board[sq(x,y)])return false;x+=dx;y+=dy}return true;
  }
  pseudo(from){
    const p=this.board[from];if(!p)return[];const c=p[0],t=p[1],[x,y]=xy(from),out=[];
    const add=(tx,ty)=>{const to=sq(tx,ty);if(!to)return false;if(!this.board[to]){out.push(to);return true}if(this.board[to][0]!==c&&this.board[to][1]!=="k")out.push(to);return false};
    if(t==="p"){
      const d=c==="w"?1:-1,one=sq(x,y+d),two=sq(x,y+2*d);
      if(one&&!this.board[one]){out.push(one);if((c==="w"?y===1:y===6)&&two&&!this.board[two])out.push(two)}
      for(const dx of[-1,1]){const to=sq(x+dx,y+d);if(to&&((this.board[to]&&this.board[to][0]!==c&&this.board[to][1]!=="k")||to===this.ep))out.push(to)}
    } else if(t==="n"||t==="k"){
      for(const [dx,dy] of DIRS[t])add(x+dx,y+dy);
      if(t==="k"){
        const rank=c==="w"?1:8, enemy=opposite(c), rights=c==="w"?["K","Q"]:["k","q"];
        if(this.castle.includes(rights[0])&&this.board["h"+rank]===c+"r"&&!this.board["f"+rank]&&!this.board["g"+rank]&&!this.isAttacked("e"+rank,enemy)&&!this.isAttacked("f"+rank,enemy)&&!this.isAttacked("g"+rank,enemy))out.push("g"+rank);
        if(this.castle.includes(rights[1])&&this.board["a"+rank]===c+"r"&&!this.board["b"+rank]&&!this.board["c"+rank]&&!this.board["d"+rank]&&!this.isAttacked("e"+rank,enemy)&&!this.isAttacked("d"+rank,enemy)&&!this.isAttacked("c"+rank,enemy))out.push("c"+rank);
      }
    } else {
      for(const [dx,dy] of DIRS[t]){let tx=x+dx,ty=y+dy;while(add(tx,ty)){tx+=dx;ty+=dy}}
    } return out;
  }
  makeRaw(from,to,promotion=null){
    const p=this.board[from],c=p[0],t=p[1],capture=this.board[to];
    delete this.board[from];
    if(t==="p"&&to===this.ep&&!capture){const [x,y]=xy(to);delete this.board[sq(x,y+(c==="w"?-1:1))]}
    this.board[to]=p;
    if(t==="k"&&Math.abs(xy(to)[0]-xy(from)[0])===2){
      const rank=to[1],rf=xy(to)[0]>xy(from)[0]?"h"+rank:"a"+rank,rt=xy(to)[0]>xy(from)[0]?"f"+rank:"d"+rank;
      this.board[rt]=this.board[rf];delete this.board[rf];
    }
    if(t==="p"&&(to[1]===(c==="w"?"8":"1")))this.board[to]=c+(promotion||"q").toLowerCase();
    // Castling rights are invalidated by moving OR capturing an original rook.
    const revoke=(ch)=>{this.castle=this.castle.replace(ch,"")};
    if(t==="k"){revoke(c==="w"?"K":"k");revoke(c==="w"?"Q":"q")}
    if(t==="r"){if(from==="h1")revoke("K");if(from==="a1")revoke("Q");if(from==="h8")revoke("k");if(from==="a8")revoke("q")}
    if(to==="h1")revoke("K");if(to==="a1")revoke("Q");if(to==="h8")revoke("k");if(to==="a8")revoke("q");
    this.ep=null;
    if(t==="p"){const [fx,fy]=xy(from),[tx,ty]=xy(to);if(fx===tx&&Math.abs(ty-fy)===2)this.ep=sq(fx,(fy+ty)/2)}
    if(t==="p"||capture)this.halfmove=0;else this.halfmove++;
    if(c==="b")this.fullmove++;
    this.turn=opposite(c);
  }
  isLegal(from,to,promotion=null){
    const p=this.board[from];if(!p||p[0]!==this.turn)return false;
    if(!this.pseudo(from).includes(to))return false;
    const copy=this.clone();copy.makeRaw(from,to,promotion);
    const k=copy.king(p[0]);return !!k&&!copy.isAttacked(k,opposite(p[0]));
  }
  legalMoves(from=null){
    const sources=from?[from]:Object.keys(this.board).filter(s=>this.board[s][0]===this.turn);
    const out=[];
    for(const f of sources){const p=this.board[f];if(!p)continue;for(const to of this.pseudo(f)){if(p[1]==="p"&&(to[1]===(p[0]==="w"?"8":"1"))){for(const pr of["q","r","b","n"])if(this.isLegal(f,to,pr))out.push({from:f,to,promotion:pr})}else if(this.isLegal(f,to))out.push({from:f,to,promotion:null})}}
    return out;
  }
  status(){
    const k=this.king(this.turn),check=k?this.isAttacked(k,opposite(this.turn)):false,moves=this.legalMoves();
    return {check,checkmate:check&&moves.length===0,stalemate:!check&&moves.length===0,legal:moves.length};
  }
  san(move){
    const p=this.board[move.from],t=p[1],capture=!!this.board[move.to]||(t==="p"&&move.to===this.ep);
    if(t==="k"&&Math.abs(xy(move.to)[0]-xy(move.from)[0])===2)return xy(move.to)[0]>xy(move.from)[0]?"O-O":"O-O-O";
    let s=t==="p"?"":t.toUpperCase();
    if(t!=="p") {
      const alternatives=[];
      for(const from of Object.keys(this.board)) {
        if(from===move.from || this.board[from]!==p) continue;
        for(const m of this.legalMoves(from)) if(m.to===move.to) { alternatives.push(from); break; }
      }
      if(alternatives.length) {
        const sameFile=alternatives.some(from=>from[0]===move.from[0]);
        const sameRank=alternatives.some(from=>from[1]===move.from[1]);
        if(!sameFile) s+=move.from[0];
        else if(!sameRank) s+=move.from[1];
        else s+=move.from;
      }
    }
    if(t==="p"&&capture)s+=move.from[0];
    if(capture)s+="x";
    s+=move.to;
    if(move.promotion)s+="="+move.promotion.toUpperCase();
    const c=this.clone();c.makeRaw(move.from,move.to,move.promotion);const st=c.status();
    if(st.checkmate)s+="#";else if(st.check)s+="+";
    return s;
  }
  play(move){
    const p=this.board[move.from];
    const effective={...move};
    if(p?.[1]==="p"&&effective.to?.[1]===(p[0]==="w"?"8":"1")&&!effective.promotion)effective.promotion="q";
    if(!this.isLegal(effective.from,effective.to,effective.promotion))throw new Error("Coup illégal");
    const san=this.san(effective);this.makeRaw(effective.from,effective.to,effective.promotion);
    return {san,fen:this.fen(),status:this.status()};
  }
}
