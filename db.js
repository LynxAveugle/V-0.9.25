const DB_NAME="HighTaxiChess",DB_VERSION=2,STORE="games";
let connection=null;
async function openDB(){
  if(connection) return connection;
  connection=await new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,DB_VERSION);
    r.onupgradeneeded=()=>{
      const db=r.result;
      if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:"id"});
    };
    r.onsuccess=()=>{const db=r.result;db.onversionchange=()=>{db.close();connection=null};resolve(db)};
    r.onerror=()=>reject(r.error);
  });
  return connection;
}
export async function getAll(){const db=await openDB();return new Promise((res,rej)=>{const r=db.transaction(STORE).objectStore(STORE).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})}
export async function put(game){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put(game);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error||new Error("Transaction annulée"))})}
export async function putMany(games){if(!games.length)return;const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,"readwrite"),s=tx.objectStore(STORE);for(const g of games)s.put(g);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error||new Error("Transaction annulée"))})}
export async function clearAll(){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).clear();tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error||new Error("Transaction annulée"))})}
export async function replaceAll(games){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,"readwrite"),s=tx.objectStore(STORE);s.clear();for(const g of games||[])s.put(g);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error||new Error("Transaction annulée"))})}
export async function remove(id){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).delete(id);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}
export async function requestPersistence(){try{return !!(navigator.storage?.persist&&await navigator.storage.persist())}catch{return false}}
export async function estimateStorage(){try{return await navigator.storage?.estimate()}catch{return null}}
export async function migrateLegacy(){
  const legacy=localStorage.getItem("ht_games"); if(!legacy)return 0;
  try{
    const arr=JSON.parse(legacy);if(!Array.isArray(arr))return 0;
    const existing=await getAll(),ids=new Set(existing.map(g=>g.id||g.url));
    const converted=arr.filter(g=>!ids.has(g.id||g.url)).map((g,i)=>({
      ...g,id:g.id||g.url||`legacy-${Date.now()}-${i}`,parsed:undefined,
      timestamp:Number(g.timestamp||Date.now()/1000)-i
    }));
    // Keep a local backup until the migration has completed successfully.
    localStorage.setItem("ht_games_migration_backup",legacy);
    if(converted.length)await putMany(converted);
    localStorage.removeItem("ht_games"); return converted.length;
  }catch(e){return 0}
}
