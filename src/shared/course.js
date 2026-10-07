/**
 * World layout: two lobbies and 20 obstacle stages, generated deterministically.
 *
 * CANONICAL COPY (the server keeps an identical copy for pad / stage validation).
 * Pure data: the client turns it into meshes + collision, the server only reads
 * spawns, pads, treadmills and stage regions.
 *
 * Coordinates: metres, y up. Each course runs from its lobby towards -z. Inside a stage
 * the builders use (x = lateral offset from the course centre, u = forward distance from
 * the stage entrance) and convert to world space.
 */

import { DUCKS, STAGE_NAMES, TREADMILLS } from './gameData.js'

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
/** z of the wall that separates each lobby from its Stage 1 / Stage 11 entrance. */
export const COURSE_Z = -30

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
  const half = opt.half ?? 8
  const S = {
    n,
    world,
    cx,
    z0,
    len,
    z1: z0 - len,
    half,
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
  const X = (x) => cx + x
  const Z = (u) => z0 - u
  const r = rng(n * 7919 + 13)
  let dynId = 0

  const a = {
    S,
    X,
    Z,
    r,
    /** Block by lateral centre x, width w, top y, height h, forward start u, length l. */
    blk(x, w, top, h, u, l, c, m = 'stud', k = 'solid', extra = null) {
      const b = { x: X(x), y: top - h / 2, z: Z(u + l / 2), w, h, d: l, c, m, k }
      if (extra) Object.assign(b, extra)
      S.boxes.push(b)
      return b
    },
    /** Dynamic object. Box-like dynamics use the same (x,w,top,h,u,l) frame. */
    dynBox(t, x, w, top, h, u, l, c, m, props) {
      const d = { t, id: `${n}:${dynId++}`, x: X(x), y: top - h / 2, z: Z(u + l / 2), w, h, d: l, c, m, k: 'solid', ...props }
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

  /** Entrance wall with the "Stage N" sign; u in [0, 3]. */
  a.entrance = (color = C.stoneDark, floorColor = C.stone, top = 0) => {
    const ext = half + 14
    a.blk(-(ext + 4) / 2, ext - 4, top + 14, 14, 0, 3, color)
    a.blk((ext + 4) / 2, ext - 4, top + 14, 14, 0, 3, color)
    a.blk(0, 8, top + 14, 8, 0, 3, color)
    a.blk(0, 8, top, 1, 0, 3, floorColor)
    // Glowing frame around the opening.
    a.blk(-4.15, 0.3, top + 6.3, 6.3, -0.05, 0.25, C.neonCyan, 'neon', 'deco')
    a.blk(4.15, 0.3, top + 6.3, 6.3, -0.05, 0.25, C.neonCyan, 'neon', 'deco')
    a.blk(0, 8.6, top + 6.45, 0.3, -0.05, 0.25, C.neonCyan, 'neon', 'deco')
    a.sign(`Stage ${n}`, 0, top + 11.0, -0.08, 4.2, 'stage')
    a.sign(STAGE_NAMES[n], 0, top + 7.45, -0.08, 1.35, 'stageSub')
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
    S.planes.push({ kind, y, x: X(0), z: Z(len / 2), w: half * 2 + 80, d: len + 6, c })
  }

  return a
}

/* ------------------------------------------------------------------ */
/* The 20 stages                                                       */
/* ------------------------------------------------------------------ */

const STAGE_SPECS = {
  // ======================= WORLD 1 =======================
  1: { len: 150, half: 18, theme: 'river', killY: -1.6, build: stage1 },
  2: { len: 130, half: 18, theme: 'river', killY: -1.6, build: stage2 },
  3: { len: 140, half: 16, theme: 'river', killY: -1.6, build: stage3 },
  4: { len: 110, half: 9, theme: 'dark', indoor: true, killY: -10, build: stage4 },
  5: { len: 130, half: 14, theme: 'lava', killY: -1.2, build: stage5 },
  6: { len: 140, half: 15, theme: 'canyon', killY: -1.6, build: stage6 },
  7: { len: 140, half: 15, theme: 'canyon', killY: -16, build: stage7 },
  8: { len: 150, half: 14, theme: 'sky', killY: -22, build: stage8 },
  9: { len: 160, half: 14, theme: 'canyon', killY: -10, build: stage9 },
  10: { len: 170, half: 9, theme: 'rainbow', killY: -22, build: stage10 },
  // ======================= WORLD 2 =======================
  11: { len: 180, half: 15, theme: 'crystal', killY: -14, build: stage11 },
  12: { len: 190, half: 11, theme: 'factory', killY: -14, build: stage12 },
  13: { len: 190, half: 15, theme: 'temple', killY: -14, build: stage13 },
  14: { len: 200, half: 11, theme: 'neon', indoor: true, killY: -10, build: stage14 },
  15: { len: 200, half: 14, theme: 'factory', killY: -5.4, build: stage15 },
  16: { len: 210, half: 16, theme: 'volcano', killY: -10, build: stage16 },
  17: { len: 210, half: 14, theme: 'sky', killY: -18, build: stage17 },
  18: { len: 220, half: 15, theme: 'crystal', killY: -16, build: stage18 },
  19: { len: 240, half: 14, theme: 'volcano', killY: -2.6, build: stage19 },
  20: { len: 260, half: 16, theme: 'gold', killY: -14, build: stage20 },
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
  bridge(14, 34, 5, [24, 37])
  a.island(0, 26, 48, 12)
  path(48, 12)
  // Bridge 2: narrower, with a broken gap and logs.
  bridge(60, 36, 4, [68, 88], [78])
  a.island(0, 26, 96, 12)
  path(96, 12)
  // Bridge 3: narrowest.
  bridge(108, 28, 3.2, [116, 127])
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

/* ---- Stage 4: Demon Lair - dark hall, red lasers, a demon watching ---- */
function stage4(a) {
  const { S } = a
  a.entrance('#1a1c2c', '#1d2033')
  a.blk(0, 18, 0, 1, 3, S.len - 3, '#1d2033')
  a.walls(10, '#22263a')
  for (const s of [-1, 1]) {
    a.blk(s * 8.92, 0.16, 0.5, 0.18, 3, S.len - 3, C.neonRed, 'neon', 'deco')
    a.blk(s * 8.92, 0.16, 6.2, 0.18, 3, S.len - 3, C.neonRed, 'neon', 'deco')
  }
  for (const x of [-6, -3, 3, 6]) a.blk(x, 0.12, 0.03, 0.04, 3, S.len - 19, C.neonRed, 'neon', 'deco')
  for (let u = 6; u < S.len - 16; u += 6) a.blk(0, 18, 0.03, 0.04, u, 0.12, C.neonRed, 'neon', 'deco')
  const laser = { m: 'laser', k: 'kill' }
  // (a) Low laser sliding along the hall - jump it.
  a.mover(0, 17.6, 0.6, 0.25, 15.5, 0.25, C.neonRed, 2, 5, 3.0, 0, laser)
  // (b) Laser walls that switch on and off.
  ;[28, 33, 38].forEach((u, i) => a.blink(0, 17.6, 6, 6, u, 0.3, C.neonRed, 2.4, 0, 0.5, i * 0.33, laser))
  // (c) Spinning laser around a pillar.
  a.cyl(0, 53, 2.6, 0.8, 2.6, '#22263a')
  a.sweeper(0, 53, 0.55, 8.4, 1.7, 0, C.neonRed, { kill: true, r: 0.22 })
  // (d) Checkerboard floor lasers.
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      const setB = (row + col) % 2 === 1
      a.blink(-7.5 + col * 3, 2.9, 0.09, 0.08, 66 + row * 3, 2.9, C.neonRed, 2.6, 0, 0.45, setB ? 0.5 : 0, { ...laser, floorLaser: true })
    }
  }
  // (e) Laser walls sweeping side to side.
  a.mover(0, 8.6, 6, 6, 86, 0.4, C.neonRed, 0, 4.6, 2.8, 0, laser)
  a.mover(0, 8.6, 6, 6, 91, 0.4, C.neonRed, 0, 4.6, 2.8, 0.5, laser)
  a.endRoom('#1d2033')
  a.prop('demon', 5.5, 0, S.len - 6, { s: 1.6 })
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
  const plank = (x, u, l, w = 2.6) => a.blk(x, w, 0, 0.5, u, l, C.woodLight, 'smooth')
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
  a.slab(0, 2.2, 8, 14, 0, cl, 1)
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
  a.slab(-4, 2, 84.5, 11.5, 0, cl, 1)
  a.slab(0, 10, 95, 2, 0, cl, 1)
  a.slab(4, 2, 96, 11, 0, cl, 1)
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
  a.prop('arch', 0, 0, 136, { w: a.W })
  a.endRoom(C.stone)
}

/* ---- Stage 10: Rainbow Road ---- */
function stage10(a) {
  const { S } = a
  a.slab(0, 14, 0, 9, 0, C.white, 2)
  a.entrance('#3a2d63', C.white)
  a.bounds()
  const rainbow = ['#ff3a3a', '#ff8a1a', '#ffe11a', '#3dff5a', '#29c8ff', '#6b6bff', '#c23dff']
  let row = 0
  for (let u = 10; u < 122; u += 3.2, row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const setB = (row + col) % 2 === 1
      a.blink(-4.5 + col * 3, 2.8, 0, 0.6, u, 2.8, rainbow[row % 7], 4.4, 0, 0.7, setB ? 0.5 : 0, { rainbowTile: true })
    }
  }
  a.slab(0, 14, 123, 47, 0, C.white, 2)
  a.endRoom(C.white)
  a.prop('worldGate', 0, 0, S.len - 3, { world: 2 })
  a.prop('teleporter', 4, 0, S.len - 9, { to: 'lobby' })
  for (let i = 0; i < 10; i += 1) a.prop('cloud', (a.r() - 0.5) * 60, -8 - a.r() * 8, a.r() * S.len, { s: 3 + a.r() * 4, tint: '#c9b8ff' })
}

/* ---- Stage 11: Crystal Caves ---- */
function stage11(a) {
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
  for (let k = 0; k < 18; k += 1) a.prop('crystals', (r() < 0.5 ? -1 : 1) * (S.half + 2 + r() * 6), -2 + r() * 4, r() * S.len, { s: 1 + r() * 2 })
}

/* ---- Stage 12: Conveyor Chaos ---- */
function stage12(a) {
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

/* ---- Stage 13: Pendulum Hall ---- */
function stage13(a) {
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

/* ---- Stage 14: Laser Grid ---- */
function stage14(a) {
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

/* ---- Stage 15: Piston Peaks ---- */
function stage15(a) {
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

/* ---- Stage 16: Meteor Shower ---- */
function stage16(a) {
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

/* ---- Stage 17: Wind Tunnel ---- */
function stage17(a) {
  const { S } = a
  const cl = '#e8f0ff'
  a.slab(0, a.W, 0, 8, 0, cl, 2)
  a.entrance('#9fc6ff', cl)
  a.bounds()
  S.planes.push({ kind: 'clouds', y: -16, x: a.X(0), z: a.Z(S.len / 2), w: 180, d: S.len + 60, c: '#ffffff' })
  const gust = (x, w, u, l, vx, per, ph = 0) => {
    a.dyn('wind', { x: a.X(x), z: a.Z(u + l / 2), w, d: l, y0: -2, y1: 6, vx, vz: 0, per, on0: 0, on1: 0.5, ph })
    a.prop('fan', vx > 0 ? -S.half - 1 : S.half + 1, 1, u + l / 2, { dir: vx > 0 ? 1 : -1, per, ph, l })
  }
  a.slab(0, 3, 8, 42, 0, cl, 1)
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

/* ---- Stage 18: Turntables ---- */
function stage18(a) {
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

/* ---- Stage 19: Lava Rising ---- */
function stage19(a) {
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

/* ---- Stage 20: Golden Temple ---- */
function stage20(a) {
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
    spawn: { x: cx, y: 0.3, z: 22, yaw: Math.PI },
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
  // Baseplate.
  box(0, -1, 16, 124, 2, 96, ground)
  // Back wall with the stage entrance (the course itself starts at COURSE_Z).
  const wallC = world === 1 ? C.stoneDark : '#241a45'
  // Flush with the stage entrance wall (which covers |x| < 22), so signs sit on one face.
  box(-43, 7, COURSE_Z - 1.5, 42, 14, 3, wallC)
  box(43, 7, COURSE_Z - 1.5, 42, 14, 3, wallC)
  // Boundaries.
  for (const s of [-1, 1]) box(s * 61, 20, 16, 2, 60, 96, '#000', 'invisible')
  box(0, 20, 63, 124, 60, 2, '#000', 'invisible')

  // Spawn plaza: dark stone quadrants, light stone curbs in a cross, white spawn pad.
  const slab = world === 1 ? C.stone : C.purple
  for (const [qx, qz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(qx * 7.5, 0.06, 22 + qz * 7.5, 11, 0.12, 11, slab)
  for (const s of [-1, 1]) {
    box(0, 0.25, 22 + s * 8.6, 2.2, 0.5, 9, C.brick, 'brick')
    box(s * 8.6, 0.25, 22, 9, 0.5, 2.2, C.brick, 'brick')
  }
  box(0, 0.12, 22, 6, 0.26, 6, '#ffffff', 'neon')
  box(0, 0.06, 22, 7.2, 0.14, 7.2, C.brick, 'brick', 'deco')
  // Paths: plaza -> entrance, -> ducks, -> treadmills.
  box(0, 0.05, -8, 7, 0.1, 50, slab, 'stud', 'deco')
  box(-30, 0.05, -14, 44, 0.1, 6, slab, 'stud', 'deco')
  box(30, 0.05, -12, 44, 0.1, 6, slab, 'stud', 'deco')
  for (let z = 4; z > COURSE_Z + 6; z -= 5) {
    for (const side of [-1, 1]) {
      box(side * 0.75, 0.13, z - 0.35, 1.9, 0.05, 0.36, C.neonCyan, 'neon', 'deco')
      box(side * 1.4, 0.13, z - 0.35, 0.36, 0.05, 1.2, C.neonCyan, 'neon', 'deco')
    }
  }
  // Scattered slabs (the dark stud tiles in the grass).
  for (let i = 0; i < 26; i += 1) {
    const x = (r() - 0.5) * 100
    const z = -20 + r() * 76
    if (Math.abs(x) < 16 && z > 6 && z < 38) continue
    if (z < -12 && Math.abs(x) < 56) continue
    const w = 2 + r() * 4
    box(x, 0.07, z, w, 0.14, 2 + r() * 4, r() < 0.3 ? C.stoneDark : slab, 'stud', 'deco')
  }

  // ---- Wall signs ---------------------------------------------------------
  L.signs.push({ text: 'Ducks give more Speed every Step!', x: cx - 33, y: 10.5, z: COURSE_Z + 0.06, ry: 0, size: 1.6, kind: 'stageSub' })
  L.signs.push({ text: 'Treadmills = free Steps!', x: cx + 31, y: 10.5, z: COURSE_Z + 0.06, ry: 0, size: 1.6, kind: 'stageSub' })

  // ---- Duck pedestals ------------------------------------------------------
  const ducks = DUCKS.filter((d) => d.world === world && !d.wheel)
  const n = ducks.length
  const x0 = -57
  const step = (57 - 9) / (n - 1)
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
    const x = 14 + i * 10.5
    const z = -19
    L.treads.push({ id: t.id, x: cx + x, z, w: 3.4, l: 7, top: 0.62 })
    box(x, 0.3, z, 4.6, 0.6, 8.2, '#22252f')
  })
  // ---- Lucky wheel ---------------------------------------------------------
  L.wheel = { x: cx - 50, y: 0, z: 14, ry: Math.PI / 2 }
  box(-50, 0.3, 14, 4, 0.6, 9, slab)
  const lucky = DUCKS.find((d) => d.wheel)
  if (world === 1) L.pedestals.push({ id: lucky.id, x: cx - 50, y: 0.6, z: 24, ry: Math.PI / 2, display: true })
  if (world === 1) box(-50, 0.3, 24, 3.6, 0.6, 3.6, C.stoneDark)
  // ---- Leaderboards --------------------------------------------------------
  ;['wins', 'level', 'rebirths'].forEach((kind, i) => {
    L.boards.push({ kind, x: cx + 52, y: 0, z: 2 + i * 13, ry: -Math.PI / 2 })
  })
  // ---- World portal --------------------------------------------------------
  L.portal = { x: cx - 26, y: 0, z: 50, ry: 0, to: world === 1 ? 2 : 1 }
  box(-26, 0.25, 50, 12, 0.5, 6, slab)

  // ---- Nature: cliffs ring + trees + flowers --------------------------------
  const ring = []
  for (let x = -70; x <= 70; x += 11) ring.push([x, 74 + r() * 6])
  for (let z = -26; z <= 70; z += 11) {
    ring.push([-72 - r() * 6, z])
    ring.push([72 + r() * 6, z])
  }
  for (let x = -70; x <= 70; x += 12) if (Math.abs(x) > 14) ring.push([x, COURSE_Z - 26 - r() * 6])
  for (const [x, z] of ring) {
    // Keep the ridge behind the stage wall low so it cannot cover the treadmill row.
    const backdrop = z < COURSE_Z - 5
    const s = backdrop ? 5 + r() * 3 : 10 + r() * 9
    L.rocks.push({ x: cx + x, y: -1 + s * 0.3, z, s, ry: r() * 6.28, v: Math.floor(r() * 3) })
    if (r() < 0.7) L.trees.push({ x: cx + x + (r() - 0.5) * 4, y: -1 + s * 1.22, z: z + (r() - 0.5) * 4, s: backdrop ? 0.6 + r() * 0.3 : 1.2 + r() * 1.2, c: Math.floor(r() * 3) })
  }
  const treeSpots = [[-40, 40], [-52, 32], [38, 48], [50, 40], [-14, 52], [14, 54], [-56, -2], [56, -24], [-30, 4], [26, 6], [44, 22], [-44, 50], [8, 44]]
  for (const [x, z] of treeSpots) {
    L.trees.push({ x: cx + x + (r() - 0.5) * 3, y: 0, z: z + (r() - 0.5) * 3, s: 1 + r() * 0.7, c: Math.floor(r() * 3), solid: true })
  }
  for (let i = 0; i < 60; i += 1) {
    const x = (r() - 0.5) * 112
    const z = -14 + r() * 72
    if (Math.abs(x) < 15 && z > 7 && z < 37) continue
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
  for (let n = 1; n <= 20; n += 1) {
    if (n === 11) z = COURSE_Z
    const spec = STAGE_SPECS[n]
    const world = n > 10 ? 2 : 1
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
  const first = world === 1 ? 1 : 11
  for (let n = first; n < first + 10; n += 1) {
    const s = STAGES[n]
    if (z <= s.z0 && z > s.z1) return { world, stage: n }
  }
  return { world, stage: first + 9 }
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
