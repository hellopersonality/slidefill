# Slidefill

Slide-and-paint puzzle for phones. Swipe anywhere to slide the ball until it hits a wall; every tile it crosses gets painted. Paint every tile to clear the level.

- Levels are generated from a seed (the level number) and are solvable by construction.
- Single file, no dependencies: `index.html`.
- Controls: swipe anywhere, or arrow keys / WASD. `Z` undoes, `R` restarts.

## Releasing

Run `node bump-version.js` before committing. It stamps a new build number into `index.html` and `version.json`. Open copies of the game compare their embedded build to the deployed `version.json` and show a "Tap to reload" toast when a newer build is live. If you commit without bumping, players are not notified.

## Build workflow

- `engine.dev.js` is the source of truth for level generation, solving and the move rules.
- `node build.js` embeds it into `index.html` and bakes the 120 campaign levels (cached in `levels.baked.json`; `--force` rebakes).
- `node bump-version.js` stamps a new version so players get the update toast.
- Order: edit engine, `node build.js`, `node bump-version.js`, commit, push.
