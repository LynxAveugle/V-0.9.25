/* HighTaxi Chess — local-first Stockfish 18 bootstrap.
 * Stockfish.js worker mode receives the WASM URL through the Worker URL hash:
 *   <wasm-url>,worker
 * The engine JS itself is loaded with importScripts so it stays inside this
 * same Worker and never blocks the main UI thread.
 */
const params = new URLSearchParams(self.location.search);
const engine = params.get("engine") || "";
const label = params.get("label") || "Stockfish";
if (!engine) throw new Error("Stockfish engine URL missing");

self.addEventListener("error", event => {
  try {
    self.postMessage({
      __highTaxi:true,
      line:`info string HighTaxi worker error [${label}] ${event?.message || "Worker error"}`
    });
  } catch {}
});

try {
  importScripts(engine);
} catch (error) {
  self.postMessage({
    __highTaxi:true,
    line:`info string HighTaxi engine load error [${label}] ${error?.message||error}`
  });
  throw error;
}
