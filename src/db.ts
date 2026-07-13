import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const dbPath = path.resolve(__dirname, '../data/slack-app.db');
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

export const db = new sqlite3.Database(dbPath);

const _run = db.run.bind(db);
const _all = db.all.bind(db);
const _get = db.get.bind(db);

export const dbRun = (sql: string, params?: any[]): Promise<sqlite3.RunResult> =>
  new Promise((resolve, reject) =>
    _run(sql, params ?? [], function (this: sqlite3.RunResult, err: Error | null) {
      if (err) reject(err);
      else resolve(this);
    })
  );

export const dbAll = <T = any>(sql: string, params?: any[]): Promise<T[]> =>
  new Promise((resolve, reject) =>
    _all(sql, params ?? [], (err: Error | null, rows: T[]) => {
      if (err) reject(err);
      else resolve(rows);
    })
  );

export const dbGet = <T = any>(sql: string, params?: any[]): Promise<T | undefined> =>
  new Promise((resolve, reject) =>
    _get(sql, params ?? [], (err: Error | null, row: T) => {
      if (err) reject(err);
      else resolve(row);
    })
  );

// ─── Schema ──────────────────────────────────────────────────────────────────
export async function initDb() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS incidents (
      incident_id         TEXT PRIMARY KEY,
      title               TEXT NOT NULL,
      severity            TEXT NOT NULL,
      incident_channel_id TEXT NOT NULL,
      description         TEXT,
      context             TEXT DEFAULT '[]',
      tasks               TEXT DEFAULT '[]',
      last_digest_ts      TEXT,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

// ─── Queries ─────────────────────────────────────────────────────────────────
function hydrateIncident(row: any) {
  return {
    ...row,
    context: JSON.parse(row.context ?? '[]'),
    tasks: JSON.parse(row.tasks ?? '[]'),
  };
}

export async function saveIncident(incident: {
  incident_id: string;
  title: string;
  severity: string;
  incident_channel_id: string;
  description: string;
  context: any[];
  tasks: any[];
  last_digest_ts: string | null;
}) {
  await dbRun(
    `INSERT OR REPLACE INTO incidents
      (incident_id, title, severity, incident_channel_id, description, context, tasks, last_digest_ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      incident.incident_id,
      incident.title,
      incident.severity,
      incident.incident_channel_id,
      incident.description,
      JSON.stringify(incident.context),
      JSON.stringify(incident.tasks),
      incident.last_digest_ts,
    ]
  );
}

export async function getIncident(incident_id: string): Promise<any | null> {
  const row = await dbGet('SELECT * FROM incidents WHERE incident_id = ?', [incident_id]);
  return row ? hydrateIncident(row) : null;
}

export async function getIncidentsByChannel(incident_channel_id: string): Promise<any[]> {
  const rows = await dbAll(
    'SELECT * FROM incidents WHERE incident_channel_id = ? ORDER BY created_at DESC',
    [incident_channel_id]
  );
  return rows.map(hydrateIncident);
}
