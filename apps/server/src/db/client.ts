import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { Database } from 'bun:sqlite'

const DATA_DIR = join(process.cwd(), 'data')
const DB_PATH = join(DATA_DIR, 'rollhook.db')

mkdirSync(DATA_DIR, { recursive: true })
mkdirSync(join(DATA_DIR, 'logs'), { recursive: true })

export const db = new Database(DB_PATH, { create: true })

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    app TEXT NOT NULL,
    image_tag TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`)
