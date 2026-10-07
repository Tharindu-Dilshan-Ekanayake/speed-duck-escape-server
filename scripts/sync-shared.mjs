// Copies the canonical shared game code from the client repo into this repo.
// Run after editing speed-duck-escape-client/src/shared/*.js.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.resolve(here, '../../speed-duck-escape-client/src/shared')
const dstDir = path.resolve(here, '../src/shared')
fs.mkdirSync(dstDir, { recursive: true })
for (const f of fs.readdirSync(srcDir)) {
  if (!f.endsWith('.js')) continue
  fs.copyFileSync(path.join(srcDir, f), path.join(dstDir, f))
  console.log(`synced ${f}`)
}
