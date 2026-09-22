for (const mod of ["./version.js","./chess.js","./pgn.js","./db.js"]) {
  await import(mod);
  console.log(`SMOKE OK ${mod}`);
}
