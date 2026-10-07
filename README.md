# +1 Speed Duck Escape — game server

Colyseus 0.16 server for Bloxity Legion. One `lobby` room = up to 8 players; the 9th gets a
new lobby. Leaderboards are global (shared Mongo).

```bash
npm install
npm start          # ws://localhost:2567 (no Mongo needed: uses ./data/dev-db.json)
npm run check      # end-to-end smoke test against the running server
```

| File | What it does |
| --- | --- |
| `src/index.js` | HTTP + WebSocket server, `/health`, CORS, graceful shutdown |
| `src/LobbyRoom.js` | Colyseus adapter: identity, persistence, session takeover |
| `src/shared/lobbyLogic.js` | The game simulation (shared with the client's offline mode) |
| `src/shared/rules.js` | Economy: ducks, treadmills, rebirths, wheel, gifts, boosts |
| `src/shared/course.js` | Lobby + 20 stage layouts (pads, spawns, regions) |
| `src/db.js` | Mongo (`MONGODB_URI`) or local JSON fallback |
| `src/identity.js` | Verifies Bloxity login tokens; guests use a device id |

`src/shared/` is a **copy** — edit the client repo's files, then `npm run sync-shared`.

## Deploy (GitHub Actions → Legion)

1. Add repo secret **`LEGION_DEPLOY_TOKEN`** (Settings → Secrets and variables → Actions).
2. Push to `dev` (dev channel) or `main` (prod).
3. After the first push: repo → Packages → `speed-duck-escape-server` → Package settings →
   Change visibility → **Public**, then re-run the workflow.

`seatCap` 8 (= `maxClients`), `maxReplicas` 10.
