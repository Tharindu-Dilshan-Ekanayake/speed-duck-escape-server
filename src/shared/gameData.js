/**
 * +1 Speed Duck Escape - shared game data.
 *
 * CANONICAL COPY. The server keeps a byte-identical copy in
 * speed-duck-escape-server/src/shared/ (run `npm run sync-shared` there after editing).
 * Pure data + pure functions only: no DOM, no three.js, no Node APIs.
 */

export const GAME_ID = 'speed-duck-escape'
export const GAME_NAME = '+1 Speed Duck Escape'
export const ROOM_NAME = 'lobby'
export const MAX_PLAYERS_PER_LOBBY = 8

/** Set false before launch to hide the developer panel (stage jumper / free wins). */
export const DEV_TOOLS = false

/* ------------------------------------------------------------------ */
/* Levels & speed                                                      */
/* ------------------------------------------------------------------ */

/** Step XP needed to go from `level` to `level + 1`. L5 -> 217, L8 -> 326 (matches the original). */
export const xpForLevel = (level) => Math.floor(110 * Math.pow(1.145, level))

/** The "Speed: 24" number on the HUD. Level 1 = 16 (Roblox default walk speed). */
export const speedStat = (level) => 14 + 2 * level

/**
 * World velocity (m/s) for a speed stat. Linear early on so every level is felt, then
 * softened so very high levels stay controllable on the obstacle courses.
 */
export function velocityFor(stat) {
  if (stat <= 40) return stat * 0.3
  if (stat <= 140) return 12 + 0.12 * (stat - 40)
  return Math.min(30, 24 + 4 * Math.log(stat / 140))
}

/** Distance (m) walked on the ground that counts as one "waddle" (+N step XP). */
export const STEP_DISTANCE = 1.5
/** Treadmill steps per second at 1X. */
export const TREADMILL_STEPS = 4

/** Level needed for the next rebirth. */
export const rebirthLevel = (rebirths) => 20 + 10 * rebirths
/** Rebirth multipliers: step XP x(1+r), wins x(1 + 0.5r). */
export const stepMultiplier = (rebirths) => 1 + rebirths
export const winMultiplier = (rebirths) => 1 + 0.5 * rebirths

/** Party boost: +10% per other player in the server, up to +70%. */
export const friendBoost = (others) => Math.min(0.7, Math.max(0, others) * 0.1)

/* ------------------------------------------------------------------ */
/* Ducks                                                               */
/* ------------------------------------------------------------------ */

/**
 * Every duck is bought with Wins (no premium currency anywhere). Owned ducks are kept
 * forever (rebirth does not take them). `fx` drives the look: see Duck.jsx.
 */
export const DUCKS = [
  // ---- World 1 --------------------------------------------------------------
  { id: 'rubber', name: 'Rubber Duck', world: 1, perStep: 1, cost: 0, reb: 0, body: '#ffd21a', beak: '#ff8a1a', fx: {} },
  { id: 'shadow', name: 'Shadow Duck', world: 1, perStep: 2, cost: 3, reb: 0, body: '#1d2140', beak: '#ffb21a', fx: { rim: '#5b6bff' } },
  { id: 'ruby', name: 'Ruby Duck', world: 1, perStep: 5, cost: 15, reb: 0, body: '#c8102e', beak: '#ff8a1a', fx: { rim: '#ff5577' } },
  { id: 'gent', name: 'Gentleman Duck', world: 1, perStep: 25, cost: 100, reb: 0, body: '#ffd21a', beak: '#ff8a1a', fx: { hat: 'top' } },
  { id: 'ghost', name: 'Ghost Duck', world: 1, perStep: 50, cost: 500, reb: 0, body: '#f4fbff', beak: '#cfe8ff', fx: { glow: '#bfe6ff', ghost: true, particles: 'sparkle', pc: '#ffffff' } },
  { id: 'inferno', name: 'Inferno Duck', world: 1, perStep: 100, cost: 2500, reb: 0, body: '#ff3d0a', beak: '#ffd21a', fx: { glow: '#ff5a00', particles: 'fire', pc: '#ffae00' } },
  { id: 'love', name: 'Love Duck', world: 1, perStep: 250, cost: 5000, reb: 0, body: '#ff6fcf', beak: '#ff9ad5', fx: { glow: '#ff6fd8', particles: 'hearts', pc: '#ff3fa8', wings: '#ffd6f2' } },
  { id: 'frost', name: 'Frost Duck', world: 1, perStep: 450, cost: 8000, reb: 0, body: '#4fe6ff', beak: '#d8fbff', fx: { glow: '#5ef0ff', particles: 'snow', pc: '#e8fdff' } },
  { id: 'storm', name: 'Storm Duck', world: 1, perStep: 1000, cost: 16000, reb: 0, body: '#20243f', beak: '#e6e6ff', fx: { glow: '#dfe6ff', ring: '#ffffff', particles: 'wind', pc: '#ffffff' } },
  { id: 'volt', name: 'Volt Duck', world: 1, perStep: 2500, cost: 32000, reb: 0, body: '#28e0a8', beak: '#fff06a', fx: { glow: '#3dffc0', particles: 'bolts', pc: '#bfffee', wings: '#a8ffe6' } },
  { id: 'lucky', name: 'Lucky Duck', world: 1, perStep: 4000, cost: -1, reb: 0, body: '#ffd21a', beak: '#ff8a1a', fx: { rainbow: true, glow: '#ff3a3a', particles: 'stars', pc: '#ffffff' }, wheel: true },
  // ---- World 2 --------------------------------------------------------------
  { id: 'galaxy', name: 'Galaxy Duck', world: 2, perStep: 6000, cost: 60000, reb: 3, body: '#3b1d8f', beak: '#ff9af2', fx: { glow: '#9a6bff', particles: 'stars', pc: '#e6d8ff', galaxy: true } },
  { id: 'crystal', name: 'Crystal Duck', world: 2, perStep: 12000, cost: 120000, reb: 3, body: '#9ff3ff', beak: '#e0fbff', fx: { glow: '#7ff7ff', crystal: true, particles: 'sparkle', pc: '#d9fbff' } },
  { id: 'lavalord', name: 'Lava Lord', world: 2, perStep: 25000, cost: 250000, reb: 4, body: '#1a0f0f', beak: '#ff6a00', fx: { glow: '#ff3c00', horns: '#ff6a00', particles: 'fire', pc: '#ff5a00', cracks: '#ff5a00' } },
  { id: 'angel', name: 'Angel Duck', world: 2, perStep: 50000, cost: 500000, reb: 5, body: '#fffdf2', beak: '#ffcf4a', fx: { glow: '#fff1a8', halo: '#ffd84a', wings: '#ffffff', particles: 'sparkle', pc: '#fff3b0' } },
  { id: 'neon', name: 'Neon Duck', world: 2, perStep: 100000, cost: 1000000, reb: 6, body: '#ff1fa6', beak: '#29f3ff', fx: { glow: '#ff2fd0', ring: '#29f3ff', particles: 'sparkle', pc: '#29f3ff' } },
  { id: 'toxic', name: 'Toxic Duck', world: 2, perStep: 250000, cost: 2000000, reb: 7, body: '#7dff1a', beak: '#1f3d00', fx: { glow: '#a6ff00', particles: 'bubbles', pc: '#c8ff5a' } },
  { id: 'royal', name: 'Royal Duck', world: 2, perStep: 500000, cost: 4000000, reb: 8, body: '#ffcc1a', beak: '#ff8a1a', fx: { glow: '#ffd84a', hat: 'crown', gold: true, particles: 'sparkle', pc: '#fff0a0' } },
  { id: 'void', name: 'Void Duck', world: 2, perStep: 1000000, cost: 8000000, reb: 10, body: '#0b0614', beak: '#b46bff', fx: { glow: '#8a2bff', ring: '#b46bff', particles: 'stars', pc: '#c79bff' } },
  { id: 'phoenix', name: 'Rainbow Phoenix', world: 2, perStep: 2500000, cost: 16000000, reb: 12, body: '#ff5a1a', beak: '#ffe14a', fx: { rainbow: true, glow: '#ffb000', wings: '#ffd04a', particles: 'fire', pc: '#ffe14a' } },
  { id: 'golden', name: 'Golden God Duck', world: 2, perStep: 5000000, cost: 30000000, reb: 15, body: '#ffc81a', beak: '#fff1a0', fx: { glow: '#ffe066', gold: true, halo: '#fff6c0', ring: '#ffe066', particles: 'sparkle', pc: '#fff6b0' } },
]
export const duckById = (id) => DUCKS.find((d) => d.id === id) || DUCKS[0]

/* ------------------------------------------------------------------ */
/* Treadmills                                                          */
/* ------------------------------------------------------------------ */

export const TREADMILLS = [
  { id: 't1', world: 1, mult: 1, cost: 0, reb: 0, color: '#3a3d4f', glow: null },
  { id: 't2', world: 1, mult: 2, cost: 25, reb: 0, color: '#ff5a1a', glow: '#ffae00' },
  { id: 't3', world: 1, mult: 4, cost: 400, reb: 0, color: '#1fb8ff', glow: '#5ef0ff' },
  { id: 't4', world: 1, mult: 25, cost: 25000, reb: 2, color: '#b21fff', glow: '#ff3df0' },
  { id: 't5', world: 2, mult: 50, cost: 150000, reb: 3, color: '#29f3ff', glow: '#29f3ff' },
  { id: 't6', world: 2, mult: 100, cost: 600000, reb: 5, color: '#ff2fd0', glow: '#ff7af0' },
  { id: 't7', world: 2, mult: 250, cost: 3000000, reb: 8, color: '#ffcc1a', glow: '#fff06a' },
  { id: 't8', world: 2, mult: 1000, cost: 20000000, reb: 12, color: '#8a2bff', glow: '#c79bff' },
]
export const treadById = (id) => TREADMILLS.find((t) => t.id === id) || null

/* ------------------------------------------------------------------ */
/* Stages                                                              */
/* ------------------------------------------------------------------ */

export const STAGE_COUNT = 20
export const WORLD2_REBIRTHS = 3

/** Wins for stepping on each stage's end pad (before multipliers). Index 0 unused. */
export const STAGE_WINS = [0, 1, 3, 10, 20, 40, 75, 125, 200, 300, 450, 700, 1000, 1500, 2200, 3200, 4500, 6500, 9000, 12500, 18000]

export const STAGE_NAMES = [
  '',
  'River Bridges',
  'Bobbing Stones',
  'Tsunami Terraces',
  'Demon Lair',
  'Lava Leap',
  'Spinner Islands',
  'Mushroom Bounce',
  'Sky Bridge',
  'Boulder Canyon',
  'Rainbow Road',
  'Crystal Caves',
  'Conveyor Chaos',
  'Pendulum Hall',
  'Laser Grid',
  'Piston Peaks',
  'Meteor Shower',
  'Wind Tunnel',
  'Turntables',
  'Lava Rising',
  'Golden Temple',
]

export const stageWorld = (stage) => (stage > 10 ? 2 : 1)

/** Sum of every pad up to `maxStage` - one full run's worth of wins (pre-multiplier). */
export function runWins(maxStage) {
  let s = 0
  for (let i = 1; i <= Math.min(STAGE_COUNT, Math.max(1, maxStage)); i += 1) s += STAGE_WINS[i]
  return s
}

/* ------------------------------------------------------------------ */
/* Races                                                               */
/* ------------------------------------------------------------------ */

/** Race cycle (ms): wait, countdown, race. Pads pay x2 for racers; first to finish Stage 1 wins. */
export const RACE_WAIT_MS = 150_000
export const RACE_COUNTDOWN_MS = 10_000
export const RACE_LENGTH_MS = 60_000
export const RACE_CYCLE_MS = RACE_WAIT_MS + RACE_COUNTDOWN_MS + RACE_LENGTH_MS

/* ------------------------------------------------------------------ */
/* Lucky wheel, boosts, packs, gifts                                   */
/* ------------------------------------------------------------------ */

export const SPIN_EVERY_MS = 10 * 60 * 1000

/** Wheel slices, clockwise from the top. `w` = weight (sums to 100). */
export const WHEEL = [
  { id: 'w_small', label: 'Wins', kind: 'wins', f: 0.25, w: 28, color: '#ffd21a' },
  { id: 'x2wins', label: '2x Wins', kind: 'boost', boost: 'wins', min: 5, w: 12, color: '#34d6ff' },
  { id: 'w_mid', label: 'Wins+', kind: 'wins', f: 0.75, w: 20, color: '#7dff3a' },
  { id: 'spins', label: '+3 Spins', kind: 'spins', n: 3, w: 6, color: '#ff8a1a' },
  { id: 'w_big', label: 'BIG Wins', kind: 'wins', f: 2, w: 10, color: '#ff4fd8' },
  { id: 'x2speed', label: '2x Speed', kind: 'boost', boost: 'speed', min: 5, w: 12, color: '#3dffc0' },
  { id: 'levels', label: '+3 Levels', kind: 'levels', n: 3, w: 11, color: '#b46bff' },
  { id: 'lucky', label: '???', kind: 'duck', duck: 'lucky', w: 1, color: '#ff3a3a' },
]

export const BOOST_MINUTES = 10
export const BOOST_MAX_MINUTES = 60
export const boostPrice = (maxStage) => Math.max(10, Math.round(runWins(maxStage) * 0.6))

/** Bottom-row packs, paid with wins. Step-XP packs scale with your level. */
export const PACKS = [
  { id: 'xp1', kind: 'xp', levels: 1, f: 0.15, min: 3 },
  { id: 'spins10', kind: 'spins', n: 10, f: 0.8, min: 15 },
  { id: 'xp5', kind: 'xp', levels: 5, f: 0.5, min: 10 },
  { id: 'xp15', kind: 'xp', levels: 15, f: 1.2, min: 25 },
]
export const packPrice = (pack, maxStage) => Math.max(pack.min, Math.round(runWins(maxStage) * pack.f))

/** XP needed to climb `n` levels from `level` (the pack/wheel reward amount). */
export function xpForLevels(level, n) {
  let s = 0
  for (let i = 0; i < n; i += 1) s += xpForLevel(level + i)
  return s
}

/** "Free!" playtime gifts, by minutes played this session. */
export const GIFTS = [
  { min: 1, kind: 'wins', f: 0.3, label: 'Wins' },
  { min: 3, kind: 'spins', n: 1, label: '+1 Spin' },
  { min: 5, kind: 'levels', n: 2, label: '+2 Levels' },
  { min: 8, kind: 'wins', f: 0.8, label: 'Wins' },
  { min: 12, kind: 'boost', boost: 'speed', minutes: 5, label: '2x Speed' },
  { min: 16, kind: 'spins', n: 2, label: '+2 Spins' },
  { min: 20, kind: 'wins', f: 1.5, label: 'Wins' },
  { min: 25, kind: 'boost', boost: 'wins', minutes: 5, label: '2x Wins' },
  { min: 30, kind: 'wins', f: 3, label: 'MEGA Wins' },
]
export const giftWins = (f, maxStage, rebirths) => Math.max(1, Math.round(runWins(maxStage) * f * winMultiplier(rebirths)))

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc']
export function formatNum(n) {
  n = Number(n) || 0
  const neg = n < 0
  n = Math.abs(n)
  if (n < 1000) return (neg ? '-' : '') + String(Math.floor(n))
  let i = 0
  while (n >= 1000 && i < SUFFIX.length - 1) {
    n /= 1000
    i += 1
  }
  const s = n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)
  return (neg ? '-' : '') + s.replace(/\.0+$|(\.\d*?)0+$/, '$1') + SUFFIX[i]
}

export function formatTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
