/**
 * World layout: two lobbies and 25 obstacle stages (15 + 10), generated deterministically.
 *
 * CANONICAL COPY (the server keeps an identical copy for pad / stage validation).
 * Pure data: the client turns it into meshes + collision, the server only reads
 * spawns, pads, treadmills and stage regions.
 *
 * Coordinates: metres, y up. Each course runs from its lobby towards -z. Inside a stage
 * the builders use (x = lateral offset from the course centre, u = forward distance from
 * the stage entrance) and convert to world space.
 */

import { DUCKS, STAGE_COUNT, STAGE_NAMES, TREADMILLS, W1_STAGES, stageLevel, stageWorld, worldFirst, worldLast } from './gameData.js'

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */

export const C = {
  grass: '#22dd22',
  grassDark: '#17b417',
  dirt: '#d9573f',
  dirtDark: '#b8442f',
  stone: '#3c4262',
  stoneDark: '#262a40',
  stoneLight: '#5a6188',
  brick: '#c6c9d6',
  white: '#f3f6ff',
  water: '#2fe2ff',
  lava: '#ff5a14',
  neonLime: '#b4ff14',
  neonYellow: '#fff01a',
  neonGreen: '#2dff8a',
  neonCyan: '#22f2ff',
  neonRed: '#ff1f2e',
  neonPink: '#ff3df0',
  wood: '#8a5a33',
  woodLight: '#b07a46',
  cloud: '#f2f7ff',
  sky: '#86c9ff',
  gold: '#ffc81a',
  goldDark: '#c99a10',
  purple: '#3a2d63',
  purpleLight: '#6b4bd6',
  metal: '#5c6478',
  hazard: '#ffd01a',
  basalt: '#2a2328',
  sand: '#e9c27a',
  red: '#ff2020',
  pinkCap: '#ff4fa8',
  stem: '#fff3df',
}

export const WORLD_X = { 1: 0, 2: 3000 }
/** Stage gate walls: pale castle stone with coloured banners. */
const WALL = {
  stone: '#b9bfd2',
  trim: '#8a91a8',
  stone2: '#a99be0',
  trim2: '#7a68c8',
  banners: ['#e8384f', '#2f8bff', '#ffc21a', '#2fcf6a'],
}
/** z of the wall that separates each lobby from its Stage 1 / Stage 16 entrance. */
export const COURSE_Z = -30
/**
 * Every stage is built in a narrower "builder" frame and stretched sideways by this
 * factor, so courses, platforms and bridges are all wider than their numbers say.
 */
export const STAGE_LAT = 1.25

/* ------------------------------------------------------------------ */
/* Seeded RNG                                                          */
/* ------------------------------------------------------------------ */

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ------------------------------------------------------------------ */
/* Stage builder                                                       */
/* ------------------------------------------------------------------ */

const THEMES = {
  river: { sky: 'day', cliff: '#b06a32', cliffShade: '#8e5226', cap: '#2fbf3a', canopy: ['#2fae3a', '#46d14f', '#8ad84a'] },
  canyon: { sky: 'day', cliff: '#e0645a', cliffShade: '#c94f47', cap: C.grass, canopy: ['#ff8fe0', '#39ff3a', '#ff6fd0'] },
  lava: { sky: 'ember', cliff: '#7c2a1e', cliffShade: '#5e1f17', cap: '#3a2320', canopy: ['#ff7a1a', '#ffb000'] },
  sky: { sky: 'high', cliff: '#ffffff', cliffShade: '#dbe9ff', cap: C.cloud, canopy: ['#ffd6f6', '#bfffc7'] },
  dark: { sky: 'dusk', cliff: '#3b3550', cliffShade: '#2a2540', cap: '#4b4566', canopy: ['#ff3a6a'] },
  rainbow: { sky: 'night', cliff: '#3a2d63', cliffShade: '#2a2048', cap: '#6b4bd6', canopy: ['#ff8fe0', '#7ff7ff'] },
  crystal: { sky: 'night', cliff: '#4a3b8f', cliffShade: '#382c70', cap: '#7a5cff', canopy: ['#7ff7ff', '#ff7af0'] },
  factory: { sky: 'sunset', cliff: '#c85a7a', cliffShade: '#a8476a', cap: '#ffb04a', canopy: ['#ffd84a', '#ff8fe0'] },
  temple: { sky: 'sunset', cliff: '#d9925a', cliffShade: '#b97646', cap: '#ffd84a', canopy: ['#ffd84a', '#ff8fe0'] },
  neon: { sky: 'night', cliff: '#1a1f3a', cliffShade: '#121630', cap: '#29f3ff', canopy: ['#ff2fd0', '#29f3ff'] },
  volcano: { sky: 'ember', cliff: '#4a2622', cliffShade: '#361b18', cap: '#ff5a14', canopy: ['#ff7a1a'] },
  gold: { sky: 'golden', cliff: '#e8b04a', cliffShade: '#c8902f', cap: '#fff0a0', canopy: ['#ffe066', '#ffffff'] },
}

function createStage(n, world, cx, z0, len, opt = {}) {
  // `half` is in builder units; S.half is the real (world) half-width.
  const half = opt.half ?? 8
  const LAT = STAGE_LAT
  const S = {
    n,
    world,
    cx,
    z0,
    len,
    z1: z0 - len,
    half: half * LAT,
    themeId: opt.theme || 'canyon',
    theme: THEMES[opt.theme || 'canyon'],
    boxes: [],
    dyn: [],
    cyls: [],
    signs: [],
    rocks: [],
    trees: [],
    props: [],
    planes: [],
    killY: opt.killY ?? -6,
    wave: null,
    rise: null,
    pad: null,
    spawn: null,
    indoor: !!opt.indoor,
  }
  const X = (x) => cx + x * LAT
  const Z = (u) => z0 - u
  const r = rng(n * 7919 + 13)
  let dynId = 0

  const a = {
    S,
    X,
    Z,
    r,
    /** Builder-frame half width, and the sideways stretch (for world-space sizes). */
    half,
    LAT,
    /** Block by lateral centre x, width w, top y, height h, forward start u, length l. */
    blk(x, w, top, h, u, l, c, m = 'stud', k = 'solid', extra = null) {
      const b = { x: X(x), y: top - h / 2, z: Z(u + l / 2), w: w * LAT, h, d: l, c, m, k }
      if (extra) Object.assign(b, extra)
      S.boxes.push(b)
      return b
    },
    /** Dynamic object. Box-like dynamics use the same (x,w,top,h,u,l) frame. */
    dynBox(t, x, w, top, h, u, l, c, m, props) {
      const d = { t, id: `${n}:${dynId++}`, x: X(x), y: top - h / 2, z: Z(u + l / 2), w: w * LAT, h, d: l, c, m, k: 'solid', ...props }
      // Sideways movers travel proportionally further on the wider course.
      if (t === 'move' && d.ax === 0) d.amp *= LAT
      S.dyn.push(d)
      return d
    },
    dyn(t, props) {
      const d = { t, id: `${n}:${dynId++}`, ...props }
      S.dyn.push(d)
      return d
    },
    cyl(x, u, top, rad, h, c, m = 'stud', k = 'solid', extra = null) {
      const cy = { x: X(x), z: Z(u), top, r: rad, h, c, m, k }
      if (extra) Object.assign(cy, extra)
      S.cyls.push(cy)
      return cy
    },
    sign(text, x, y, u, size = 3, kind = 'label', extra = null) {
      S.signs.push({ text, x: X(x), y, z: Z(u), ry: 0, size, kind, ...extra })
    },
    prop(type, x, y, u, extra = null) {
      S.props.push({ type, x: X(x), y, z: Z(u), ...extra })
    },
  }

  /** Full course width. */
  a.W = half * 2

  /**
   * Stage gate: a tall castle wall of pale stone across the course, with towers, banners
   * and battlements, and one big archway to run through. Above the arch: "Stage N" and
   * its name. Stages that need a higher level get a glowing force field in the arch
   * that only lets you through once you are strong enough.
   */
  a.entrance = (color = C.stoneDark, floorColor = C.stone, top = 0) => {
    void color
    void floorColor
    const gw = Math.min(half - 1.5, 6.5) // half-width of the opening (builder units)
    // The first gate of a world doubles as the lobby's back wall, so it spans the lobby.
    const ext = n === worldFirst(world) ? 58 / LAT : half + 18
    const H = 15
    const stone = world === 1 ? WALL.stone : WALL.stone2
    const trim = world === 1 ? WALL.trim : WALL.trim2
    const x0 = gw + 1.6
    for (const s of [-1, 1]) {
      const mid = s * (x0 + ext) / 2
      // Wall body (reaches far below the floor so it never floats), plinth and cap.
      a.blk(mid, ext - x0, top + H, H + 14, 0.4, 2.6, stone, 'brick')
      a.blk(mid, ext - x0 + 0.2, top + 1.3, 1.3, 0.15, 3.1, trim, 'smooth', 'deco')
      a.blk(mid, ext - x0 + 0.4, top + H + 0.5, 0.5, 0.15, 3.1, trim, 'smooth', 'deco')
      // Battlements.
      for (let x = x0 + 1.2; x < ext - 0.6; x += 3) a.blk(s * x, 1.4, top + H + 1.9, 1.4, 0.55, 2.3, stone, 'brick', 'deco')
      // Pilasters with hanging banners between them.
      for (let x = x0 + 7; x < ext - 2; x += 9) {
        a.blk(s * x, 1.4, top + H, H, 0.1, 3.3, trim, 'smooth', 'deco')
        const bx = s * (x + 4.5)
        if (Math.abs(bx) < ext - 2) {
          a.blk(bx, 2.4, top + H - 1.4, 6, 0.12, 0.14, WALL.banners[(Math.round(x) + n) % WALL.banners.length], 'smooth', 'deco')
          a.blk(bx, 2.7, top + H - 1.2, 0.3, 0.05, 0.3, C.gold, 'smooth', 'deco')
        }
      }
      // Gate towers.
      a.blk(s * (gw + 0.9), 3, top + H + 3.5, H + 17.5, 0, 3.4, trim, 'brick')
      for (const dx of [-0.95, 0.95]) {
        for (const du of [0.2, 2.6]) a.blk(s * (gw + 0.9) + dx, 0.9, top + H + 4.6, 1.1, du, 0.6, trim, 'brick', 'deco')
      }
      a.blk(s * (gw + 0.9), 3.4, top + 0.9, 0.9, -0.2, 3.8, C.gold, 'smooth', 'deco')
      // Past the wall's end an invisible wall stops anyone walking round it.
      a.blk(s * (ext + 15), 30, top + 40, 60, 0, 3, '#000000', 'invisible')
    }
    // The arch over the opening, with a gold trim and a glowing underside.
    a.blk(0, gw * 2 + 0.4, top + H, 4, 0.4, 2.6, stone, 'brick')
    a.blk(0, gw * 2 + 0.4, top + H - 4 - 0.2, 0.4, 0.2, 3.0, C.gold, 'smooth', 'deco')
    a.blk(0, gw * 2 - 1, top + H - 4.6, 0.12, 1.2, 0.5, C.neonCyan, 'neon', 'deco')
    a.sign(`Stage ${n}`, 0, top + H + 5.2, 0.2, 3.6, 'stage')
    a.sign(STAGE_NAMES[n], 0, top + H - 2, 0.1, 1.25, 'stageSub')
    const req = stageLevel(n)
    if (req > 1) {
      a.sign(`LEVEL ${req} REQUIRED`, 0, top + 9.6, -0.1, 0.85, 'warn')
      a.blk(0, gw * 2, top + H - 4, H - 4, 1.3, 0.3, '#7fe8ff', 'invisible', 'gate', { req })
      S.props.push({ type: 'forcefield', x: X(0), y: top, z: Z(1.45), w: gw * 2 * LAT, h: H - 4, req })
    }
    S.gate = { x: X(0), z: Z(0), w: gw * 2 * LAT, req }
    S.spawn = { x: X(0), y: top + 0.1, z: Z(7.5), yaw: Math.PI }
  }

  /** Invisible side walls that keep players on the course. */
  a.bounds = (top = 40) => {
    for (const s of [-1, 1]) a.blk(s * (half + 0.6), 1.2, top, top + 40, 0, len, '#000000', 'invisible')
  }

  /** Visible side walls (indoor stages). */
  a.walls = (h, c, m = 'stud', top = 0) => {
    for (const s of [-1, 1]) a.blk(s * (half + 0.6), 1.2, top + h, h + 2, 3, len - 3, c, m)
  }

  /** Floor + wins pad; the next stage's entrance sits at u = len. */
  a.endRoom = (floorColor = C.stone, top = 0, l = 16) => {
    a.blk(0, half * 2, top, 1.2, len - l, l, floorColor)
    const pu = len - 9
    const px = -Math.min(half - 3.4, 5.5)
    S.pad = { x: X(px), y: top, z: Z(pu), w: 4.2, d: 4.2 }
    a.blk(px, 4.6, top + 0.12, 0.12, pu - 2.3, 4.6, C.neonGreen, 'neon', 'deco')
  }

  /** Grass island: green top over a red-brick body, with grass drips down the sides. */
  a.island = (x, w, u, l, top = 0, depth = 10, drips = true) => {
    a.blk(x, w, top, 0.7, u, l, C.grass)
    a.blk(x, w - 0.3, top - 0.7, depth, u + 0.15, l - 0.3, C.dirt)
    if (!drips) return
    const count = Math.max(2, Math.floor((w + l) / 5))
    for (let i = 0; i < count; i += 1) {
      const dh = 0.5 + r() * 1.4
      const dw = 0.6 + r() * 1.4
      if (i % 2 === 0) {
        const xx = x - w / 2 + 0.5 + r() * (w - 1)
        const front = r() < 0.5
        a.blk(xx, dw, top - 0.6, dh, front ? u - 0.08 : u + l - 0.08, 0.16, C.grass, 'stud', 'deco')
      } else {
        const uu = u + 0.5 + r() * (l - 1)
        const side = r() < 0.5 ? -1 : 1
        a.blk(x + side * (w / 2 + 0.0), 0.16, top - 0.6, dh, uu, dw, C.grass, 'stud', 'deco')
      }
    }
  }

  a.slab = (x, w, u, l, top = 0, c = C.stone, h = 1) => a.blk(x, w, top, h, u, l, c)

  a.sink = (x, w, u, l, top = 0, c = C.stone, extra = null) =>
    a.dynBox('sink', x, w, top, 1, u, l, c, 'stud', { delay: 0.45, depth: 7, back: 3.2, ...extra })

  /** Oscillating box. ax: 0=x, 1=y, 2=z (z moves along -u). */
  a.mover = (x, w, top, h, u, l, c, ax, amp, per, ph = 0, extra = null) =>
    a.dynBox('move', x, w, top, h, u, l, c, 'stud', { ax, amp, per, ph, ...extra })

  a.blink = (x, w, top, h, u, l, c, per, on0, on1, ph = 0, extra = null) =>
    a.dynBox('blink', x, w, top, h, u, l, c, 'stud', { per, on0, on1, ph, ...extra })

  a.sweeper = (x, u, y, length, spd, ph = 0, c = C.wood, extra = null) =>
    a.dyn('sweep', { x: X(x), z: Z(u), y, len: length, r: 0.45, spd, ph, c, kill: false, ...extra })

  a.pendulum = (x, u, pivotY, length, amp, per, ph = 0, c = C.metal, extra = null) =>
    a.dyn('pend', { x: X(x), z: Z(u), y: pivotY, len: length, r: 1.3, amp, per, ph, c, ...extra })

  a.chevron = (x, u, c = C.neonGreen, top = 0, s = 1) => {
    // A ">" pointing forward (-z), made of two thin glowing bars.
    for (const side of [-1, 1]) {
      a.blk(x + side * 0.75 * s, 1.9 * s, top + 0.04, 0.05, u + 0.35 * s, 0.36 * s, c, 'neon', 'deco')
      a.blk(x + side * 1.4 * s, 0.36 * s, top + 0.04, 0.05, u + 0.35 * s, 1.2 * s, c, 'neon', 'deco')
    }
  }

  /** Low-poly canyon walls + trees just outside the course. */
  a.cliffs = ({ from = 0, to = len, gap = 4, base = -2, height = 1, trees = true, step = 9 } = {}) => {
    for (const s of [-1, 1]) {
      for (let u = Math.max(from, 34); u < to; u += step * (0.7 + r() * 0.5)) {
        const sc = (7 + r() * 6) * height
        const x = s * (half + gap + sc * 0.55 + r() * 4)
        S.rocks.push({ x: X(x), y: base + sc * 0.3, z: Z(u), s: sc, ry: r() * 6.28, v: Math.floor(r() * 3) })
        if (trees && r() < 0.55) {
          S.trees.push({ x: X(x - s * r() * 2), y: base + sc * 1.22, z: Z(u + (r() - 0.5) * 4), s: 0.9 + r() * 0.9, c: Math.floor(r() * 3) })
        }
      }
    }
  }

  a.waterPlane = (y = -2.2, c = C.water, kind = 'water') => {
    S.planes.push({ kind, y, x: X(0), z: Z(len / 2), w: half * 2 * LAT + 80, d: len + 6, c })
  }

  return a
}

/* ------------------------------------------------------------------ */
/* The 25 stages                                                       */
/* ------------------------------------------------------------------ */

const STAGE_SPECS = {
  // ======================= WORLD 1 =======================
  1: { len: 150, half: 18, theme: 'river', killY: -1.6, build: stage1 },
  2: { len: 130, half: 18, theme: 'river', killY: -1.6, build: stage2 },
  3: { len: 140, half: 16, theme: 'river', killY: -1.6, build: stage3 },
  4: { len: 110, half: 10, theme: 'lava', killY: -2.2, build: stage4 },
  5: { len: 130, half: 14, theme: 'lava', killY: -1.2, build: stage5 },
  6: { len: 140, half: 15, theme: 'canyon', killY: -1.6, build: stage6 },
  7: { len: 140, half: 15, theme: 'canyon', killY: -16, build: stage7 },
  8: { len: 150, half: 14, theme: 'sky', killY: -22, build: stage8 },
  9: { len: 160, half: 14, theme: 'canyon', killY: -10, build: stage9 },
  10: { len: 170, half: 12, theme: 'river', killY: -1.35, build: stage10 },
  // World 1 finale stages (harder, behind level gates).
  11: { len: 150, half: 15, theme: 'river', killY: -1.6, build: stage11 },
  12: { len: 150, half: 13, theme: 'canyon', killY: -10, build: stage12 },
  13: { len: 160, half: 14, theme: 'canyon', killY: -10, build: stage13 },
  14: { len: 160, half: 14, theme: 'lava', killY: -1.2, build: stage14 },
  15: { len: 210, half: 16, theme: 'river', killY: -1.6, build: stage15 },
  // ======================= WORLD 2 =======================
  16: { len: 180, half: 15, theme: 'crystal', killY: -14, build: stage16 },
  17: { len: 190, half: 11, theme: 'factory', killY: -14, build: stage17 },
  18: { len: 190, half: 15, theme: 'temple', killY: -14, build: stage18 },
  19: { len: 200, half: 11, theme: 'neon', indoor: true, killY: -10, build: stage19 },
  20: { len: 200, half: 14, theme: 'factory', killY: -5.4, build: stage20 },
  21: { len: 210, half: 16, theme: 'volcano', killY: -10, build: stage21 },
  22: { len: 210, half: 14, theme: 'sky', killY: -18, build: stage22 },
  23: { len: 220, half: 15, theme: 'crystal', killY: -16, build: stage23 },
  24: { len: 240, half: 14, theme: 'volcano', killY: -2.6, build: stage24 },
  25: { len: 260, half: 16, theme: 'gold', killY: -14, build: stage25 },
}

/* ---- Stage 1: River Bridges - three long stone bridges over a river canyon ---- */
function stage1(a) {
  // River canyon: grassy banks, a river below, and three long stone bridges across it.
  const { S, r } = a
  const path = (u, l) => a.blk(0, 4, 0.06, 0.06, u, l, '#c99a5a', 'stud', 'deco')
  a.island(0, a.W, 0, 14)
  a.entrance(C.stoneDark, C.grass)
  a.bounds()
  a.waterPlane()
  a.cliffs({ gap: 3, height: 1.3 })
  path(3, 11)
  const bridge = (u, l, w, logs = [], gaps = []) => {
    let at = u
    for (const g of [...gaps, u + l]) {
      if (g > at) a.blk(0, w, 0.3, 1.2, at, Math.min(g, u + l) - at, '#9aa0b4')
      at = g + 1.6
    }
    for (const x of [-w / 2 + 0.2, w / 2 - 0.2]) a.blk(x, 0.4, 0.42, 0.12, u, l, '#7c8296', 'stud', 'deco')
    for (let p = u + 4; p < u + l - 2; p += 9) a.blk(0, w * 0.6, -0.9, 6, p, 1.6, '#8a90a4', 'stud', 'deco')
    for (const lu of logs) a.blk(0, w + 0.6, 1.0, 0.7, lu, 0.9, C.wood, 'stud', 'solid')
  }
  // Bridge 1: wide and long, two logs to hop.
  bridge(14, 34, 8, [24, 37])
  a.island(0, 26, 48, 12)
  path(48, 12)
  // Bridge 2: narrower, with a broken gap and logs.
  bridge(60, 36, 7, [68, 88], [78])
  a.island(0, 26, 96, 12)
  path(96, 12)
  // Bridge 3: narrowest.
  bridge(108, 28, 6, [116, 127])
  a.island(0, a.W, 136, 14)
  path(136, 6)
  a.endRoom(C.grass, 0, 12)
  for (const [u, side] of [[52, -1], [55, 1], [100, -1], [103, 1], [6, -1], [8, 1]]) {
    S.trees.push({ x: a.X(side * (8 + r() * 4)), y: 0, z: a.Z(u), s: 0.9 + r() * 0.4, c: Math.floor(r() * 3) })
  }
}

/* ---- Stage 2: Bobbing Stones - stones rise and sink between wide grass platforms ---- */
function stage2(a) {
  // Wide grass platforms over a river. Between them, stone blocks bob up and down -
  // ride one too long and it takes you under the water.
  const { r } = a
  a.island(0, a.W, 0, 12)
  a.entrance(C.stoneDark, C.grass)
  a.bounds()
  a.waterPlane()
  a.cliffs({ gap: 3, height: 1.3 })
  let u = 12
  for (let i = 0; i < 7; i += 1) {
    const double = i === 3 || i === 6
    const ch = double ? 11.5 : 6
    const x = (r() - 0.5) * 12
    a.mover(x, 8, -0.6, 1, u + 0.5, 5, C.stone, 1, 1.9, 3.6, i * 0.17)
    if (double) a.mover(-x * 0.5, 8, -0.6, 1, u + 6, 5, C.stoneLight, 1, 1.9, 3.6, i * 0.17 + 0.5)
    u += ch
    if (i < 6) {
      a.island(0, a.W - 6, u, 9, 0, 10)
      u += 9
    }
  }
  a.island(0, a.W, u, a.S.len - u)
  a.endRoom(C.grass, 0, 12)
}

/* ---- Stage 3: Tsunami Terraces - climb high, then race the wave down the terraces ---- */
function stage3(a) {
  const { S } = a
  a.island(0, a.W, 0, 8)
  a.entrance(C.stoneDark, C.grass, 0)
  a.bounds(60)
  a.waterPlane()
  a.cliffs({ gap: 3, height: 1.5 })
  // Grass staircase up to the lookout.
  for (let i = 0; i < 20; i += 1) {
    const top = 0.5 * (i + 1)
    a.blk(0, a.W - 8, top, 0.5, 8 + i, 1, C.grass)
    a.blk(0, a.W - 8.2, top - 0.5, top + 9.5, 8 + i, 1, C.dirt)
  }
  a.island(0, a.W - 2, 28, 10, 10, 20)
  a.sign('RUN! The tsunami is coming!', 0, 14.5, 36, 1.4, 'warn')
  // Terraces stepping down.
  a.island(0, a.W - 2, 40, 12, 8, 18)
  a.slab(-2, a.W - 10, 54, 8, 6.5, C.stone, 10)
  a.island(0, a.W - 2, 64, 12, 5, 16)
  a.blk(-3, 1.6, 6.2, 1.2, 68, 1.6, C.stoneLight)
  a.blk(4, 1.6, 6.2, 1.2, 72, 1.6, C.stoneLight)
  a.slab(-a.W / 4 - 0.6, a.W / 2 - 2.4, 78, 8, 3.5, C.stone, 10)
  a.slab(a.W / 4 + 0.6, a.W / 2 - 2.4, 78, 8, 3.5, C.stone, 10)
  a.island(0, a.W - 2, 88, 12, 2.2, 13)
  a.slab(0, a.W - 10, 102, 8, 1.0, C.stone, 10)
  a.island(0, a.W - 2, 112, 12, 0.4, 11)
  a.blk(0, a.W, 0, 6, 124, 16, C.stone)
  a.endRoom(C.stone)
  S.wave = { triggerU: 30, startU: 16, delay: 0.5, speed: 6.6, stopU: 122, height: 18, color: '#3fe8ff' }
}

/* ---- Stage 4: Lava Floodway - the causeway disappears beneath a repeating tide ---- */
function stage4(a) {
  a.slab(0, a.W, 0, 14, 0, C.basalt, 4)
  a.entrance('#2b2028', C.basalt)
  a.bounds()
  a.waterPlane(-2.4, C.lava, 'lava')
  a.cliffs({ from: 10, to: 98, gap: 5, base: -3, height: 0.8, trees: false, step: 12 })
  const roadTop = 0.12
  a.blk(0, 6, roadTop, 0.8, 14, 80, C.basalt, 'smooth')
  for (let u = 14; u < 94; u += 3.5) {
    a.blk(0, 5.6, roadTop + 0.025, 0.025, u + 0.12, Math.min(3.2, 94 - u - 0.12), '#564a50', 'smooth', 'deco')
  }
  for (const side of [-1, 1]) a.blk(side * 2.94, 0.12, roadTop + 0.04, 0.05, 14, 80, '#dca45b', 'smooth', 'deco')
  a.sign('Climb to high ground when the lava rises!', 0, 3.7, 10.5, 0.85, 'warn')

  // Four shallow steps let players walk onto each refuge without needing a jump.
  for (const u of [32, 56, 80]) {
    for (let i = 0; i < 4; i += 1) {
      a.blk(0, 7, roadTop + (i + 1) * 0.42, 2.8, u - 6 + i, 1, '#4b4654', 'smooth')
      a.blk(0, 7, roadTop + (3 - i) * 0.42, 2.8, u + 2 + i, 1, '#4b4654', 'smooth')
    }
    a.blk(0, 8.4, 1.8, 3.2, u - 2, 4, '#405967', 'smooth')
    for (const side of [-1, 1]) {
      a.blk(side * 3.82, 0.12, 1.85, 0.05, u - 2, 4, '#74dfd9', 'neon', 'deco')
      a.blk(side * 4.05, 0.18, 2.48, 0.68, u - 2, 4, '#313745', 'metal')
    }
    a.sign('SAFE HIGH GROUND', 0, 4.6, u, 0.7)
  }
  a.dyn('flood', {
    x: a.X(0), z: a.Z(54), w: a.W * a.LAT, d: 80, roadTop,
    lowY: -0.9, highY: 0.92, per: 16, ph: 0,
    riseStart: 7, riseEnd: 9.5, drainStart: 13,
  })
  a.slab(0, a.W, 94, 16, 0, C.basalt, 4)
  a.endRoom(C.basalt)
  for (const [x, u] of [[-13, 24], [13, 54], [-13, 85]]) a.prop('firePillar', x, -2.4, u)
}

/* ---- Stage 5: Lava Leap ---- */
function stage5(a) {
  a.slab(0, a.W, 0, 9, 0, C.basalt, 6)
  a.entrance('#2a1a18', C.basalt)
  a.bounds()
  a.waterPlane(-1.6, C.lava, 'lava')
  a.cliffs({ gap: 5, base: -3 })
  a.slab(-2, 5, 10.5, 4, 0, C.stone, 6)
  a.slab(2.5, 5, 17, 4, 0, C.stone, 6)
  a.slab(-2, 5, 23.5, 4, 0, C.stone, 6)
  a.mover(0, 4, 0, 1, 29.5, 4, C.stoneLight, 0, 4, 4.2, 0)
  a.mover(0, 4, 0, 1, 36, 4, C.stoneLight, 0, 4, 4.2, 0.5)
  a.slab(0, 2.2, 42.5, 11.5, 0, C.stone, 6)
  ;[[-1.5, 56], [1.5, 60], [-1.5, 64], [1.5, 68]].forEach(([x, u]) => a.sink(x, 3.4, u, 3.4, 0, '#5a3b3b'))
  a.slab(0, 14, 72, 10, 0, C.basalt, 6)
  a.sweeper(0, 77, 0.65, 6.5, 2.0, 0, C.lava, { kill: true, fire: true })
  a.mover(-2, 4, 0.6, 1, 85, 4, C.stoneLight, 1, 1.0, 3, 0)
  a.mover(2, 4, 0.6, 1, 92, 4, C.stoneLight, 1, 1.0, 3, 0.5)
  a.slab(-3, 5, 99, 4, 0, C.stone, 6)
  a.slab(3, 5, 105.5, 4, 0, C.stone, 6)
  a.slab(0, a.W, 112, 18, 0, C.basalt, 6)
  a.endRoom(C.basalt)
  for (const [x, u] of [[-7, 40], [7, 60], [-7, 90], [7, 110]]) a.prop('firePillar', x, -1.6, u)
}

/* ---- Stage 6: Spinner Islands ---- */
function stage6(a) {
  a.island(0, a.W, 0, 8.5)
  a.entrance(C.stoneDark, C.grass)
  a.bounds()
  a.waterPlane()
  a.cliffs({ gap: 6 })
  const isl = (u, rad, sweeps) => {
    a.cyl(0, u, 0, rad, 10, C.grass, 'stud', 'solid', { island: true })
    sweeps.forEach(([spd, ph]) => a.sweeper(0, u, 0.65, rad - 0.3, spd, ph, C.wood))
    a.cyl(0, u, 1.0, 0.7, 1.0, C.woodLight)
  }
  const plank = (x, u, l, w = 3.6) => a.blk(x, w, 0, 0.5, u, l, C.woodLight, 'smooth')
  isl(18, 6.5, [[1.3, 0]])
  plank(0, 24, 9.5)
  isl(39.5, 6.5, [[-1.7, 0]])
  plank(0, 45.5, 4.5)
  plank(0, 51.5, 4.5)
  isl(62, 7, [[1.5, 0], [1.5, Math.PI / 2]])
  plank(-2, 68.5, 6)
  plank(2, 73.5, 6)
  isl(85, 6.5, [[2.2, 0]])
  plank(0, 91, 9.5)
  isl(107, 7, [[-1.2, 0], [-1.2, Math.PI / 2]])
  plank(0, 113.5, 11)
  a.island(0, a.W, 124, 16, 0)
  a.endRoom(C.grass, 0, 14)
}

/* ---- Stage 7: Mushroom Bounce ---- */
function stage7(a) {
  const { S } = a
  a.island(0, a.W, 0, 8, 0, 30)
  a.entrance(C.stoneDark, C.grass)
  a.bounds()
  a.cliffs({ gap: 6, base: -14, height: 1.6 })
  S.planes.push({ kind: 'ground', y: -30, x: a.X(0), z: a.Z(S.len / 2), w: 120, d: S.len + 6, c: '#1fa83a' })
  const shroom = (x, u, top, rad = 2.6) => {
    a.cyl(x, u, top, rad, 1.2, C.pinkCap, 'smooth', 'bounce', { power: 20, mushroom: true })
    a.cyl(x, u, top - 1.2, 0.8, 30, C.stem, 'smooth', 'deco')
  }
  shroom(0, 12.5, 0)
  shroom(-2, 22, 1.0)
  shroom(1.5, 31.5, 0.5)
  shroom(-1.5, 41, 2.0)
  shroom(2, 50.5, 0.8)
  a.island(0, 14, 54.5, 9, 1.5, 30)
  shroom(0, 70, 0.5)
  shroom(-2, 79.5, 1.8)
  shroom(1.5, 89, 0.6)
  shroom(-1, 98.5, 1.4)
  shroom(1, 108, 0.4)
  a.island(0, a.W, 112.5, 27.5, 0, 30)
  a.endRoom(C.grass, 0, 14)
}

/* ---- Stage 8: Sky Bridge ---- */
function stage8(a) {
  const { S } = a
  const cl = C.cloud
  a.slab(0, a.W, 0, 8, 0, cl, 2)
  a.entrance('#9fc6ff', cl)
  a.bounds()
  S.planes.push({ kind: 'clouds', y: -18, x: a.X(0), z: a.Z(S.len / 2), w: 160, d: S.len + 60, c: '#ffffff' })
  a.slab(0, 3.6, 8, 14, 0, cl, 1)
  a.slab(0, 5, 22, 4, 0, cl, 1)
  a.mover(0, 4, 0, 1, 28, 4, '#bfe0ff', 0, 4.5, 5, 0)
  a.mover(0, 4, 0, 1, 34.5, 4, '#bfe0ff', 0, 4.5, 5, 0.5)
  a.slab(0, 5, 41, 5, 0, cl, 1)
  a.mover(0, 4, 0, 1, 50, 4, '#bfe0ff', 2, 3.5, 4, 0)
  a.slab(0, 5, 59, 5, 0, cl, 1)
  for (let row = 0; row < 5; row += 1) {
    for (const x of [-3.2, 0, 3.2]) {
      const setB = (row + Math.round(x / 3.2)) % 2 !== 0
      a.blink(x, 3, 0, 1, 66 + row * 3.5, 3, '#ffffff', 3.2, 0, 0.6, setB ? 0.5 : 0, { cloudTile: true })
    }
  }
  a.slab(-4, 3, 84.5, 11.5, 0, cl, 1)
  a.slab(0, 10, 95, 2, 0, cl, 1)
  a.slab(4, 3, 96, 11, 0, cl, 1)
  a.mover(4, 4, 0, 1, 108, 4, '#bfe0ff', 1, 2, 3.5, 0)
  a.mover(0, 4, 0, 1, 114, 4, '#bfe0ff', 1, 2, 3.5, 0.33)
  a.mover(-4, 4, 0, 1, 120, 4, '#bfe0ff', 1, 2, 3.5, 0.66)
  a.slab(-4, 5, 126, 5, 2, cl, 1)
  a.slab(0, a.W, 134, 16, 0, cl, 2)
  a.endRoom(cl)
  for (let i = 0; i < 14; i += 1) a.prop('cloud', (a.r() - 0.5) * 70, -6 - a.r() * 10, a.r() * S.len, { s: 3 + a.r() * 5 })
}

/* ---- Stage 9: Boulder Canyon ---- */
function stage9(a) {
  const { S, Z } = a
  a.blk(0, a.W, 0, 2, 0, S.len - 16, C.grass)
  a.entrance(C.stoneDark, C.grass)
  a.bounds()
  a.cliffs({ gap: 3, height: 1.5 })
  // Dirt lanes the boulders roll in.
  for (const x of [-10.5, -3.5, 3.5, 10.5]) a.blk(x, 3.4, 0.03, 0.05, 12, 126, C.sand, 'smooth', 'deco')
  for (const u of [32, 58, 84, 110]) for (const x of [-7, 0, 7]) a.blk(x, 1.4, 2.4, 2.4, u, 3, C.stoneLight)
  const lanes = [[-10.5, 8.5, 0], [-3.5, 7.0, 0.3], [3.5, 9.0, 0.6], [10.5, 7.6, 0.15]]
  for (const [x, per, ph] of lanes) {
    for (const k of [0, 0.5]) a.dyn('boulder', { x: a.X(x), r: 1.7, zA: Z(136), zB: Z(12), per, ph: (ph + k) % 1, floor: 0 })
  }
  a.prop('arch', 0, 0, 136, { w: a.W * a.LAT })
  a.endRoom(C.stone)
}

/* ---- Stage 10: Flooded Bridges ---- */
function stage10(a) {
  a.island(0, a.W, 0, 12, 0, 6)
  a.entrance(C.stoneDark, C.grass)
  a.bounds()
  a.waterPlane(-1.45)
  a.cliffs({ gap: 7, base: -3, height: 0.65, step: 13 })

  const collapse = (x, w, u, l, delay, i) => a.sink(x, w, u, l, 0.18, i % 2 ? C.woodLight : '#966039', {
    m: 'smooth', bridgeDeck: true, delay, depth: 4.8, back: 3.5,
  })
  const pilings = (u, w) => {
    for (const side of [-1, 1]) a.cyl(side * (w / 2 + 0.6), u, -0.15, 0.22, 3.5, C.wood, 'smooth', 'deco')
  }

  // Timber sections shake underfoot, then fall into the river.
  a.sign('Keep moving! The planks will collapse!', 0, 3.8, 9, 0.9, 'warn')
  for (let i = 0; i < 10; i += 1) {
    collapse(0, 7, 12 + i * 3.4, 3.28, 0.95, i)
    if (i % 3 === 0) pilings(13 + i * 3.4, 7)
  }
  a.island(0, 14, 46, 10, 0, 6)

  // Flooded pontoon decks emerge and sink below the visible waterline.
  a.sign('Wait for the bridge to rise, then jump!', 0, 3.8, 51, 0.9, 'label')
  for (let i = 0; i < 4; i += 1) {
    a.mover(i % 2 ? 0.9 : -0.9, 5.6, 0.1, 0.45, 56 + i * 9, 8.2, C.woodLight, 1, 1.75, 11, -i * 0.12, {
      m: 'smooth', bridgeDeck: true,
    })
  }
  a.island(0, 14, 92, 12, 0, 6)

  // A narrower broken crossing with one small island to catch your breath.
  a.sign('RUN! This bridge is breaking!', 0, 3.8, 100, 1, 'warn')
  for (let i = 0; i < 8; i += 1) collapse(i < 4 ? -1.6 : 1.6, 6, 104 + i * 3, 2.88, 0.75, i)
  a.island(0, 12, 128, 8, 0, 6)
  for (let i = 0; i < 6; i += 1) collapse(i % 2 ? 0.6 : -0.6, 5.6, 136 + i * 3, 2.88, 0.65, i)
  a.island(0, a.W, 154, 16, 0, 6)
  a.endRoom(C.grass)
}

/* ---- Stage 11: Log Rollers - spinning logs on a wide bridge, stepping stones, sliding planks ---- */
function stage11(a) {
  const { r } = a
  a.island(0, a.W, 0, 12)
  a.entrance(C.stoneDark, C.grass)
  a.bounds()
  a.waterPlane()
  a.cliffs({ gap: 3, height: 1.3 })
  a.sign('Jump the rolling logs!', 0, 3.6, 10, 0.9, 'warn')
  // A wide stone bridge swept by three spinning logs.
  a.blk(0, 10, 0.3, 1.2, 12, 46, '#9aa0b4')
  for (const x of [-4.8, 4.8]) a.blk(x, 0.4, 0.42, 0.12, 12, 46, '#7c8296', 'stud', 'deco')
  ;[[22, 1.5, 0], [34, -1.8, 0.3], [46, 2.1, 0.6]].forEach(([u, spd, ph]) => a.sweeper(0, u, 0.75, 6.6, spd, ph, C.wood))
  a.island(0, 24, 58, 10)
  // Stepping stones across the river.
  let u = 70
  for (let i = 0; i < 7; i += 1) {
    a.cyl((i % 2 ? 1 : -1) * (0.8 + r() * 0.8), u, 0, 2.3, 8, C.stone, 'stud', 'solid', { island: true })
    u += 3.9
  }
  a.island(0, 24, 100, 9)
  // Planks sliding side to side.
  a.sign('Ride the sliding planks!', 0, 3.6, 104, 0.9, 'label')
  for (let i = 0; i < 5; i += 1) a.mover(0, 4.4, 0.1, 0.5, 110 + i * 4.4, 3.6, i % 2 ? C.woodLight : C.wood, 0, 4.2, 3.4 + i * 0.25, i * 0.21)
  a.island(0, a.W, 132, 18)
  a.endRoom(C.grass, 0, 14)
}

/* ---- Stage 12: Axe Causeway - giant axes swing across a stone causeway ---- */
function stage12(a) {
  const { S, r } = a
  a.slab(0, a.W, 0, 10, 0, C.stone, 3)
  a.entrance(C.stoneDark, C.stone)
  a.bounds()
  a.cliffs({ gap: 6, base: -12, height: 1.4 })
  S.planes.push({ kind: 'ground', y: -26, x: a.X(0), z: a.Z(S.len / 2), w: 140, d: S.len + 6, c: '#1fa83a' })
  // Causeway with a glowing centre line.
  a.slab(0, 9, 10, 40, 0, C.stoneLight, 3)
  a.blk(0, 0.4, 0.03, 0.05, 10, 40, C.neonYellow, 'neon', 'deco')
  a.sign('Time your run between the axes!', 0, 4, 9, 0.9, 'warn')
  ;[18, 27, 36, 45].forEach((u, i) => a.pendulum(0, u, 9, 7.4, 1.0, 2.1 + i * 0.15, r()))
  // Sinking stones over the drop.
  a.slab(0, 12, 50, 6, 0, C.stone, 3)
  for (let i = 0; i < 6; i += 1) a.sink((i % 2 ? 1 : -1) * 2.2, 4.2, 58 + i * 4.2, 3.6, 0, i % 2 ? C.stoneLight : C.stone)
  a.slab(0, 12, 84, 8, 0, C.stone, 3)
  // Narrow causeway: faster axes, then on/off tiles.
  a.slab(0, 7, 92, 26, 0, C.stoneLight, 3)
  ;[98, 106, 114].forEach((u) => a.pendulum(0, u, 9, 7.4, 1.1, 1.7 + r() * 0.3, r()))
  for (let row = 0; row < 4; row += 1) {
    for (const x of [-2.6, 0, 2.6]) a.blink(x, 2.5, 0, 1, 118 + row * 3, 2.8, row % 2 ? '#ffd01a' : '#ff8a1a', 3, 0, 0.62, ((row + Math.round(x / 2.6) + 2) % 2) * 0.5)
  }
  a.slab(0, a.W, 130, 20, 0, C.stone, 3)
  a.endRoom(C.stone)
}

/* ---- Stage 13: Crumbling Cliffs - collapsing tiles and rolling boulders ---- */
function stage13(a) {
  const { S, Z } = a
  a.island(0, a.W, 0, 10, 0, 30)
  a.entrance(C.stoneDark, C.grass)
  a.bounds()
  a.cliffs({ gap: 4, base: -14, height: 1.5 })
  S.planes.push({ kind: 'ground', y: -30, x: a.X(0), z: a.Z(S.len / 2), w: 140, d: S.len + 6, c: '#1fa83a' })
  a.sign("Don't stop - the cliff is crumbling!", 0, 3.8, 9, 0.9, 'warn')
  // A field of crumbling tiles.
  for (let row = 0; row < 8; row += 1) {
    for (let col = -2; col <= 2; col += 1) {
      a.sink(col * 4.6, 4.2, 12 + row * 4.4, 4, 0, (row + col + 4) % 2 ? C.dirt : C.dirtDark, { delay: 0.55, depth: 30, back: 3 })
    }
  }
  a.island(0, a.W, 48, 8, 0, 30)
  // Boulder alley.
  a.blk(0, a.W, 0, 2, 56, 46, C.grass)
  for (const x of [-9, -3, 3, 9]) a.blk(x, 3.4, 0.03, 0.05, 56, 46, C.sand, 'smooth', 'deco')
  ;[[-9, 6.5, 0], [-3, 5.6, 0.35], [3, 7.2, 0.7], [9, 6.0, 0.15]].forEach(([x, per, ph]) => {
    for (const k of [0, 0.5]) a.dyn('boulder', { x: a.X(x), r: 1.6, zA: Z(100), zB: Z(58), per, ph: (ph + k) % 1, floor: 0 })
  })
  // Narrow crumbling ledges to the finish.
  a.island(0, a.W, 102, 6, 0, 30)
  for (let i = 0; i < 9; i += 1) a.sink(i % 2 ? 2.4 : -2.4, 5, 108 + i * 3.6, 3.2, 0, i % 2 ? C.dirt : C.dirtDark, { delay: 0.4, depth: 30, back: 3 })
  a.island(0, a.W, 141, 19, 0, 30)
  a.endRoom(C.grass)
}

/* ---- Stage 14: Spinning Lava Wheels - turntables and fire arms over lava ---- */
function stage14(a) {
  const { r } = a
  a.slab(0, a.W, 0, 10, 0, C.basalt, 6)
  a.entrance('#2b2028', C.basalt)
  a.bounds()
  a.waterPlane(-1.6, C.lava, 'lava')
  a.cliffs({ gap: 5, base: -3, height: 0.9, trees: false })
  a.sign('Ride the wheels - mind the fire!', 0, 3.8, 9, 0.9, 'warn')
  let u = 10
  let i = 0
  while (u < 128) {
    const rad = 4.4 + r() * 1.4
    u += rad + 2.2
    const x = (r() - 0.5) * 7
    const spd = (i % 2 ? -1 : 1) * (0.8 + r() * 0.6)
    a.dyn('disk', { x: a.X(x), z: a.Z(u), top: 0, r: rad, h: 1.2, spd, c: i % 2 ? '#ff8a1a' : '#5a4650' })
    if (i % 2 === 1) a.sweeper(x, u, 0.65, rad - 0.4, spd * 2.4, 0, C.lava, { kill: true, fire: true })
    u += rad
    // A small basalt step between some wheels.
    if (i % 3 === 2) {
      a.slab(x * 0.5, 4, u + 0.6, 2.4, 0, C.basalt, 6)
      u += 3
    }
    i += 1
  }
  a.slab(0, a.W, u + 2.2, 160 - u - 2.2, 0, C.basalt, 6)
  a.endRoom(C.basalt)
  for (const [x, uu] of [[-15, 30], [15, 70], [-15, 110]]) a.prop('firePillar', x, -1.6, uu)
}

/* ---- Stage 15: Great Duck Escape - World 1 finale: outrun a huge tsunami ---- */
function stage15(a) {
  const { S } = a
  a.island(0, a.W, 0, 14)
  a.entrance(C.stoneDark, C.grass)
  a.bounds(60)
  a.waterPlane()
  a.cliffs({ gap: 3, height: 1.6 })
  a.sign('THE FINAL ESCAPE - RUN FOR THE HILLS!', 0, 4, 12, 1.1, 'warn')
  // Long gentle climb with logs to hop, so speed matters more than skill.
  for (let i = 0; i < 12; i += 1) {
    const top = 0.35 * (i + 1)
    a.blk(0, a.W - 6, top, 0.35, 14 + i * 3, 3, C.grass)
    a.blk(0, a.W - 6.2, top - 0.35, top + 9.6, 14 + i * 3, 3, C.dirt)
  }
  a.island(0, a.W - 4, 50, 20, 4.2, 14)
  for (const u of [56, 64]) a.blk(0, a.W - 8, 5.0, 0.8, u, 1, C.wood)
  // A wide bridge with spinning logs.
  a.blk(0, 12, 4.2, 1.2, 70, 30, '#9aa0b4')
  a.sweeper(0, 79, 4.95, 7.4, 1.9, 0, C.wood)
  a.sweeper(0, 91, 4.95, 7.4, -2.2, 0.4, C.wood)
  a.island(0, a.W - 4, 100, 14, 4.2, 14)
  // Bobbing stones, then the final stairs up to safety.
  for (let i = 0; i < 4; i += 1) a.mover(i % 2 ? 3 : -3, 8, 3.6, 1, 116 + i * 6, 5, i % 2 ? C.stoneLight : C.stone, 1, 1.2, 3.2, i * 0.25)
  a.island(0, a.W - 4, 140, 14, 4.2, 14)
  for (let i = 0; i < 10; i += 1) {
    const top = 4.2 + 0.5 * (i + 1)
    a.blk(0, a.W - 6, top, 0.5, 154 + i * 2, 2, C.grass)
    a.blk(0, a.W - 6.2, top - 0.5, top + 9.5, 154 + i * 2, 2, C.dirt)
  }
  a.island(0, a.W, 174, 36, 9.2, 20)
  a.endRoom(C.grass, 9.2, 16)
  S.wave = { triggerU: 22, startU: 6, delay: 1.2, speed: 9.2, stopU: 172, height: 24, color: '#3fe8ff' }
  a.prop('worldGate', 0, 9.2, S.len - 3, { world: 2 })
}

/* ---- Stage 16: Crystal Caves ---- */
function stage16(a) {
  const { S, r } = a
  a.slab(0, a.W, 0, 9, 0, C.purple, 4)
  a.entrance('#241a45', C.purple)
  a.bounds()
  a.cliffs({ gap: 4, base: -8, height: 1.4, trees: false })
  S.planes.push({ kind: 'glow', y: -12, x: a.X(0), z: a.Z(S.len / 2), w: 120, d: S.len + 10, c: '#7a3dff' })
  let x = 0
  let top = 0
  let i = 0
  for (let u = 15; u < 160; u += 8.2, i += 1) {
    x = Math.max(-7, Math.min(7, x + (r() - 0.5) * 10))
    top = Math.max(0, Math.min(3.5, top + (r() - 0.45) * 2.4))
    a.cyl(x, u, top, 2.3, top + 14, i % 2 ? '#7ff7ff' : '#ff7af0', 'crystal')
    if (r() < 0.45) a.cyl(-x * 0.6 + (r() - 0.5) * 4, u + 4, Math.max(0, top - 1), 1.7, 14, '#b48cff', 'crystal')
  }
  a.slab(0, a.W, 160, 20, 0, C.purple, 4)
  a.endRoom(C.purple)
  for (let k = 0; k < 18; k += 1) a.prop('crystals', (r() < 0.5 ? -1 : 1) * (a.half + 2 + r() * 6), -2 + r() * 4, r() * S.len, { s: 1 + r() * 2 })
}

/* ---- Stage 17: Conveyor Chaos ---- */
function stage17(a) {
  const { S } = a
  a.slab(0, 22, 0, 8, 0, C.metal, 4)
  a.entrance('#3a3f52', C.metal)
  a.walls(8, C.metal, 'metal')
  S.planes.push({ kind: 'glow', y: -12, x: a.X(0), z: a.Z(S.len / 2), w: 40, d: S.len, c: '#ff6a1a' })
  const belt = (x, w, u, l, vx, vz) => a.blk(x, w, 0, 1, u, l, '#2b2f3a', 'belt', 'conv', { cv: [vx, vz] })
  const edge = (x, w, u, l) => {
    a.blk(x - w / 2 - 0.15, 0.3, 0.12, 0.2, u, l, C.hazard, 'stud', 'deco')
    a.blk(x + w / 2 + 0.15, 0.3, 0.12, 0.2, u, l, C.hazard, 'stud', 'deco')
  }
  belt(0, 10, 8, 32, 0, 7)
  edge(0, 10, 8, 32)
  for (const [x, vz] of [[-6, 10], [0, -6], [6, 4]]) {
    belt(x, 5, 44, 26, 0, vz)
    edge(x, 5, 44, 26)
  }
  belt(0, 16, 74, 15, 8, 0)
  belt(0, 16, 89, 15, -8, 0)
  edge(0, 16, 74, 30)
  belt(-5, 3.5, 108, 12, 0, 8)
  belt(-1, 11.5, 120, 3.5, 5, 0)
  belt(5, 3.5, 123.5, 12.5, 0, 8)
  a.slab(0, 22, 140, 4, 0, C.metal, 4)
  belt(0, 12, 144, 30, 0, 8)
  edge(0, 12, 144, 30)
  for (const u of [152, 161, 169]) a.blk(0, 12, 0.9, 0.6, u, 0.8, C.hazard)
  a.slab(0, 22, 174, 16, 0, C.metal, 4)
  a.endRoom(C.metal)
}

/* ---- Stage 18: Pendulum Hall ---- */
function stage18(a) {
  const { r } = a
  const st = '#b08a4a'
  a.slab(0, a.W, 0, 8, 0, st, 4)
  a.entrance('#6b4a2a', st)
  a.bounds()
  a.cliffs({ gap: 6, base: -8, height: 1.3 })
  a.slab(0, 4, 8, 52, 0, st, 2)
  ;[18, 28, 38, 48].forEach((u) => a.pendulum(0, u, 9, 7.4, 1.0, 2.2 + r() * 0.6, r()))
  a.slab(0, 18, 60, 12, 0, st, 3)
  a.slab(0, 6, 72, 46, 0, st, 2)
  ;[82, 92, 102, 112].forEach((u) => a.pendulum(0, u, 9, 7.4, 1.05, 1.8 + r() * 0.4, r()))
  a.slab(0, 14, 118, 8, 0, st, 3)
  a.slab(-4, 4, 126, 14, 0, st, 2)
  a.slab(0, 12, 140, 4, 0, st, 2)
  a.slab(4, 4, 144, 14, 0, st, 2)
  a.slab(0, 12, 158, 4, 0, st, 2)
  a.slab(-3, 4, 162, 12, 0, st, 2)
  a.pendulum(-4, 134, 9, 7.4, 0.9, 2.0, 0.2)
  a.pendulum(4, 151, 9, 7.4, 0.9, 1.9, 0.7)
  a.pendulum(-3, 168, 9, 7.4, 0.9, 1.7, 0.4)
  a.slab(0, a.W, 174, 16, 0, st, 4)
  a.endRoom(st)
  for (const u of [10, 60, 118, 174]) for (const s of [-1, 1]) a.prop('column', s * 9, 0, u + 2, { h: 14 })
}

/* ---- Stage 19: Laser Grid ---- */
function stage19(a) {
  const { S } = a
  const fl = '#141826'
  a.entrance('#0e1120', fl)
  a.blk(0, 22, 0, 1, 3, S.len - 3, fl)
  a.walls(11, '#161a2c')
  for (let u = 6; u < S.len - 16; u += 4) a.blk(0, 22, 0.03, 0.04, u, 0.1, C.neonCyan, 'neon', 'deco')
  for (let x = -9; x <= 9; x += 4.5) a.blk(x, 0.1, 0.03, 0.04, 3, S.len - 19, C.neonCyan, 'neon', 'deco')
  const L = { m: 'laser', k: 'kill' }
  const pink = C.neonPink
  ;[14, 20, 26].forEach((u, i) => a.blink(0, 21.6, 7, 7, u, 0.3, pink, 2.0, 0, 0.5, i * 0.25, L))
  a.cyl(0, 44, 2.6, 0.9, 2.6, '#161a2c')
  a.sweeper(0, 44, 0.6, 10.4, 2.2, 0, pink, { kill: true, r: 0.22 })
  a.cyl(0, 62, 2.6, 0.9, 2.6, '#161a2c')
  a.sweeper(0, 62, 0.6, 10.4, -2.6, 0, pink, { kill: true, r: 0.22 })
  a.cyl(0, 80, 2.6, 0.9, 2.6, '#161a2c')
  a.sweeper(0, 80, 0.6, 10.4, 1.8, 0, pink, { kill: true, r: 0.22 })
  a.sweeper(0, 80, 0.6, 10.4, 1.8, Math.PI / 2, pink, { kill: true, r: 0.22 })
  ;[96, 102, 108].forEach((u, i) => a.mover(0, 11, 7, 7, u, 0.4, pink, 0, 5.6, 2.4, i * 0.33, L))
  ;[122, 128, 134].forEach((u, i) => a.mover(0, 21.6, 0.6, 0.25, u, 0.25, C.neonCyan, 2, 2.6, 2.0, i * 0.3, L))
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 7; col += 1) {
      const setB = (row + col) % 2 === 1
      a.blink(-9.3 + col * 3.1, 3.0, 0.09, 0.08, 146 + row * 3.1, 3.0, pink, 2.2, 0, 0.45, setB ? 0.5 : 0, { ...L, floorLaser: true })
    }
  }
  a.endRoom(fl)
}

/* ---- Stage 20: Piston Peaks ---- */
function stage20(a) {
  a.slab(0, a.W, 0, 8, 0, C.metal, 4)
  a.entrance('#3a3f52', C.metal)
  a.bounds()
  a.cliffs({ gap: 6, base: -6 })
  a.waterPlane(-6, '#7dff1a', 'toxic')
  let i = 0
  for (let u = 11; u < 166; u += 6.5, i += 1) {
    if (i % 7 === 6) {
      a.slab(0, 12, u, 4.5, 1, C.metal, 8)
      continue
    }
    const x = [0, -3.5, 3.5, 0, 3.5, -3.5][i % 6]
    a.mover(x, 4.5, 0, 12, u, 4.5, i % 2 ? '#29c8ff' : '#7a8299', 1, 2.6, 3.0, i * 0.11)
  }
  a.slab(0, a.W, 168, 32, 0, C.metal, 4)
  a.endRoom(C.metal)
}

/* ---- Stage 21: Meteor Shower ---- */
function stage21(a) {
  const { S, r, Z } = a
  a.blk(0, a.W, 0, 2, 0, S.len, C.basalt)
  a.entrance('#2a1a18', C.basalt)
  a.bounds()
  a.cliffs({ gap: 4, height: 1.5 })
  for (let k = 0; k < 14; k += 1) {
    const u = 14 + r() * 176
    a.blk((r() - 0.5) * (a.W - 4), 0.18, 0.03, 0.05, u, 3 + r() * 6, C.lava, 'neon', 'deco')
  }
  for (let u = 20; u < 192; u += 9.5) {
    const n = 2 + (r() < 0.4 ? 1 : 0)
    for (let j = 0; j < n; j += 1) {
      a.dyn('meteor', { x: a.X((r() - 0.5) * (a.W - 4)), z: Z(u + (r() - 0.5) * 4), r: 3.2, per: 3.4 + r() * 1.8, ph: r(), floor: 0 })
    }
  }
  a.endRoom(C.basalt)
}

/* ---- Stage 22: Wind Tunnel ---- */
function stage22(a) {
  const { S } = a
  const cl = '#e8f0ff'
  a.slab(0, a.W, 0, 8, 0, cl, 2)
  a.entrance('#9fc6ff', cl)
  a.bounds()
  S.planes.push({ kind: 'clouds', y: -16, x: a.X(0), z: a.Z(S.len / 2), w: 180, d: S.len + 60, c: '#ffffff' })
  const gust = (x, w, u, l, vx, per, ph = 0) => {
    a.dyn('wind', { x: a.X(x), z: a.Z(u + l / 2), w: w * a.LAT, d: l, y0: -2, y1: 6, vx, vz: 0, per, on0: 0, on1: 0.5, ph })
    a.prop('fan', vx > 0 ? -a.half - 1 : a.half + 1, 1, u + l / 2, { dir: vx > 0 ? 1 : -1, per, ph, l })
  }
  a.slab(0, 4, 8, 42, 0, cl, 1)
  gust(0, a.W, 12, 36, 9, 3.0, 0)
  a.slab(2, 3, 54, 36, 0, cl, 1)
  gust(0, a.W, 56, 32, -9, 3.0, 0.5)
  a.slab(0, 12, 94, 10, 0, cl, 1)
  a.slab(-3, 3, 106, 22, 0, cl, 1)
  gust(0, a.W, 108, 18, 10, 2.6, 0.2)
  a.slab(3, 3, 128, 22, 0, cl, 1)
  gust(0, a.W, 130, 18, -10, 2.6, 0.7)
  a.slab(0, 12, 150, 6, 0, cl, 1)
  a.slab(0, 2.6, 156, 38, 0, cl, 1)
  gust(0, a.W, 158, 34, 12, 2.4, 0.4)
  a.slab(0, a.W, 194, 16, 0, cl, 2)
  a.endRoom(cl)
}

/* ---- Stage 23: Turntables ---- */
function stage23(a) {
  const { S, r } = a
  a.slab(0, a.W, 0, 9, 0, C.purple, 4)
  a.entrance('#241a45', C.purple)
  a.bounds()
  a.cliffs({ gap: 5, base: -8, trees: false })
  S.planes.push({ kind: 'glow', y: -14, x: a.X(0), z: a.Z(S.len / 2), w: 120, d: S.len + 10, c: '#29c8ff' })
  let u = 9
  let i = 0
  while (u < 186) {
    const rad = 5 + r() * 1.6
    u += rad + 2.6
    const x = (r() - 0.5) * 6
    const spd = (r() < 0.5 ? -1 : 1) * (0.7 + r() * 0.7)
    a.dyn('disk', { x: a.X(x), z: a.Z(u), top: 0, r: rad, h: 1.2, spd, c: i % 2 ? '#29c8ff' : '#ff7af0' })
    if (i % 3 === 2) a.sweeper(x, u, 0.65, rad - 0.4, spd * 2.2, 0, '#ffffff')
    u += rad
    i += 1
  }
  a.slab(0, a.W, u + 2.6, S.len - u - 2.6, 0, C.purple, 4)
  a.endRoom(C.purple)
}

/* ---- Stage 24: Lava Rising ---- */
function stage24(a) {
  const { S } = a
  a.slab(0, a.W, 0, 10, 0, C.basalt, 6)
  a.entrance('#2a1a18', C.basalt)
  a.walls(52, '#3a2622', 'stud', -6)
  for (let i = 0; i < 30; i += 1) {
    const x = i % 2 ? 3 : -3
    a.slab(x, 5, 12 + i * 5, 4.4, 1.2 * (i + 1), i % 3 === 2 ? '#5a3b3b' : C.stone, 1.2)
  }
  a.slab(0, a.W, 162, 28, 36, C.basalt, 3)
  a.sign('Lava stops here!', 0, 41, 166, 1.4, 'warn')
  a.slab(0, a.W, 190, 10, 29, C.basalt, 3)
  a.slab(0, a.W, 200, 10, 21, C.basalt, 3)
  a.slab(0, a.W, 210, 8, 13, C.basalt, 3)
  a.slab(0, a.W, 218, 6, 6, C.basalt, 3)
  a.blk(0, a.W, 0, 2, 224, 16, C.basalt)
  a.endRoom(C.basalt)
  S.rise = { triggerU: 12, y0: -3, speed: 1.3, delay: 2.5, maxY: 34, stopU: 188, color: C.lava }
}

/* ---- Stage 25: Golden Temple ---- */
function stage25(a) {
  const { S, r } = a
  const g = C.gold
  a.slab(0, a.W, 0, 9, 0, g, 4)
  a.entrance('#8a6a14', g)
  a.bounds()
  a.cliffs({ gap: 5, base: -8, height: 1.3 })
  S.planes.push({ kind: 'glow', y: -12, x: a.X(0), z: a.Z(S.len / 2), w: 120, d: S.len + 10, c: '#ffd84a' })
  for (let row = 0; row < 15; row += 1) {
    for (const x of [-4, 0, 4]) {
      if (x !== 0 && r() < 0.22) continue
      a.sink(x, 3.4, 10 + row * 3.4, 3.0, 0, row % 2 ? g : C.goldDark, { delay: 0.32 })
    }
  }
  a.slab(0, a.W - 4, 62, 48, 0, g, 4)
  a.sweeper(0, 74, 0.65, 9.4, 2.4, 0, '#fff3c0')
  a.sweeper(0, 74, 0.65, 9.4, 2.4, Math.PI / 2, '#fff3c0')
  a.sweeper(0, 96, 0.65, 9.4, -2.8, 0, '#fff3c0')
  a.pendulum(-6, 86, 10, 8.4, 0.8, 2.0, 0)
  a.pendulum(6, 86, 10, 8.4, 0.8, 2.0, 0.5)
  a.slab(0, a.W - 8, 110, 134, 0, g, 4)
  for (let u = 124; u < 238; u += 12) a.blk(0, a.W - 8, 0.9, 0.9, u, 1, '#fff3c0')
  a.endRoom(g)
  S.wave = { triggerU: 115, startU: 100, delay: 1.0, speed: 18, stopU: 242, height: 22, color: '#ffe066' }
  a.prop('temple', 0, 0, S.len - 2)
  a.prop('goldenDuck', 5.5, 0, S.len - 7, { s: 3 })
  a.prop('teleporter', 4, 0, S.len - 12, { to: 'lobby' })
}

/* ------------------------------------------------------------------ */
/* Lobbies                                                             */
/* ------------------------------------------------------------------ */

function createLobby(world) {
  const cx = WORLD_X[world]
  const r = rng(world * 104729 + 7)
  const L = {
    world,
    cx,
    boxes: [],
    signs: [],
    props: [],
    rocks: [],
    trees: [],
    flowers: [],
    pedestals: [],
    treads: [],
    wheel: null,
    portal: null,
    boards: [],
    spawn: { x: cx, y: 0.3, z: 16, yaw: Math.PI },
    bounds: { halfWidth: 54, minZ: -32, maxZ: 48 },
    theme: world === 1 ? THEMES.canyon : THEMES.crystal,
    themeId: world === 1 ? 'lobby1' : 'lobby2',
  }
  const box = (x, y, z, w, h, d, c, m = 'stud', k = 'solid', extra = null) => {
    const b = { x: cx + x, y, z, w, h, d, c, m, k }
    if (extra) Object.assign(b, extra)
    L.boxes.push(b)
    return b
  }
  const ground = world === 1 ? C.grass : '#2ee07a'
  // Baseplate (ends exactly where Stage 1 begins) over an earthy cliff body.
  box(0, -1, 9, 108, 2, 78, ground)
  box(0, -6.9, 9.2, 107.6, 10, 77.6, world === 1 ? C.dirt : '#5a3da8', 'stud', 'deco')
  // The back edge is Stage 1's gate wall (see a.entrance), which spans the whole lobby.
  // Boundaries.
  for (const s of [-1, 1]) box(s * 53, 20, 8, 2, 60, 80, '#000', 'invisible')
  box(0, 20, 47, 108, 60, 2, '#000', 'invisible')

  // Spawn plaza: dark stone quadrants, light stone curbs in a cross, white spawn pad.
  const slab = world === 1 ? C.stone : C.purple
  for (const [qx, qz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(qx * 6.2, 0.06, 16 + qz * 6.2, 9.2, 0.12, 9.2, slab)
  for (const s of [-1, 1]) {
    box(0, 0.25, 16 + s * 7.1, 2.2, 0.5, 8, C.brick, 'brick')
    box(s * 7.1, 0.25, 16, 8, 0.5, 2.2, C.brick, 'brick')
  }
  box(0, 0.12, 16, 6, 0.26, 6, '#ffffff', 'neon')
  box(0, 0.06, 16, 7.2, 0.14, 7.2, C.brick, 'brick', 'deco')
  // Paths: plaza -> entrance, -> ducks, -> treadmills.
  box(0, 0.05, -9, 7, 0.1, 42, slab, 'stud', 'deco')
  box(-26, 0.05, -14, 42, 0.1, 6, slab, 'stud', 'deco')
  box(26, 0.05, -12, 42, 0.1, 6, slab, 'stud', 'deco')
  // Glowing floor arrows: spawn -> stage gate (they pulse towards the stages).
  L.props.push({ type: 'arrows', from: [cx, 8], to: [cx, COURSE_Z + 1.5], y: 0.11, w: 3.4, gap: 2.6, color: '#3ff6ff' })
  // Smaller ones leading off the path to the ducks and the treadmills.
  L.props.push({ type: 'arrows', from: [cx - 6, -14], to: [cx - 44, -14], y: 0.11, w: 2.2, gap: 2.6, color: '#ffe14a' })
  L.props.push({ type: 'arrows', from: [cx + 6, -12], to: [cx + 44, -12], y: 0.11, w: 2.2, gap: 2.6, color: '#ffe14a' })
  // Scattered slabs (the dark stud tiles in the grass). Never overlapping each other or
  // a path - two coplanar tiles z-fight.
  const placed = [[-3.5, 3.5, -30, 12], [-47, -5, -17, -11], [5, 47, -15, -9], [-24.5, -1.5, 19.5, 24.5]]
  for (let i = 0; i < 26; i += 1) {
    const x = (r() - 0.5) * 92
    const z = -20 + r() * 62
    const w = 2 + r() * 4
    const d = 2 + r() * 4
    const dark = r() < 0.3
    if (Math.abs(x) < 14 && z > 4 && z < 29) continue
    if (Math.hypot(x + 24, z - 28) < 9) continue
    if (z < -12 && Math.abs(x) < 56) continue
    const rc = [x - w / 2 - 0.3, x + w / 2 + 0.3, z - d / 2 - 0.3, z + d / 2 + 0.3]
    if (placed.some((q) => rc[0] < q[1] && rc[1] > q[0] && rc[2] < q[3] && rc[3] > q[2])) continue
    placed.push(rc)
    box(x, 0.07, z, w, 0.14, d, dark ? C.stoneDark : slab, 'stud', 'deco')
  }

  // ---- Signboards on posts above the back fence -----------------------------
  for (const [x, text] of [[-33, 'Ducks give more Speed every Step!'], [31, 'Treadmills = free Steps!']]) {
    box(x, 8.6, COURSE_Z + 0.3, 22, 3.2, 0.4, world === 1 ? C.wood : '#3a2d63', 'smooth', 'deco')
    box(x, 10.35, COURSE_Z + 0.3, 22.6, 0.3, 0.6, C.gold, 'smooth', 'deco')
    box(x, 6.85, COURSE_Z + 0.3, 22.6, 0.3, 0.6, C.gold, 'smooth', 'deco')
    for (const sx of [-9, 9]) box(x + sx, 3.5, COURSE_Z + 0.3, 0.5, 7, 0.5, world === 1 ? C.woodLight : C.purpleLight, 'smooth', 'deco')
    L.signs.push({ text, x: cx + x, y: 8.6, z: COURSE_Z + 0.3 + 0.45, ry: 0, size: 1.5, kind: 'stageSub' })
  }

  // ---- Duck pedestals ------------------------------------------------------
  const ducks = DUCKS.filter((d) => d.world === world && !d.wheel)
  const n = ducks.length
  const x0 = -48
  const step = (48 - 9) / (n - 1)
  ducks.forEach((d, i) => {
    const x = x0 + i * step
    const z = -20
    box(x, 0.2, z, 3.6, 0.4, 3.6, world === 1 ? C.stoneDark : '#241a45')
    box(x, 0.5, z, 2.8, 0.2, 2.8, C.red, 'neon', 'deco')
    L.pedestals.push({ id: d.id, x: cx + x, y: 0.6, z, ry: 0 })
  })
  // ---- Treadmills ----------------------------------------------------------
  const treads = TREADMILLS.filter((t) => t.world === world)
  treads.forEach((t, i) => {
    const x = 14 + i * 9.5
    const z = -19
    L.treads.push({ id: t.id, x: cx + x, z, w: 3.4, l: 7, top: 0.62 })
    box(x, 0.3, z, 4.6, 0.6, 8.2, '#22252f')
  })
  // ---- Lucky wheel ---------------------------------------------------------
  L.wheel = { x: cx - 44, y: 0, z: 9, ry: Math.PI / 2 }
  box(-44, 0.3, 9, 4, 0.6, 9, slab)
  const lucky = DUCKS.find((d) => d.wheel)
  if (world === 1) L.pedestals.push({ id: lucky.id, x: cx - 44, y: 0.6, z: 19, ry: Math.PI / 2, display: true })
  if (world === 1) box(-44, 0.3, 19, 3.6, 0.6, 3.6, C.stoneDark)
  // ---- Leaderboards --------------------------------------------------------
  ;['wins', 'level', 'rebirths'].forEach((kind, i) => {
    L.boards.push({ kind, x: cx + 46, y: 0, z: i * 12, ry: -Math.PI / 2 })
  })
  // ---- World portal --------------------------------------------------------
  L.portal = { x: cx - 24, y: 0, z: 28, ry: Math.atan2(24, -12), to: world === 1 ? 2 : 1 }
  box(-24, 0.12, 28, 11, 0.24, 11, slab)
  box(-13, 0.055, 22, 23, 0.11, 4.5, slab, 'stud', 'deco')

  // ---- Decorations (visual only) --------------------------------------------
  L.props.push({ type: 'arch', x: cx, y: 0, z: 4 })
  for (const sd of [-1, 1]) {
    for (let z = -2; z > COURSE_Z + 4; z -= 12) L.props.push({ type: 'lamp', x: cx + sd * 5, y: 0, z })
    for (let z = -4; z > COURSE_Z + 6; z -= 5) L.props.push({ type: 'bush', x: cx + sd * (7.5 + r() * 1.5), y: 0, z: z + r() * 2, s: 0.8 + r() * 0.5, c: Math.floor(r() * 3) })
  }
  for (const [x, z] of [[-14, 7], [14, 7], [-14, 29], [14, 29]]) L.props.push({ type: 'lamp', x: cx + x, y: 0, z })
  L.props.push({ type: 'pond', x: cx + 35, y: 0, z: 35, r: 6 })

  // ---- Nature: cliffs ring + trees + flowers --------------------------------
  const ring = []
  for (let x = -60; x <= 60; x += 11) ring.push([x, 61 + r() * 4])
  for (let z = -26; z <= 56; z += 11) {
    ring.push([-65 - r() * 4, z])
    ring.push([65 + r() * 4, z])
  }
  for (let x = -60; x <= 60; x += 12) if (Math.abs(x) > 14) ring.push([x, COURSE_Z - 26 - r() * 6])
  for (const [x, z] of ring) {
    // Keep the ridge behind the stage wall low so it cannot cover the treadmill row.
    const backdrop = z < COURSE_Z - 5
    const s = backdrop ? 5 + r() * 3 : 8 + r() * 5
    L.rocks.push({ x: cx + x, y: -1 + s * 0.3, z, s, ry: r() * 6.28, v: Math.floor(r() * 3) })
    if (r() < 0.7) L.trees.push({ x: cx + x + (r() - 0.5) * 4, y: -1 + s * 1.22, z: z + (r() - 0.5) * 4, s: backdrop ? 0.6 + r() * 0.3 : 1.2 + r() * 1.2, c: Math.floor(r() * 3) })
  }
  const treeSpots = [[-42, 37], [38, 40], [-13, 40], [13, 40], [-48, -2], [48, -25], [-32, 4], [26, 3], [40, 19], [-40, 40], [8, 38]]
  for (const [x, z] of treeSpots) {
    L.trees.push({ x: cx + x + (r() - 0.5) * 3, y: 0, z: z + (r() - 0.5) * 3, s: 1 + r() * 0.7, c: Math.floor(r() * 3), solid: true })
  }
  for (let i = 0; i < 60; i += 1) {
    const x = (r() - 0.5) * 96
    const z = -14 + r() * 56
    if (Math.abs(x) < 13 && z > 3 && z < 29) continue
    if (Math.hypot(x + 24, z - 28) < 8) continue
    L.flowers.push({ x: cx + x, z, c: Math.floor(r() * 4) })
  }
  return L
}

/* ------------------------------------------------------------------ */
/* Assemble                                                            */
/* ------------------------------------------------------------------ */

export const LOBBIES = { 1: createLobby(1), 2: createLobby(2) }

export const STAGES = [null]
{
  let z = COURSE_Z
  for (let n = 1; n <= STAGE_COUNT; n += 1) {
    if (n === W1_STAGES + 1) z = COURSE_Z
    const spec = STAGE_SPECS[n]
    const world = stageWorld(n)
    const a = createStage(n, world, WORLD_X[world], z, spec.len, spec)
    spec.build(a)
    STAGES.push(a.S)
    z -= spec.len
  }
}

/** Which world (by x) a position belongs to. */
export const worldAtX = (x) => (Math.abs(x - WORLD_X[2]) < 1000 ? 2 : 1)

/**
 * Where a position is: `{ world, stage }` with stage 0 = lobby.
 * A stage owns z in (z1, z0].
 */
export function regionAt(x, z) {
  const world = worldAtX(x)
  if (z > COURSE_Z) return { world, stage: 0 }
  const first = worldFirst(world)
  const last = worldLast(world)
  for (let n = first; n <= last; n += 1) {
    const s = STAGES[n]
    if (z <= s.z0 && z > s.z1) return { world, stage: n }
  }
  return { world, stage: last }
}

export const stageSpawn = (n) => STAGES[n].spawn
export const lobbySpawn = (world) => LOBBIES[world].spawn

/** True when (x, z) is on the stage's wins pad (with a little slack). */
export function onPad(n, x, z, slack = 0.6) {
  const p = STAGES[n]?.pad
  if (!p) return false
  return Math.abs(x - p.x) <= p.w / 2 + slack && Math.abs(z - p.z) <= p.d / 2 + slack
}

/** The treadmill (if any) under (x, z). */
export function treadAt(world, x, z) {
  for (const t of LOBBIES[world].treads) {
    if (Math.abs(x - t.x) <= t.w / 2 && Math.abs(z - t.z) <= t.l / 2) return t
  }
  return null
}

/** Rough fastest possible clear time (s) for a stage at velocity v - pad anti-cheat. */
export const minStageTime = (n, v) => (STAGES[n].len * 0.75) / Math.max(4, v)
