import fs from 'node:fs'
import path from 'node:path'

import { MongoClient } from 'mongodb'

/**
 * Profile storage.
 *
 * Production (Legion): MONGODB_URI is injected and points at this game's isolated db.
 * Local dev without Mongo: an in-memory map flushed to ./data/dev-db.json so progress
 * survives a restart.
 */

const LEADERBOARD_FIELDS = ['totalWins', 'totalLevel', 'rebirths']
const PROJECTION = { name: 1, totalWins: 1, totalLevel: 1, level: 1, rebirths: 1, duck: 1 }

class MongoStore {
  constructor(uri) {
    this.uri = uri
    this.client = null
    this.col = null
  }

  async connect() {
    this.client = new MongoClient(this.uri, { maxPoolSize: 10 })
    await this.client.connect()
    // The URI already names the db (scoped user); `db()` with no arg uses it.
    this.col = this.client.db().collection('profiles')
    await Promise.all(LEADERBOARD_FIELDS.map((f) => this.col.createIndex({ [f]: -1 }).catch(() => {})))
    console.log('[db] connected to MongoDB')
  }

  async load(uid) {
    return this.col.findOne({ _id: uid })
  }

  async save(uid, profile) {
    // eslint-disable-next-line no-unused-vars
    const { _id, ...rest } = profile
    await this.col.updateOne({ _id: uid }, { $set: rest }, { upsert: true })
  }

  async top(field, limit = 10) {
    return this.col.find({ [field]: { $gt: 0 } }, { projection: PROJECTION }).sort({ [field]: -1 }).limit(limit).toArray()
  }

  async close() {
    await this.client?.close().catch(() => {})
  }
}

class MemoryStore {
  constructor() {
    this.file = path.resolve('data/dev-db.json')
    this.map = new Map()
    this.dirty = false
  }

  async connect() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      for (const [k, v] of Object.entries(raw)) this.map.set(k, v)
      console.log(`[db] memory store loaded ${this.map.size} profiles from ${this.file}`)
    } catch {
      console.log('[db] memory store (no MONGODB_URI) - starting empty')
    }
    this.timer = setInterval(() => this.flush(), 5000)
    this.timer.unref?.()
  }

  flush() {
    if (!this.dirty) return
    this.dirty = false
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.map)))
    } catch (err) {
      console.warn('[db] could not write dev db', err.message)
    }
  }

  async load(uid) {
    const p = this.map.get(uid)
    return p ? structuredClone(p) : null
  }

  async save(uid, profile) {
    this.map.set(uid, structuredClone(profile))
    this.dirty = true
  }

  async top(field, limit = 10) {
    return [...this.map.values()]
      .filter((p) => (p[field] || 0) > 0)
      .sort((a, b) => (b[field] || 0) - (a[field] || 0))
      .slice(0, limit)
  }

  async close() {
    clearInterval(this.timer)
    this.flush()
  }
}

export const db = process.env.MONGODB_URI ? new MongoStore(process.env.MONGODB_URI) : new MemoryStore()
