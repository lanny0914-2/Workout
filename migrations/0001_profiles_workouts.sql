PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS profile_settings (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  value_type TEXT NOT NULL DEFAULT 'string',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(profile_id, key),
  FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workout_sessions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  mode TEXT,
  mode_type TEXT,
  started_at TEXT NOT NULL,
  warmup_ended_at TEXT,
  ended_at TEXT,
  target_reps INTEGER,
  completed_reps INTEGER,
  warmup_reps INTEGER,
  weight_kg REAL,
  display_unit TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workout_entries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  entry_order INTEGER NOT NULL,
  entry_type TEXT,
  reps INTEGER,
  weight_kg REAL,
  duration_seconds INTEGER,
  notes TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(session_id) REFERENCES workout_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_profile_settings_profile_id ON profile_settings(profile_id);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_profile_id_started_at ON workout_sessions(profile_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_workout_entries_session_id_entry_order ON workout_entries(session_id, entry_order);
