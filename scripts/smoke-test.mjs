// End-to-end smoke test against a running server (npm start in another terminal).
//   node scripts/smoke-test.mjs [ws://localhost:2567]
// Checks: join + init, room split at 9 players, step XP, a full Stage 1 run + wins pad,
// shop errors, and that rejected teleports are rubber-banded.
import { Client } from 'colyseus.js'

import { lobbySpawn, STAGES } from '../src/shared/course.js'

const URL = process.argv[2] || 'ws://localhost:2567'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failed += 1
}

async function join(i) {
  const client = new Client(URL)
  const room = await client.joinOrCreate('lobby', { deviceId: `smoketest-device-${i}-${Date.now()}`, name: `Bot${i}` })
  const inbox = []
  room.onMessage('*', (type, msg) => inbox.push([type, msg]))
  await wait(300)
  return { room, inbox, got: (t) => inbox.filter(([x]) => x === t).map(([, m]) => m) }
}

const rooms = []
for (let i = 0; i < 9; i += 1) rooms.push(await join(i))
const ids = new Set(rooms.map((r) => r.room.roomId))
check(rooms.every((r) => r.got('init').length === 1), 'every client got init')
check(ids.size === 2, `9 players split into 2 lobbies (got ${ids.size})`)
check(rooms[0].got('join').length >= 7, 'first player saw the others join')

// Walk player 0 from spawn to the Stage 1 pad (the server rejects faster-than-possible clears).
const a = rooms[0]
const s = lobbySpawn(1)
const pad = STAGES[1].pad
const steps = 280 // ~5 m/s: a legal pace for a level-1 duck
for (let k = 1; k <= steps; k += 1) {
  const t = k / steps
  const x = s.x + (pad.x - s.x) * t
  const z = s.z + (pad.z - s.z) * t
  a.room.send('pos', [x, 0, z, Math.PI, 2 | 1])
  await wait(100)
}
check(a.got('stats').some((m) => m.xp > 0 || m.level > 1), 'walking earned step XP')
a.room.send('pad', { stage: 1 })
await wait(400)
const reward = a.got('reward')[0]
check(reward && reward.wins >= 1, `stage 1 pad paid ${reward?.wins} win(s)`)
a.room.send('pad', { stage: 1 })
await wait(300)
check(a.got('reward').length === 1, 'pad cannot be claimed twice in one run')

a.room.send('tread', { id: 't4' })
await wait(300)
check(a.got('toast').some((m) => /Rebirth|Wins/.test(m.text)), 'locked treadmill refused')

const before = a.got('teleport').length
a.room.send('pos', [500, 0, -900, 0, 2])
await wait(300)
check(a.got('teleport').length > before, 'impossible jump was rubber-banded')

for (const r of rooms) r.room.leave()
await wait(500)
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
