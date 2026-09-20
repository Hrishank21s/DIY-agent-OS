-- 003_login_lockout_and_cleanup.sql
-- Adds brute-force lockout bookkeeping for the login endpoint and drops the
-- never-read `memories_fts` shadow table (the real index is the fts5 virtual
-- table `memories_fts_index`).

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  ip TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_user_time
  ON login_attempts(username, success, created_at);

-- Dead table that nothing reads; content/retention is handled by
-- memories_fts_index. Safe to drop.
DROP TABLE IF EXISTS memories_fts;