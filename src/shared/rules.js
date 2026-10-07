/**
 * Economy rules. Every function mutates a profile and returns `{ ok, error?, ... }`.
 *
 * Shared by the Colyseus room (authoritative) and the browser's offline room, so both
 * play by exactly the same rules. CANONICAL COPY lives in the client repo.
 */

import {
  BOOST_MAX_MINUTES,
  BOOST_MINUTES,
  DUCKS,
  GIFTS,
  PACKS,
  SPIN_EVERY_MS,
  STAGE_COUNT,
  STAGE_WINS,
  TREADMILLS,
  WHEEL,
  WORLD2_REBIRTHS,
  boostPrice,
  duckById,
  friendBoost,
  giftWins,
  packPrice,
  rebirthLevel,
  runWins,
  stageWorld,
  stepMultiplier,
  winMultiplier,
  xpForLevel,
  xpForLevels,
} from './gameData.js'

export function newProfile(name = 'Player') {
  const now = Date.now()
  return {
    name,
    level: 1,
    xp: 0,
    totalXp: 0,
    wins: 0,
    totalWins: 0,
    rebirths: 0,
    totalLevel: 1,
    duck: 'rubber',
    ducks: ['rubber'],
    treads: ['t1'],
    maxStage: 1,
    stagesCleared: 0,
    racesWon: 0,
    spins: 1,
    spinMs: 0,
    boostWins: 0,
    boostSpeed: 0,
    createdAt: now,
    updatedAt: now,
  }
}

/** Fills fields added since a profile was first saved, and repairs bad values. */
export function migrate(stored, name) {
  const base = newProfile(name)
  const p = { ...base, ...(stored || {}) }
  for (const k of ['ducks', 'treads']) if (!Array.isArray(p[k])) p[k] = base[k]
  if (!p.ducks.includes('rubber')) p.ducks.unshift('rubber')
  if (!p.treads.includes('t1')) p.treads.unshift('t1')
  if (!p.ducks.includes(p.duck)) p.duck = 'rubber'
  for (const k of ['level', 'xp', 'wins', 'rebirths', 'maxStage', 'spins', 'spinMs']) {
    if (!Number.isFinite(p[k])) p[k] = base[k]
  }
  p.level = Math.max(1, Math.floor(p.level))
  p.maxStage = Math.min(STAGE_COUNT, Math.max(1, Math.floor(p.maxStage)))
  if (name) p.name = name
  p.totalLevel = totalLevel(p)
  return p
}

const fail = (error) => ({ ok: false, error })
const ok = (extra = {}) => ({ ok: true, ...extra })

export const totalLevel = (p) => p.level + p.rebirths * 1000

/* ------------------------------------------------------------------ */

/** Adds step XP. Returns `{ from, to }` when the level changed. */
export function addXp(p, amount) {
  amount = Math.max(0, Math.floor(amount))
  if (!amount) return null
  const from = p.level
  p.xp += amount
  p.totalXp = (p.totalXp || 0) + amount
  // Guard against absurd amounts locking the loop: at most 500 levels per call.
  let guard = 500
  while (guard > 0 && p.xp >= xpForLevel(p.level)) {
    p.xp -= xpForLevel(p.level)
    p.level += 1
    guard -= 1
  }
  p.totalLevel = totalLevel(p)
  return p.level !== from ? { from, to: p.level } : null
}

export function addWins(p, amount) {
  amount = Math.max(0, Math.round(amount))
  p.wins += amount
  p.totalWins = (p.totalWins || 0) + amount
  return amount
}

/** Step XP for one waddle, all multipliers applied. */
export function xpPerStep(p, others = 0, now = Date.now()) {
  const duck = duckById(p.duck)
  let v = duck.perStep * stepMultiplier(p.rebirths) * (1 + friendBoost(others))
  if (p.boostSpeed > now) v *= 2
  return v
}

/** Wins for a stage pad, all multipliers applied. */
export function padWins(p, stage, { race = false, now = Date.now() } = {}) {
  let v = (STAGE_WINS[stage] || 0) * winMultiplier(p.rebirths)
  if (p.boostWins > now) v *= 2
  if (race) v *= 2
  return Math.max(1, Math.round(v))
}

export function canEnterWorld(p, world) {
  if (world === 2 && p.rebirths < WORLD2_REBIRTHS) {
    return `World 2 needs ${WORLD2_REBIRTHS} Rebirths!`
  }
  return null
}

export const stageAccess = (p, stage) => canEnterWorld(p, stageWorld(stage))

/** Called when a pad is claimed - unlocks the next stage for teleports. */
export function clearStage(p, stage) {
  p.stagesCleared = (p.stagesCleared || 0) + 1
  if (stage + 1 <= STAGE_COUNT && stage + 1 > p.maxStage) p.maxStage = stage + 1
  if (stage > p.maxStage) p.maxStage = stage
}

/* ------------------------------------------------------------------ */

export function buyDuck(p, id) {
  const d = DUCKS.find((x) => x.id === id)
  if (!d) return fail('Unknown duck')
  if (p.ducks.includes(id)) {
    p.duck = id
    return ok({ equipped: true })
  }
  if (d.cost < 0) return fail('Win this duck on the Lucky Wheel!')
  if (p.rebirths < d.reb) return fail(`Needs ${d.reb} Rebirths!`)
  if (p.wins < d.cost) return fail('Not enough Wins!')
  p.wins -= d.cost
  p.ducks.push(id)
  p.duck = id
  return ok({ bought: true })
}

export function equipDuck(p, id) {
  if (!p.ducks.includes(id)) return fail('You do not own this duck yet!')
  p.duck = id
  return ok()
}

export function buyTread(p, id) {
  const t = TREADMILLS.find((x) => x.id === id)
  if (!t) return fail('Unknown treadmill')
  if (p.treads.includes(id)) return fail('Already owned!')
  if (p.rebirths < t.reb) return fail(`Needs ${t.reb} Rebirths!`)
  if (p.wins < t.cost) return fail('Not enough Wins!')
  p.wins -= t.cost
  p.treads.push(id)
  return ok()
}

export function doRebirth(p) {
  const need = rebirthLevel(p.rebirths)
  if (p.level < need) return fail(`Reach Level ${need} to Rebirth!`)
  p.rebirths += 1
  p.level = 1
  p.xp = 0
  p.totalLevel = totalLevel(p)
  return ok({ rebirths: p.rebirths })
}

function extendBoost(p, kind, minutes, now) {
  const key = kind === 'wins' ? 'boostWins' : 'boostSpeed'
  const cap = now + BOOST_MAX_MINUTES * 60_000
  p[key] = Math.min(cap, Math.max(now, p[key] || 0) + minutes * 60_000)
}

export function buyBoost(p, kind, now = Date.now()) {
  if (kind !== 'wins' && kind !== 'speed') return fail('Unknown boost')
  const price = boostPrice(p.maxStage)
  if (p.wins < price) return fail('Not enough Wins!')
  const key = kind === 'wins' ? 'boostWins' : 'boostSpeed'
  if ((p[key] || 0) - now > (BOOST_MAX_MINUTES - BOOST_MINUTES) * 60_000) return fail('Boost is already maxed!')
  p.wins -= price
  extendBoost(p, kind, BOOST_MINUTES, now)
  return ok()
}

export function buyPack(p, index) {
  const pack = PACKS[index]
  if (!pack) return fail('Unknown pack')
  const price = packPrice(pack, p.maxStage)
  if (p.wins < price) return fail('Not enough Wins!')
  p.wins -= price
  if (pack.kind === 'spins') {
    p.spins += pack.n
    return ok({ spins: pack.n })
  }
  const xp = xpForLevels(p.level, pack.levels)
  const lv = addXp(p, xp)
  return ok({ xp, lv })
}

/** Value shown on a pack button. */
export function packAmount(p, index) {
  const pack = PACKS[index]
  if (!pack) return 0
  return pack.kind === 'spins' ? pack.n : xpForLevels(p.level, pack.levels)
}

/** Spin timer: call with elapsed online ms. Returns spins granted. */
export function tickSpins(p, dtMs) {
  p.spinMs = (p.spinMs || 0) + dtMs
  let got = 0
  while (p.spinMs >= SPIN_EVERY_MS) {
    p.spinMs -= SPIN_EVERY_MS
    p.spins += 1
    got += 1
  }
  return got
}

function applyReward(p, r, now) {
  switch (r.kind) {
    case 'wins': {
      const wins = giftWins(r.f, p.maxStage, p.rebirths)
      addWins(p, wins)
      return { text: `+${wins} Wins`, wins }
    }
    case 'boost':
      extendBoost(p, r.boost, r.minutes || r.min || 5, now)
      return { text: r.boost === 'wins' ? '2x Wins!' : '2x Speed!' }
    case 'spins':
      p.spins += r.n
      return { text: `+${r.n} Spins` }
    case 'levels': {
      const xp = xpForLevels(p.level, r.n)
      const lv = addXp(p, xp)
      return { text: `+${r.n} Levels`, lv }
    }
    case 'duck': {
      if (!p.ducks.includes(r.duck)) {
        p.ducks.push(r.duck)
        p.duck = r.duck
        return { text: 'LUCKY DUCK!', duck: r.duck }
      }
      const wins = giftWins(5, p.maxStage, p.rebirths)
      addWins(p, wins)
      return { text: `+${wins} Wins`, wins }
    }
    default:
      return { text: '' }
  }
}

/** @param {() => number} rand 0..1 */
export function spinWheel(p, rand = Math.random, now = Date.now()) {
  if (p.spins < 1) return fail('No spins left! You get one every 10 minutes.')
  p.spins -= 1
  const total = WHEEL.reduce((s, x) => s + x.w, 0)
  let roll = rand() * total
  let idx = 0
  for (let i = 0; i < WHEEL.length; i += 1) {
    roll -= WHEEL[i].w
    if (roll <= 0) {
      idx = i
      break
    }
  }
  const reward = applyReward(p, WHEEL[idx], now)
  return ok({ idx, reward })
}

/**
 * Playtime gift. `session` = { ms, claimed: number[] } (kept by the room, not saved).
 */
export function claimGift(p, session, index, now = Date.now()) {
  const g = GIFTS[index]
  if (!g) return fail('Unknown gift')
  if (session.claimed.includes(index)) return fail('Already claimed!')
  if (session.ms < g.min * 60_000) return fail('Not ready yet - keep playing!')
  session.claimed.push(index)
  const reward = applyReward(p, g, now)
  return ok({ reward })
}

/** Race winner bonus. */
export function raceBonus(p) {
  return Math.max(5, Math.round(STAGE_WINS[Math.min(STAGE_COUNT, p.maxStage)] * 3 * winMultiplier(p.rebirths)))
}

export { runWins }

/* ------------------------------------------------------------------ */

/** What everyone else in the lobby sees. */
export function publicView(p) {
  return {
    name: p.name,
    level: p.level,
    rebirths: p.rebirths,
    wins: p.wins,
    duck: p.duck,
  }
}
