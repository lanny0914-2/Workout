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

async function handleGet(env, params) {
  const dbError = requireDb(env);
  if (dbError) return dbError;
  if (!(await profileExists(env.DB, params.profileId))) return jsonResponse({ error: "Profile not found" }, 404);

  const { results } = await env.DB.prepare(
    `SELECT id, profile_id, mode, mode_type, started_at, warmup_ended_at,
            ended_at, target_reps, completed_reps, warmup_reps, weight_kg,
            display_unit, metadata_json, created_at, updated_at
       FROM workout_sessions
      WHERE profile_id = ?
      ORDER BY started_at DESC
      LIMIT 100`,
  ).bind(params.profileId).all();

  return jsonResponse({ workout_sessions: results ?? [] });
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
    metadata_json: body?.metadata && typeof body.metadata === "object"
      ? JSON.stringify(body.metadata).slice(0, 12000)
      : nullableString(body?.metadata_json, 12000),
  };

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

  const saved = await env.DB.prepare(
    `SELECT id, profile_id, mode, mode_type, started_at, warmup_ended_at,
            ended_at, target_reps, completed_reps, warmup_reps, weight_kg,
            display_unit, metadata_json, created_at, updated_at
       FROM workout_sessions
      WHERE id = ?`,
  ).bind(session.id).first();

  return jsonResponse({ workout_session: saved }, 201);
}

export async function onRequest({ request, env, params }) {
  if (request.method === "GET") return handleGet(env, params);
  if (request.method === "POST") return handlePost(request, env, params);
  return methodNotAllowed();
}
