import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = path.resolve(__dirname, '../../data/mcp-tasks.db');
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

export const db = new sqlite3.Database(dbPath);

export const dbRun = (sql: string, params?: any[]): Promise<sqlite3.RunResult> =>
  new Promise((resolve, reject) =>
    db.run(sql, params ?? [], function (this: sqlite3.RunResult, err: Error | null) {
      if (err) reject(err);
      else resolve(this);
    })
  );

export const dbAll = <T = any>(sql: string, params?: any[]): Promise<T[]> =>
  new Promise((resolve, reject) =>
    db.all(sql, params ?? [], (err: Error | null, rows: T[]) => {
      if (err) reject(err);
      else resolve(rows);
    })
  );

export const dbGet = <T = any>(sql: string, params?: any[]): Promise<T | undefined> =>
  new Promise((resolve, reject) =>
    db.get(sql, params ?? [], (err: Error | null, row: T) => {
      if (err) reject(err);
      else resolve(row);
    })
  );

export async function initDb(): Promise<void> {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS tasks (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      title             TEXT NOT NULL,
      incident_id       TEXT NOT NULL,
      assignee_slack_id TEXT,
      status            TEXT NOT NULL DEFAULT 'todo',
      due_date          TEXT,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}
