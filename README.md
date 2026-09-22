# HighTaxi Chess PWA — v0.9.18 GitHub Pages

PWA personnelle mobile-first pour importer, synchroniser, analyser et annoter les parties de HighTaxi.

## Hébergement cible

Cette version est conçue pour **GitHub Pages uniquement** :

- aucun serveur PHP/Node/Python ;
- aucune Cloudflare Function ;
- IndexedDB pour la base locale ;
- import/export PGN entièrement côté navigateur ;
- synchronisation Chess.com directement depuis le navigateur ;
- Service Worker compatible avec le cache GitHub Pages ;
- chemins d’assets relatifs au module pour fonctionner à la racine ou sous un sous-chemin.

GitHub Pages est un hébergement statique ; l’application ne dépend donc d’aucun backend propriétaire.

## Synchronisation Chess.com

La synchronisation utilise l’API publique Chess.com :

1. récupération de la liste des archives du compte `HighTaxi` ;
2. téléchargement du PGN mensuel via l’endpoint `/pgn` ;
3. validation locale du PGN ;
4. exclusion des variantes non standard ;
5. déduplication par identité de partie ;
6. stockage dans IndexedDB.

Les endpoints publics d’archives et de parties mensuelles sont documentés et utilisés par Chess.com pour l’accès aux historiques de parties.

La disponibilité exacte des requêtes navigateur dépend des politiques CORS actuellement servies par Chess.com. Le bouton affiche une erreur explicite si l’API refuse la requête.

## Stockfish

Le Worker tente dans cet ordre :

1. fichiers locaux `stockfish-18-lite-single.{js,wasm}` s’ils sont ajoutés au dépôt ;
2. copie GitHub publique de Stockfish.js 18 ;
3. CDN jsDelivr en second secours.

Le build utilisé est **lite single-thread**, adapté aux navigateurs mobiles et ne nécessitant pas `SharedArrayBuffer`. Le projet de référence utilisé pour le fallback publie bien les fichiers `stockfish-18-lite-single.js` et `.wasm`.

La version livrée fonctionne donc en ligne sans binaire local. Pour une analyse totalement hors ligne, les deux binaires doivent être ajoutés à la racine du dépôt.

## Correctifs v0.9.18

- Suppression complète de la dépendance au proxy `/api/chesscom` et à Cloudflare Pages.
- Synchronisation Chess.com refondue autour des PGN mensuels, avec retry et timeout.
- Déduplication plus stable basée sur joueurs, date/heure UTC, résultat, position initiale et ligne principale.
- Validation des PGN Chess.com avant insertion.
- Exclusion des variantes non standard.
- Rafraîchissement de la collection PGN après synchronisation.
- Cache Service Worker passé en `v0.9.18` et rendu **network-first** pour éviter de rester bloqué sur une ancienne version après un déploiement GitHub Pages.
- Ajout de `.nojekyll`.
- Suppression du fichier `_headers` et du dossier `functions/`, inutiles sur GitHub Pages.
- Correction de robustesse des pièces : chemins relatifs + fallback Unicode si une image PNG est absente ou bloquée.
- Stockfish : fallback GitHub puis jsDelivr si les binaires locaux ne sont pas présents.
- Conservation de l’IndexedDB, des sauvegardes/restaurations, de l’arbre d’analyse, des annotations, des variantes et des collections PGN.
- Version applicative : `0.9.20` ; schéma de données conservé en `2`.

## Installation GitHub Pages

Déposer **le contenu du dossier du projet** à la racine du dépôt GitHub, puis activer GitHub Pages sur la branche `main` et le dossier `/ (root)`.

Le dépôt doit notamment contenir :

```text
index.html
app.js
styles.css
chess.js
pgn.js
db.js
version.js
sw.js
stockfish-worker.js
manifest.webmanifest
.nojekyll
les PNG des pièces sont également placés à la racine du dépôt.
```

## Tests locaux

```bash
node test-smoke.mjs
node test-chess.mjs
node test-pgn.mjs
node test-phase0.mjs
node test-critical.mjs
node test-import-regression.mjs
node test-review-fixes.mjs
node test-sync-regression.mjs
node test-github-pages.mjs
node test-analysis-ui.mjs
```

Le fichier `test-import-regression.mjs` utilise également le PGN Chess.com fourni avec le projet lorsqu’il est disponible à `/mnt/data/ChessCom_hightaxi_202609.pgn`.


## v0.9.18
- Nouvelles annotations visuelles en pastilles pastel selon la palette Source.
- Onglets d’analyse `Toutes / HighTaxi Blancs / HighTaxi Noirs` pour filtrer l’arbre et les jauges.
- Prochains coups visibles directement sous l’analyse, avec statistiques Blancs / nulles / Noirs.
- Flèches des coups de la base : coups joués par HighTaxi mis en évidence.
- Annotations de qualité : !!, !, ★, 👍, ✓, 📖, ?!, ?, ❌, ??.
- Export PGN depuis Analyse.
- Panneau Réglages réel.
- Statistiques du coup sélectionné et jauge Blancs / nulles / Noirs.
- Persistance d’analyse non bloquante lors des changements d’onglet.
- Optimisation du rendu des coups et des variantes.


## v0.9.24 — Stockfish 18 bootstrap reliability
- Le moteur local et les fallbacks passent tous par le bootstrap same-origin `stockfish-worker.js`.
- Le bootstrap transmet le WASM via le fragment du Worker et importe le runtime Stockfish dans le Worker.
- Cache Service Worker versionné en v0.9.24.
- Le test navigateur utilise exactement le même chemin que l’application.

## v0.9.20 — Stockfish 18 local
- Stockfish 18 lite single-threaded est désormais embarqué à la racine du dépôt pour être compatible avec l’upload GitHub mobile.
- Le Worker transmet explicitement l'URL WASM via son fragment `#<wasm>,worker`, compatible avec le bootstrap Stockfish.js fourni.
- Le chargement local est prioritaire et les fichiers sont précachés par le Service Worker.
- Le fallback distant utilise Stockfish.js 18.0.8.

## v0.9.22 — performance
- Cache de la ligne d'ouverture par partie : recalcul uniquement si le PGN change.
- Cache des PGN recréés indexé par `updatedAt`, sans utiliser la longueur de `JSON.stringify(analysisTree)`.
- Liste des parties rendue par lots visibles (100 à la fois) avec bouton d'affichage progressif.
- Page de test navigateur `test-stockfish-browser.html` pour vérifier réellement `uci → isready → position → go → bestmove` avec un Worker Stockfish 18 et le WASM local.


## v0.9.26 — correction GitHub Pages / Stockfish

Le dépôt GitHub utilisé par HighTaxi est actuellement aplati lors de l’upload mobile :
`stockfish-18-lite-single.js` et `stockfish-18-lite-single.wasm` sont donc à la racine.

L’application charge désormais ces deux fichiers avec des URLs same-origin relatives à `app.js`.
Le Service Worker les précache également à la racine. Cela évite l’erreur
`HighTaxi engine load error [local Stockfish 18] Load failed` lorsque GitHub Pages
ne conserve pas les sous-dossiers.
