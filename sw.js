const CACHE="hightaxi-chess-cache-v0.9.25";
const STATIC=["./","./index.html","./styles.css","./app.js","./chess.js","./pgn.js","./db.js","./version.js","./stockfish-worker.js","./stockfish/stockfish-18-lite-single.js","./stockfish/stockfish-18-lite-single.wasm","./manifest.webmanifest","./logo.jpg","./apple-touch-icon.png","./icon-192.png","./icon-512.png","./maskable-192.png","./maskable-512.png","./pieces/wP.png","./pieces/wN.png","./pieces/wB.png","./pieces/wR.png","./pieces/wQ.png","./pieces/wK.png","./pieces/bP.png","./pieces/bN.png","./pieces/bB.png","./pieces/bR.png","./pieces/bQ.png","./pieces/bK.png","./piece-assets.js"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(async cache=>{for(const url of STATIC){try{await cache.add(url)}catch{}}}).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith("hightaxi-chess-")&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  const url=new URL(e.request.url);
  if(url.origin!==location.origin)return;
  e.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const cached=await cache.match(e.request);
    const isStockfish=url.pathname.includes("/stockfish/");
    if(isStockfish&&cached){
      // Stockfish binaries are immutable for a given app version: serve the
      // precached copy immediately and refresh it in the background.
      fetch(e.request).then(r=>{if(r.ok)cache.put(e.request,r.clone())}).catch(()=>{});
      return cached;
    }
    const refresh=fetch(e.request).then(r=>{if(r.ok)cache.put(e.request,r.clone());return r}).catch(()=>null);
    // Network-first for the app shell keeps GitHub Pages from serving stale UI.
    if(cached){
      const fresh=await refresh;
      return fresh||cached;
    }
    const fresh=await refresh;
    return fresh||new Response("Offline",{status:503});
  })());
});
