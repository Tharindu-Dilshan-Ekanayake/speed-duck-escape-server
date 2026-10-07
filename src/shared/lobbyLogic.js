/**
 * The lobby simulation: movement validation, step XP, treadmills, stage runs, wins
 * pads, races, purchases, wheel, gifts.
 *
 * Environment-agnostic on purpose. The Colyseus room (server) and the offline room
 * (browser, when the server is unreachable) are thin adapters around this class, so
 * online and offline play can never drift apart. CANONICAL COPY lives in the client.
 *
 * Adapter contract:
 *   send(sid, type, msg)              - message to one player
 *   broadcast(type, msg, exceptSid?)  - message to everyone (optionally but one)
 */

import {
  DEV_TOOLS,
  RACE_COUNTDOWN_MS,
  RACE_CYCLE_MS,
  RACE_WAIT_MS,
  STAGE_COUNT,
  STEP_DISTANCE,
  TREADMILL_STEPS,
  TUT_DONE,
  WORLD2_REBIRTHS,
  speedStat,
  stageWorld,
  treadById,
  velocityFor,
  worldFirst,
  xpForLevels,
} from './gameData.js'
import { lobbySpawn, minStageTime, onPad, regionAt, stageSpawn, treadAt } from './course.js'
import {
  addWins,
  addXp,
  buyBoost,
  buyDuck,
  buyPack,
  buyTread,
  canEnterWorld,
  claimGift,
  clearStage,
  doRebirth,
  equipDuck,
  padWins,
  publicView,
  raceBonus,
  spinWheel,
  stageAccess,
  stageLock,
  tickSpins,
  totalLevel,
  xpPerStep,
} from './rules.js'

const FLUSH_MS = 250
const STATS_EVERY_MS = 4000
const round2 = (v) => Math.round(v * 100) / 100

export const FLAG = { MOVING: 1, GROUNDED: 2, RISING: 4, TREAD: 8, STUN: 16 }

export class LobbyLogic {
  constructor({ send, broadcast, now = () => Date.now(), random = Math.random }) {
    this.send = send
    this.broadcastFn = broadcast
    this.now = now
    this.random = random
    /** sid -> player */
    this.players = new Map()
    this.flushTimer = 0
    this.statsTimer = 0
    this.raceEpoch = now()
    this.racePhase = this.raceState().phase
    this.raceWinner = null
  }

  broadcast(type, msg, exceptSid) {
    this.broadcastFn(type, msg, exceptSid)
  }

  /* ------------------------------------------------------------------ */
  /* Players                                                             */
  /* ------------------------------------------------------------------ */

  addPlayer({ sid, uid, profile, avatar = null, proportions = null }, extraInit = {}) {
    const spawn = lobbySpawn(1)
    const p = {
      sid,
      uid,
      profile,
      avatar,
      proportions,
      pos: { x: spawn.x, y: spawn.y, z: spawn.z, yaw: spawn.yaw },
      flags: 0,
      lastPosAt: this.now(),
      budget: 10,
      region: { world: 1, stage: 0 },
      run: null,
      distAcc: 0,
      steps: 0,
      session: { ms: 0, claimed: [] },
      racing: null,
      dirty: true,
    }
    this.players.set(sid, p)
    this.send(sid, 'init', {
      sid,
      now: this.now(),
      profile: this.privateProfile(p),
      spawn,
      players: [...this.players.values()].filter((o) => o !== p).map((o) => this.publicPlayer(o)),
      race: this.raceState(),
      session: p.session,
      dev: DEV_TOOLS,
      ...extraInit,
    })
    this.broadcast('join', this.publicPlayer(p), sid)
    this.broadcast('friends', { count: this.players.size })
    return p
  }

  removePlayer(sid) {
    const p = this.players.get(sid)
    if (!p) return null
    this.players.delete(sid)
    this.broadcast('leave', { sid })
    this.broadcast('friends', { count: this.players.size })
    return p
  }

  privateProfile(p) {
    return { ...p.profile }
  }

  publicPlayer(p) {
    return { sid: p.sid, ...publicView(p.profile), avatar: p.avatar, proportions: p.proportions, pos: p.pos, flags: p.flags }
  }

  others() {
    return Math.max(0, this.players.size - 1)
  }

  toast(p, text, kind = 'error') {
    this.send(p.sid, 'toast', { text, kind })
  }

  changed(p, appearance = false) {
    p.dirty = true
    this.send(p.sid, 'profile', this.privateProfile(p))
    if (appearance) this.broadcast('appearance', { sid: p.sid, ...publicView(p.profile) }, p.sid)
  }

  stats(p) {
    const pr = p.profile
    this.send(p.sid, 'stats', { level: pr.level, xp: pr.xp, wins: pr.wins, spins: pr.spins, spinMs: pr.spinMs })
  }

  levelUp(p, lv) {
    if (!lv) return
    this.send(p.sid, 'levelUp', lv)
    this.broadcast('fx', { sid: p.sid, kind: 'levelUp', level: lv.to }, p.sid)
    this.changed(p, true)
  }

  /* ------------------------------------------------------------------ */
  /* Position                                                            */
  /* ------------------------------------------------------------------ */

  /** Moves a player (server-side teleport). `how`: 'tp' | 'respawn' | 'reject'. */
  setPos(p, pos, how = 'tp', notify = true) {
    // Stamped a little in the past so the owner's next (client-clocked) update follows it.
    p.pos = { x: pos.x, y: pos.y, z: pos.z, yaw: pos.yaw ?? Math.PI, t: this.now() - 300 }
    p.budget = 10
    p.lastPosAt = this.now()
    p.distAcc = 0
    const reg = regionAt(pos.x, pos.z)
    if (how !== 'reject') this.enterRegion(p, reg, how)
    else p.region = reg
    if (notify) this.send(p.sid, 'teleport', p.pos)
  }

  enterRegion(p, reg, how) {
    const prev = p.region.stage
    p.region = reg
    if (reg.stage === 0) {
      p.run = null
      return
    }
    const first = worldFirst(reg.world)
    const forward = prev === reg.stage - 1 || (prev === 0 && reg.stage === first)
    if (how === 'tp' || how === 'respawn' || forward) {
      p.run = { stage: reg.stage, at: this.now(), claimed: false }
      if (forward && how === 'walk' && reg.stage > p.profile.maxStage) {
        p.profile.maxStage = reg.stage
        this.changed(p)
      }
    } else {
      // Walked backwards into a stage you already left: no second pad payout.
      p.run = { stage: reg.stage, at: this.now(), claimed: true }
    }
  }

  onPos(p, m) {
    if (!Array.isArray(m) || m.length < 5) return
    const [x, y, z, yaw, flags, sentAt] = m.map(Number)
    if (![x, y, z, yaw].every(Number.isFinite)) return
    const now = this.now()
    const dt = Math.min(1, Math.max(0, (now - p.lastPosAt) / 1000))
    p.lastPosAt = now

    const vmax = velocityFor(speedStat(p.profile.level))
    p.budget = Math.min(p.budget + (vmax * 1.5 + 25) * dt, vmax * 3 + 60)
    const dist = Math.hypot(x - p.pos.x, z - p.pos.z)
    const reg = regionAt(x, z)
    if (dist > p.budget + 4 || reg.world !== p.region.world || y > 200 || y < -200) {
      this.setPos(p, p.pos, 'reject')
      return
    }
    p.budget -= dist
    const prev = p.pos
    // The sender's (server-synced) clock, so others can replay the motion evenly spaced.
    const t = Number.isFinite(sentAt) && Math.abs(sentAt - now) < 3000 ? sentAt : now
    p.pos = { x, y, z, yaw, t }
    p.flags = flags | 0

    if ((p.flags & FLAG.GROUNDED) && !(p.flags & FLAG.TREAD) && dist > 0.01) {
      p.distAcc += Math.min(dist, vmax * dt * 1.4 + 1)
      if (p.distAcc >= STEP_DISTANCE) {
        const n = Math.floor(p.distAcc / STEP_DISTANCE)
        p.distAcc -= n * STEP_DISTANCE
        p.steps += n
      }
    }

    if (reg.stage !== p.region.stage) {
      if (reg.stage > 0) {
        const denied = stageAccess(p.profile, reg.stage)
        if (denied) {
          this.toast(p, denied)
          this.setPos(p, lobbySpawn(1))
          return
        }
        // Walking forward through a gate you are too low-level for: bounce back.
        const locked = reg.stage > p.region.stage ? stageLock(p.profile, reg.stage) : null
        if (locked) {
          this.toast(p, locked)
          p.pos = prev
          this.setPos(p, prev, 'reject')
          return
        }
      }
      this.enterRegion(p, reg, 'walk')
    }
  }

  /* ------------------------------------------------------------------ */
  /* Tick                                                                */
  /* ------------------------------------------------------------------ */

  tick(dtMs) {
    const now = this.now()
    const dt = dtMs / 1000
    for (const p of this.players.values()) {
      p.session.ms += dtMs
      if (tickSpins(p.profile, dtMs) > 0) {
        this.toast(p, 'You got a free Spin! Visit the Lucky Wheel.', 'good')
        this.stats(p)
      }
      // Treadmills: stand on an owned one and steps flow in.
      if (p.region.stage === 0 && p.flags & FLAG.GROUNDED) {
        const t = treadAt(p.region.world, p.pos.x, p.pos.z)
        if (t && p.profile.treads.includes(t.id)) p.steps += TREADMILL_STEPS * treadById(t.id).mult * dt
      }
    }

    this.flushTimer += dtMs
    if (this.flushTimer >= FLUSH_MS) {
      this.flushTimer = 0
      for (const p of this.players.values()) {
        const whole = Math.floor(p.steps)
        if (whole < 1) continue
        p.steps -= whole
        const lv = addXp(p.profile, whole * xpPerStep(p.profile, this.others(), now))
        p.dirty = true
        // XP flows in every 250 ms, but the HUD only needs a refresh a few times a second.
        if (lv || now - (p.statsAt || 0) > 600) {
          p.statsAt = now
          this.stats(p)
        }
        this.levelUp(p, lv)
      }
    }

    this.statsTimer += dtMs
    if (this.statsTimer >= STATS_EVERY_MS) {
      this.statsTimer = 0
      for (const p of this.players.values()) this.stats(p)
    }

    if (this.players.size > 1) {
      const snap = []
      for (const p of this.players.values()) snap.push([p.sid, round2(p.pos.x), round2(p.pos.y), round2(p.pos.z), round2(p.pos.yaw), p.flags, p.pos.t || now])
      this.broadcast('snap', snap)
    }

    this.tickRace()
  }

  /* ------------------------------------------------------------------ */
  /* Races                                                               */
  /* ------------------------------------------------------------------ */

  raceState() {
    const t = (this.now() - this.raceEpoch) % RACE_CYCLE_MS
    const base = this.now() - t
    if (t < RACE_WAIT_MS) return { phase: 'wait', until: base + RACE_WAIT_MS }
    if (t < RACE_WAIT_MS + RACE_COUNTDOWN_MS) return { phase: 'countdown', until: base + RACE_WAIT_MS + RACE_COUNTDOWN_MS }
    return { phase: 'race', until: base + RACE_CYCLE_MS }
  }

  tickRace() {
    const st = this.raceState()
    if (st.phase === this.racePhase) return
    this.racePhase = st.phase
    if (st.phase === 'race') {
      this.raceWinner = null
      let i = 0
      const spawn = stageSpawn(1)
      for (const p of this.players.values()) {
        if (p.region.world !== 1 || p.region.stage !== 0) continue
        p.racing = { start: this.now() }
        const lane = ((i % 5) - 2) * 2.4
        i += 1
        this.setPos(p, { x: spawn.x + lane, y: spawn.y, z: spawn.z, yaw: Math.PI })
        this.send(p.sid, 'raceGo', {})
      }
    } else if (st.phase === 'wait') {
      const had = [...this.players.values()].some((p) => p.racing)
      for (const p of this.players.values()) p.racing = null
      if (had && !this.raceWinner) this.broadcast('sys', { text: 'The race ended - nobody reached the finish!' })
    }
    this.broadcast('race', st)
  }

  /* ------------------------------------------------------------------ */
  /* Messages                                                            */
  /* ------------------------------------------------------------------ */

  handle(sid, type, msg) {
    const p = this.players.get(sid)
    if (!p) return
    const m = msg ?? {}
    try {
      switch (type) {
        case 'pos':
          return this.onPos(p, m)
        case 'ping':
          return this.send(sid, 'pong', { t: m.t, now: this.now() })
        case 'pad':
          return this.claimPad(p, Number(m.stage))
        case 'respawn':
          return this.respawn(p, Number(m.stage) || 0)
        case 'tp':
          return this.teleport(p, m.to)
        case 'duck':
          return this.duck(p, String(m.id))
        case 'equip':
          return this.result(p, equipDuck(p.profile, String(m.id)), true, 'equip')
        case 'tread':
          return this.result(p, buyTread(p.profile, String(m.id)), false, 'buy')
        case 'rebirth':
          return this.rebirth(p)
        case 'spin':
          return this.spin(p)
        case 'gift':
          return this.gift(p, Number(m.i))
        case 'boost':
          return this.result(p, buyBoost(p.profile, String(m.kind), this.now()), false, 'boost')
        case 'pack':
          return this.pack(p, Number(m.i))
        case 'dev':
          return this.dev(p, m)
        case 'tut':
          return this.tutorial(p, Number(m.step))
        default:
      }
    } catch (err) {
      console.warn(`[lobby] ${type} failed`, err)
    }
  }

  result(p, r, appearance = false, sfx = null) {
    if (!r.ok) return this.toast(p, r.error)
    if (sfx) this.send(p.sid, 'sfx', { name: sfx })
    this.changed(p, appearance)
  }

  duck(p, id) {
    const r = buyDuck(p.profile, id)
    if (!r.ok) return this.toast(p, r.error)
    this.send(p.sid, 'sfx', { name: r.bought ? 'buy' : 'equip' })
    if (r.bought) this.send(p.sid, 'newDuck', { id })
    this.broadcast('fx', { sid: p.sid, kind: 'duck' }, p.sid)
    this.changed(p, true)
  }

  claimPad(p, stage) {
    if (!(stage >= 1 && stage <= STAGE_COUNT)) return
    const run = p.run
    if (!run || run.stage !== stage || run.claimed) return
    if (!onPad(stage, p.pos.x, p.pos.z, 1.4)) return
    const vmax = velocityFor(speedStat(p.profile.level))
    if (this.now() - run.at < minStageTime(stage, vmax) * 1000) return
    run.claimed = true
    const pr = p.profile
    const wins = addWins(pr, padWins(pr, stage, { race: !!p.racing, now: this.now() }))
    clearStage(pr, stage)
    this.send(p.sid, 'reward', { wins, stage, race: !!p.racing })
    if (p.racing && stage === 1 && !this.raceWinner) {
      this.raceWinner = p.sid
      const secs = ((this.now() - p.racing.start) / 1000).toFixed(3)
      const bonus = addWins(pr, raceBonus(pr))
      pr.racesWon = (pr.racesWon || 0) + 1
      this.broadcast('sys', { text: `${pr.name} Won The Race In ${secs} Seconds`, race: true })
      this.send(p.sid, 'raceWin', { secs, bonus })
    }
    p.racing = null
    this.changed(p, true)
    // Cashing out ends the run: straight back to the lobby to run again (further).
    this.setPos(p, lobbySpawn(p.region.world), 'respawn')
  }

  respawn(p, stage) {
    if (stage > 0 && stage === p.region.stage) {
      this.setPos(p, stageSpawn(stage), 'respawn', false)
    } else if (stage === 0) {
      this.setPos(p, lobbySpawn(p.region.world), 'respawn', false)
    }
  }

  teleport(p, to) {
    if (to === 'lobby') return this.setPos(p, lobbySpawn(p.region.world))
    if (to === 'w1') return this.setPos(p, lobbySpawn(1))
    if (to === 'w2') {
      const denied = canEnterWorld(p.profile, 2)
      if (denied) return this.toast(p, denied)
      this.send(p.sid, 'sfx', { name: 'portal' })
      return this.setPos(p, lobbySpawn(2))
    }
    // No stage teleports: every run starts from the lobby.
    return undefined
  }

  rebirth(p) {
    const r = doRebirth(p.profile)
    if (!r.ok) return this.toast(p, r.error)
    this.send(p.sid, 'rebirthed', { rebirths: p.profile.rebirths })
    this.broadcast('fx', { sid: p.sid, kind: 'rebirth' }, p.sid)
    this.changed(p, true)
  }

  spin(p) {
    const r = spinWheel(p.profile, this.random, this.now())
    if (!r.ok) return this.toast(p, r.error)
    this.send(p.sid, 'spin', { idx: r.idx, reward: r.reward })
    if (r.reward.lv) this.levelUp(p, r.reward.lv)
    this.changed(p, !!r.reward.duck)
  }

  gift(p, i) {
    const r = claimGift(p.profile, p.session, i, this.now())
    if (!r.ok) return this.toast(p, r.error)
    this.send(p.sid, 'gift', { i, reward: r.reward, session: p.session })
    if (r.reward.lv) this.levelUp(p, r.reward.lv)
    this.changed(p)
  }

  pack(p, i) {
    const r = buyPack(p.profile, i)
    if (!r.ok) return this.toast(p, r.error)
    this.send(p.sid, 'packed', { i, xp: r.xp || 0, spins: r.spins || 0 })
    if (r.lv) this.levelUp(p, r.lv)
    this.changed(p)
  }

  /** The new-player guide only ever moves forward. */
  tutorial(p, step) {
    if (!Number.isFinite(step)) return
    const next = Math.min(TUT_DONE, Math.max(0, Math.floor(step)))
    if (next <= (p.profile.tut ?? TUT_DONE)) return
    p.profile.tut = next
    this.changed(p)
  }

  dev(p, m) {
    if (!DEV_TOOLS) return
    const pr = p.profile
    switch (m.action) {
      case 'tp': {
        const n = Math.max(0, Math.min(STAGE_COUNT, Math.floor(Number(m.stage) || 0)))
        if (n === 0) {
          p.racing = null
          this.setPos(p, lobbySpawn(p.region.world))
          break
        }
        if (stageWorld(n) === 2 && pr.rebirths < WORLD2_REBIRTHS) {
          this.toast(p, `World 2 needs ${WORLD2_REBIRTHS} Rebirths! (use +Rebirth)`)
          return
        }
        if (n > pr.maxStage) pr.maxStage = n
        p.region = regionAt(stageSpawn(n).x, stageSpawn(n).z)
        this.setPos(p, stageSpawn(n))
        break
      }
      case 'wins':
        addWins(pr, Math.max(0, Math.min(1e12, Number(m.amount) || 0)))
        break
      case 'level':
        this.levelUp(p, addXp(pr, xpForLevels(pr.level, Math.max(1, Math.min(500, Number(m.n) || 10)))))
        break
      case 'rebirth':
        pr.rebirths += 1
        pr.totalLevel = totalLevel(pr)
        break
      case 'spins':
        pr.spins += 10
        break
      default:
        return
    }
    this.changed(p, true)
  }
}
