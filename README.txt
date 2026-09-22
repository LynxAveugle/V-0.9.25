HighTaxi Chess v0.9.23

Stockfish 18 lite single-threaded is bundled locally. The application loads the
bundled Stockfish JavaScript directly as a Web Worker and passes the bundled WASM
URL through the Worker URL hash. This avoids the previous same-origin bootstrap
worker/importScripts path that could fail on GitHub Pages/iOS with "Load failed".

Local assets:
  stockfish-18-lite-single.js
  stockfish-18-lite-single.wasm

If the local engine cannot start, the application keeps the existing remote
Stockfish.js fallbacks through the same-origin bootstrap worker.
