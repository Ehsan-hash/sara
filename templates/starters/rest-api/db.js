// The data: one table of items in SQLite (built into Node, no package).
import { DatabaseSync } from 'node:sqlite';

export function openDb(file = process.env.DB_FILE || 'data.db') {
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`);
  const row = (r) => (r ? { id: Number(r.id), name: String(r.name), done: Boolean(r.done), createdAt: String(r.created_at) } : undefined);
  return {
    list: () => db.prepare('SELECT * FROM items ORDER BY id').all().map(row),
    get: (id) => row(db.prepare('SELECT * FROM items WHERE id = ?').get(id)),
    create: (name) => row(db.prepare('INSERT INTO items (name, created_at) VALUES (?, ?) RETURNING *').get(name, new Date().toISOString())),
    update: (id, patch) => {
      const cur = row(db.prepare('SELECT * FROM items WHERE id = ?').get(id));
      if (!cur) return undefined;
      const next = { ...cur, ...patch };
      return row(db.prepare('UPDATE items SET name = ?, done = ? WHERE id = ? RETURNING *').get(next.name, next.done ? 1 : 0, id));
    },
    remove: (id) => Number(db.prepare('DELETE FROM items WHERE id = ?').run(id).changes) > 0,
    close: () => db.close(),
  };
}
