/**
 * Works out who a joining player is.
 *
 * Logged-in Bloxity users send their SDK token; we verify it against the Bloxity API
 * (the same endpoint the SDK itself uses) so nobody can claim someone else's account.
 * Guests send a random device id the client keeps in localStorage.
 */

const API_URL = process.env.BLOXITY_API_URL || 'https://api.bloxity.io'
const GAME_SLUG = process.env.BLOXITY_GAME_ID || 'speed-duck-escape'

/** token -> { user, at } */
const cache = new Map()
const CACHE_MS = 10 * 60 * 1000

async function verifyToken(token) {
  const hit = cache.get(token)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.user

  const res = await fetch(`${API_URL}/v1/auth/game-token/verify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameSlug: GAME_SLUG }),
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) return null
  const data = await res.json().catch(() => null)
  const user = data?.user || data
  if (!user || !(user._id || user.id)) return null
  cache.set(token, { user, at: Date.now() })
  if (cache.size > 5000) cache.delete(cache.keys().next().value)
  return user
}

const cleanName = (s, fallback) =>
  String(s || fallback || 'Player')
    .replace(/[^\w .-]/g, '')
    .trim()
    .slice(0, 20) || fallback || 'Player'

/** @returns {Promise<{ uid: string, name: string, loggedIn: boolean }>} */
export async function resolveIdentity(options = {}) {
  if (options.token) {
    try {
      const user = await verifyToken(String(options.token))
      if (user) {
        return {
          uid: `u:${user._id || user.id}`,
          name: cleanName(user.displayName || user.username, 'Player'),
          loggedIn: true,
        }
      }
    } catch (err) {
      console.warn('[auth] token verify failed:', err.message)
    }
  }

  const device = String(options.deviceId || '').replace(/[^\w-]/g, '').slice(0, 64)
  if (device.length < 8) throw new Error('missing device id')
  return { uid: `g:${device}`, name: cleanName(options.name, 'Guest'), loggedIn: false }
}
