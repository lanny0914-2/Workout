PRAGMA foreign_keys = ON;

ALTER TABLE workout_sessions ADD COLUMN programmed_load_kg REAL;
ALTER TABLE workout_sessions ADD COLUMN average_commanded_load_kg REAL;
ALTER TABLE workout_sessions ADD COLUMN average_actual_load_kg REAL;
ALTER TABLE workout_sessions ADD COLUMN peak_actual_load_kg REAL;
ALTER TABLE workout_sessions ADD COLUMN minimum_actual_load_kg REAL;
ALTER TABLE workout_sessions ADD COLUMN resistance_varied INTEGER;
ALTER TABLE workout_sessions ADD COLUMN load_summary_json TEXT;

CREATE TABLE IF NOT EXISTS workout_rep_metrics (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  rep_number INTEGER NOT NULL,
  rep_kind TEXT,
  mode TEXT,
  started_at TEXT,
  ended_at TEXT,
  up_duration_seconds REAL,
  down_duration_seconds REAL,
  total_duration_seconds REAL,
  active_duration_seconds REAL,
  programmed_load_kg REAL,
  average_commanded_load_kg REAL,
  average_actual_load_kg REAL,
  average_actual_load_up_kg REAL,
  average_actual_load_down_kg REAL,
  peak_actual_load_kg REAL,
  minimum_actual_load_kg REAL,
  starting_actual_load_kg REAL,
  ending_actual_load_kg REAL,
  resistance_varied INTEGER,
  average_actual_load_left_kg REAL,
  average_actual_load_right_kg REAL,
  average_actual_load_combined_kg REAL,
  completion_status TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(session_id) REFERENCES workout_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workout_rep_metrics_session_rep ON workout_rep_metrics(session_id, rep_number);
