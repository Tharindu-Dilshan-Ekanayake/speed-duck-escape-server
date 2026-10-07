import http from 'node:http'

import { WebSocketTransport } from '@colyseus/ws-transport'
import { Server } from 'colyseus'
import cors from 'cors'
import express from 'express'

import { db } from './db.js'
import { getLeaderboards, startLeaderboards } from './leaderboard.js'
import { LobbyRoom } from './LobbyRoom.js'
import { GAME_ID, ROOM_NAME } from './shared/gameData.js'

/**
 * +1 Speed Duck Escape - game server.
 *
 * Legion contract: listen on $PORT, answer GET /health fast, run as non-root (see
 * Dockerfile), and drain on SIGTERM (Colyseus' graceful shutdown + the room's
 * onBeforeShutdown save every profile before the pod exits).
 */

const PORT = Number(process.env.PORT || 2567)
const POD = process.env.POD_NAME || 'local'

const allowedOrigins = [
  process.env.CLIENT_ORIGIN,
  `https://${GAME_ID}.play.bloxity.io`,
  `https://${GAME_ID}.dev.play.bloxity.io`,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
].filter(Boolean)

const app = express()
app.use(
  cors({
    origin: (origin, cb) => {
      // Bloxity embeds games in iframes on several hosts; allow *.bloxity.io too.
      let host = ''
      try {
        host = new URL(origin).hostname
      } catch {
        /* "null" or malformed origin */
      }
      cb(null, !origin || allowedOrigins.includes(origin) || /(^|\.)bloxity\.io$/.test(host))
    },
  }),
)
app.use(express.json())

app.get('/health', (_req, res) => res.status(200).send('ok'))
app.get('/', (_req, res) => res.json({ game: GAME_ID, pod: POD }))
app.get('/leaderboard', (_req, res) => res.json(getLeaderboards()))

const server = http.createServer(app)
const gameServer = new Server({
  transport: new WebSocketTransport({ server, pingInterval: 5000, pingMaxRetries: 4 }),
  greet: false,
})

gameServer.define(ROOM_NAME, LobbyRoom)

gameServer.onShutdown(async () => {
  console.log('[server] shutting down, closing db')
  await db.close()
})

async function main() {
  try {
    await db.connect()
  } catch (err) {
    console.error('[db] connect failed:', err)
    process.exit(1)
  }
  startLeaderboards()
  await gameServer.listen(PORT)
  console.log(`[server] listening on :${PORT} (pod ${POD})`)
}

main()
