import { db } from './db.js'

/**
 * Global leaderboards. Every pod reads the same Mongo database, so these are shared
 * across all lobbies. Refreshed on a timer and cached; rooms push the cache to clients.
 */

const REFRESH_MS = 20_000

let cache = { wins: [], level: [], rebirths: [], at: 0 }
const listeners = new Set()

const row = (p, v) => ({ name: p.name || 'Player', v: v || 0, r: p.rebirths || 0, duck: p.duck || 'rubber' })

async function refresh() {
  try {
    const [wins, level, rebirths] = await Promise.all([db.top('totalWins'), db.top('totalLevel'), db.top('rebirths')])
    cache = {
      wins: wins.map((p) => row(p, p.totalWins)),
      level: level.map((p) => row(p, p.level)),
      rebirths: rebirths.map((p) => row(p, p.rebirths)),
      at: Date.now(),
    }
    for (const fn of listeners) fn(cache)
  } catch (err) {
    console.warn('[lb] refresh failed:', err.message)
  }
}

let timer = null
export function startLeaderboards() {
  if (timer) return
  refresh()
  timer = setInterval(refresh, REFRESH_MS)
  timer.unref?.()
}

export const getLeaderboards = () => cache

export function onLeaderboards(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
