import {
  cleanString,
  jsonResponse,
  methodNotAllowed,
  nullableInteger,
  nullableNumber,
  nullableString,
  profileExists,
  readJson,
  requireDb,
} from "../../_shared.js";

function cleanIsoString(value, fallback = null) {
  const text = nullableString(value, 80);
  if (!text) return fallback;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function cleanJson(value, maxLength = 50000) {
  if (!value) return null;
  if (typeof value === "string") return nullableString(value, maxLength);
  if (typeof value === "object") return JSON.stringify(value).slice(0, maxLength);
  return null;
}

function boolToInt(value) {
  if (value === null || value === undefined || value === "") return null;
  return value ? 1 : 0;
}

async function hasLoadMetricColumns(db) {
  const { results } = await db.prepare("PRAGMA table_info(workout_sessions)").all();
  const columns = new Set((results || []).map((row) => row.name));
  return columns.has("average_actual_load_kg") && columns.has("load_summary_json");
}

async function hasRepMetricsTable(db) {
  const row = await db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'workout_rep_metrics'").first();
  return Boolean(row);
}

async function fetchRepMetrics(db, sessionIds) {
  if (!sessionIds.length || !(await hasRepMetricsTable(db))) return new Map();
  const placeholders = sessionIds.map(() => "?").join(",");
  const { results } = await db.prepare(
    `SELECT * FROM workout_rep_metrics WHERE session_id IN (${placeholders}) ORDER BY session_id, rep_number`,
  ).bind(...sessionIds).all();
  const bySession = new Map();
  for (const row of results || []) {
    if (!bySession.has(row.session_id)) bySession.set(row.session_id, []);
    bySession.get(row.session_id).push(row);
  }
  return bySession;
}

async function handleGet(env, params) {
  const dbError = requireDb(env);
  if (dbError) return dbError;
  if (!(await profileExists(env.DB, params.profileId))) return jsonResponse({ error: "Profile not found" }, 404);

  const hasLoadColumns = await hasLoadMetricColumns(env.DB);
  const selectLoadColumns = hasLoadColumns
    ? `programmed_load_kg, average_commanded_load_kg, average_actual_load_kg,
       peak_actual_load_kg, minimum_actual_load_kg, resistance_varied,
       load_summary_json,`
    : `NULL AS programmed_load_kg, NULL AS average_commanded_load_kg, NULL AS average_actual_load_kg,
       NULL AS peak_actual_load_kg, NULL AS minimum_actual_load_kg, NULL AS resistance_varied,
       NULL AS load_summary_json,`;

  const { results } = await env.DB.prepare(
    `SELECT id, profile_id, mode, mode_type, started_at, warmup_ended_at,
            ended_at, target_reps, completed_reps, warmup_reps, weight_kg,
            display_unit, ${selectLoadColumns} metadata_json, created_at, updated_at
       FROM workout_sessions
      WHERE profile_id = ?
      ORDER BY started_at DESC
      LIMIT 100`,
  ).bind(params.profileId).all();

  const sessions = results ?? [];
  const repMetrics = await fetchRepMetrics(env.DB, sessions.map((session) => session.id));
  for (const session of sessions) {
    session.rep_metrics = repMetrics.get(session.id) || [];
  }

  return jsonResponse({ workout_sessions: sessions });
}

async function insertRepMetrics(db, sessionId, reps) {
  if (!Array.isArray(reps) || !reps.length || !(await hasRepMetricsTable(db))) return;
  await db.batch(reps.map((rep, index) => db.prepare(
    `INSERT INTO workout_rep_metrics
      (id, session_id, rep_number, rep_kind, mode, started_at, ended_at,
       up_duration_seconds, down_duration_seconds, total_duration_seconds,
       active_duration_seconds, programmed_load_kg, average_commanded_load_kg,
       average_actual_load_kg, average_actual_load_up_kg, average_actual_load_down_kg,
       peak_actual_load_kg, minimum_actual_load_kg, starting_actual_load_kg,
       ending_actual_load_kg, resistance_varied, average_actual_load_left_kg,
       average_actual_load_right_kg, average_actual_load_combined_kg,
       completion_status, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  ).bind(
    crypto.randomUUID(),
    sessionId,
    nullableInteger(rep.repNumber) ?? index + 1,
    cleanString(rep.repKind, 40) || null,
    cleanString(rep.mode, 120) || null,
    cleanIsoString(rep.startedAt),
    cleanIsoString(rep.endedAt),
    nullableNumber(rep.upDurationSeconds),
    nullableNumber(rep.downDurationSeconds),
    nullableNumber(rep.totalDurationSeconds),
    nullableNumber(rep.activeDurationSeconds),
    nullableNumber(rep.programmedLoadKg),
    nullableNumber(rep.averageCommandedLoadKg),
    nullableNumber(rep.averageActualLoadKg),
    nullableNumber(rep.averageActualLoadUpKg),
    nullableNumber(rep.averageActualLoadDownKg),
    nullableNumber(rep.peakActualLoadKg),
    nullableNumber(rep.minimumActualLoadKg),
    nullableNumber(rep.startingActualLoadKg),
    nullableNumber(rep.endingActualLoadKg),
    boolToInt(rep.resistanceVaried),
    nullableNumber(rep.averageActualLoadLeftKg),
    nullableNumber(rep.averageActualLoadRightKg),
    nullableNumber(rep.averageActualLoadCombinedKg),
    cleanString(rep.completionStatus, 40) || null,
    cleanJson(rep.metadata, 12000),
  )));
}

async function handlePost(request, env, params) {
  const dbError = requireDb(env);
  if (dbError) return dbError;
  if (!(await profileExists(env.DB, params.profileId))) return jsonResponse({ error: "Profile not found" }, 404);

  const body = await readJson(request);
  const mode = cleanString(body?.mode, 120);
  const startedAt = cleanIsoString(body?.started_at);
  if (!mode) return jsonResponse({ error: "mode is required" }, 400);
  if (!startedAt) return jsonResponse({ error: "started_at must be a valid date" }, 400);

  const session = {
    id: crypto.randomUUID(),
    mode,
    mode_type: cleanString(body?.mode_type, 40) || null,
    started_at: startedAt,
    warmup_ended_at: cleanIsoString(body?.warmup_ended_at),
    ended_at: cleanIsoString(body?.ended_at),
    target_reps: nullableInteger(body?.target_reps),
    completed_reps: nullableInteger(body?.completed_reps),
    warmup_reps: nullableInteger(body?.warmup_reps),
    weight_kg: nullableNumber(body?.weight_kg),
    display_unit: cleanString(body?.display_unit, 12) || null,
    programmed_load_kg: nullableNumber(body?.programmed_load_kg),
    average_commanded_load_kg: nullableNumber(body?.average_commanded_load_kg),
    average_actual_load_kg: nullableNumber(body?.average_actual_load_kg),
    peak_actual_load_kg: nullableNumber(body?.peak_actual_load_kg),
    minimum_actual_load_kg: nullableNumber(body?.minimum_actual_load_kg),
    resistance_varied: boolToInt(body?.resistance_varied),
    load_summary_json: cleanJson(body?.load_summary, 50000),
    metadata_json: body?.metadata && typeof body.metadata === "object"
      ? JSON.stringify(body.metadata).slice(0, 50000)
      : nullableString(body?.metadata_json, 50000),
  };

  if (await hasLoadMetricColumns(env.DB)) {
    await env.DB.prepare(
      `INSERT INTO workout_sessions
        (id, profile_id, mode, mode_type, started_at, warmup_ended_at, ended_at,
         target_reps, completed_reps, warmup_reps, weight_kg, display_unit,
         programmed_load_kg, average_commanded_load_kg, average_actual_load_kg,
         peak_actual_load_kg, minimum_actual_load_kg, resistance_varied,
         load_summary_json, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ).bind(
      session.id,
      params.profileId,
      session.mode,
      session.mode_type,
      session.started_at,
      session.warmup_ended_at,
      session.ended_at,
      session.target_reps,
      session.completed_reps,
      session.warmup_reps,
      session.weight_kg,
      session.display_unit,
      session.programmed_load_kg,
      session.average_commanded_load_kg,
      session.average_actual_load_kg,
      session.peak_actual_load_kg,
      session.minimum_actual_load_kg,
      session.resistance_varied,
      session.load_summary_json,
      session.metadata_json,
    ).run();
    await insertRepMetrics(env.DB, session.id, body?.rep_summaries);
  } else {
    await env.DB.prepare(
      `INSERT INTO workout_sessions
        (id, profile_id, mode, mode_type, started_at, warmup_ended_at, ended_at,
         target_reps, completed_reps, warmup_reps, weight_kg, display_unit,
         metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ).bind(
      session.id,
      params.profileId,
      session.mode,
      session.mode_type,
      session.started_at,
      session.warmup_ended_at,
      session.ended_at,
      session.target_reps,
      session.completed_reps,
      session.warmup_reps,
      session.weight_kg,
      session.display_unit,
      session.metadata_json,
    ).run();
  }

  await env.DB.prepare(
    `INSERT INTO workout_entries
      (id, session_id, entry_order, entry_type, reps, weight_kg, duration_seconds,
       notes, metadata_json, created_at, updated_at)
     VALUES (?, ?, 1, 'summary', ?, ?, ?, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  ).bind(
    crypto.randomUUID(),
    session.id,
    session.completed_reps,
    session.weight_kg,
    session.ended_at
      ? Math.max(0, Math.round((new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 1000))
      : null,
  ).run();

  const saved = (await handleGet(env, params)).clone ? null : null;
  const hasLoadColumns = await hasLoadMetricColumns(env.DB);
  const selectLoadColumns = hasLoadColumns
    ? `programmed_load_kg, average_commanded_load_kg, average_actual_load_kg,
       peak_actual_load_kg, minimum_actual_load_kg, resistance_varied,
       load_summary_json,`
    : `NULL AS programmed_load_kg, NULL AS average_commanded_load_kg, NULL AS average_actual_load_kg,
       NULL AS peak_actual_load_kg, NULL AS minimum_actual_load_kg, NULL AS resistance_varied,
       NULL AS load_summary_json,`;
  const row = await env.DB.prepare(
    `SELECT id, profile_id, mode, mode_type, started_at, warmup_ended_at,
            ended_at, target_reps, completed_reps, warmup_reps, weight_kg,
            display_unit, ${selectLoadColumns} metadata_json, created_at, updated_at
       FROM workout_sessions
      WHERE id = ?`,
  ).bind(session.id).first();
  row.rep_metrics = (await fetchRepMetrics(env.DB, [session.id])).get(session.id) || [];

  return jsonResponse({ workout_session: row }, 201);
}

export async function onRequest({ request, env, params }) {
  if (request.method === "GET") return handleGet(env, params);
  if (request.method === "POST") return handlePost(request, env, params);
  return methodNotAllowed();
}
