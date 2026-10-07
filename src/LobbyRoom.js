import { Room } from 'colyseus'

import { db } from './db.js'
import { resolveIdentity } from './identity.js'
import { getLeaderboards, onLeaderboards } from './leaderboard.js'
import { MAX_PLAYERS_PER_LOBBY } from './shared/gameData.js'
import { LobbyLogic } from './shared/lobbyLogic.js'
import { migrate, newProfile } from './shared/rules.js'

const TICK_MS = 100
const SAVE_EVERY_MS = 15_000

/** uid -> { room, client } so a second tab/device takes over the session cleanly. */
const activeSessions = new Map()

/**
 * One lobby = up to 8 players (Colyseus opens a fresh room for the 9th).
 * All game rules live in the shared LobbyLogic; this class only wires Colyseus,
 * identity and persistence to it.
 */
export class LobbyRoom extends Room {
  maxClients = MAX_PLAYERS_PER_LOBBY

  onCreate() {
    this.autoDispose = true
    this.bySid = new Map()
    this.uids = new Map()
    this.saveTimer = 0
    this.logic = new LobbyLogic({
      send: (sid, type, msg) => this.bySid.get(sid)?.send(type, msg),
      broadcast: (type, msg, exceptSid) => {
        for (const c of this.clients) if (c.sessionId !== exceptSid) c.send(type, msg)
      },
    })
    this.setSimulationInterval((dt) => this.tick(dt), TICK_MS)
    this.onMessage('*', (client, type, msg) => this.logic.handle(client.sessionId, String(type), msg))
    this.unsubLb = onLeaderboards((lb) => this.broadcast('lb', lb))
  }

  async onAuth(_client, options) {
    return resolveIdentity(options)
  }

  async onJoin(client, options, auth) {
    // Same account already playing (another tab / device): take its live profile over.
    let profile = null
    const prev = activeSessions.get(auth.uid)
    if (prev) {
      const prevPlayer = prev.room.logic.players.get(prev.client.sessionId)
      if (prevPlayer) {
        profile = prevPlayer.profile
        prevPlayer.transferred = true
      }
      try {
        prev.client.leave(4001)
      } catch {
        /* already gone */
      }
    }
    if (!profile) {
      const stored = await db.load(auth.uid)
      profile = stored ? migrate(stored, auth.name) : newProfile(auth.name)
    }
    profile.name = auth.name

    this.bySid.set(client.sessionId, client)
    this.uids.set(client.sessionId, auth.uid)
    activeSessions.set(auth.uid, { room: this, client })
    this.logic.addPlayer(
      {
        sid: client.sessionId,
        uid: auth.uid,
        profile,
        avatar: sanitizeAvatar(options.avatar),
        proportions: sanitizeProportions(options.proportions),
      },
      { lb: getLeaderboards(), roomId: this.roomId, loggedIn: auth.loggedIn },
    )
  }

  async onLeave(client) {
    const p = this.logic.removePlayer(client.sessionId)
    this.bySid.delete(client.sessionId)
    this.uids.delete(client.sessionId)
    if (!p) return
    if (activeSessions.get(p.uid)?.client === client) activeSessions.delete(p.uid)
    if (!p.transferred) await this.save(p)
  }

  async onBeforeShutdown() {
    await Promise.all([...this.logic.players.values()].map((p) => this.save(p)))
    this.disconnect()
  }

  async onDispose() {
    this.unsubLb?.()
    await Promise.all([...this.logic.players.values()].map((p) => this.save(p)))
  }

  tick(dtMs) {
    this.logic.tick(dtMs)
    this.saveTimer += dtMs
    if (this.saveTimer < 1000) return
    this.saveTimer = 0
    const now = Date.now()
    for (const p of this.logic.players.values()) {
      if (p.dirty && now - (p.lastSave || 0) > SAVE_EVERY_MS) this.save(p)
    }
  }

  async save(p) {
    if (p.transferred) return
    p.profile.updatedAt = Date.now()
    p.dirty = false
    p.lastSave = Date.now()
    try {
      await db.save(p.uid, p.profile)
    } catch (err) {
      p.dirty = true
      console.warn('[room] save failed', err.message)
    }
  }
}

const AVATAR_KEYS = ['hatId', 'backId', 'skinId', 'headId', 'armLId', 'armRId', 'legLId', 'legRId', 'torsoId']
function sanitizeAvatar(a) {
  if (!a || typeof a !== 'object') return null
  const out = {}
  for (const k of AVATAR_KEYS) if (a[k] !== undefined && a[k] !== null) out[k] = String(a[k]).slice(0, 40)
  return out
}

const PROPORTION_KEYS = ['height', 'shoulderWidth', 'armLength', 'legOffsetX', 'torsoScaleX', 'neckHeight', 'headScale']
function sanitizeProportions(pr) {
  if (!pr || typeof pr !== 'object') return null
  const out = {}
  for (const k of PROPORTION_KEYS) {
    const v = Number(pr[k])
    if (Number.isFinite(v)) out[k] = Math.max(0.5, Math.min(1.6, v))
  }
  return out
}
