'use strict';
// 打开 SQLite 并执行迁移（migrations/NNN_*.sql 按序号执行一次，记录在 schema_migrations）
const fs = require('fs'), path = require('path');
const Database = require('better-sqlite3');
function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');      // 读写并发更好；备份见 README
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}
function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER)');
  const done = new Set(db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version));
  db.appliedNow = [];   // 本次启动新执行的迁移（seed 据此做一次性数据回填）
  const dir = path.join(__dirname, 'migrations');
  for (const f of fs.readdirSync(dir).filter(f => /^\d+_.*\.sql$/.test(f)).sort()) {
    if (done.has(f)) continue;
    db.transaction(() => {
      db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
      db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(f, Date.now());
    })();
    db.appliedNow.push(f);
  }
}
module.exports = { open, migrate };
