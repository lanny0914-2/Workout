import {
  cleanString,
  jsonResponse,
  methodNotAllowed,
  nullableString,
  profileExists,
  readJson,
  requireDb,
} from "../../_shared.js";

const VALUE_TYPES = new Set(["string", "number", "boolean", "json"]);

function cleanSetting(setting) {
  const key = cleanString(setting?.key, 120);
  const valueType = cleanString(setting?.value_type, 40) || "string";
  if (!key) return { error: "Every setting needs a key" };
  if (!VALUE_TYPES.has(valueType)) return { error: `Unsupported setting type: ${valueType}` };
  return { key, value: nullableString(setting?.value), value_type: valueType };
}

async function handleGet(env, params) {
  const dbError = requireDb(env);
  if (dbError) return dbError;
  if (!(await profileExists(env.DB, params.profileId))) return jsonResponse({ error: "Profile not found" }, 404);

  const { results } = await env.DB.prepare(
    `SELECT id, profile_id, key, value, value_type, created_at, updated_at
       FROM profile_settings
      WHERE profile_id = ?
      ORDER BY lower(key) ASC`,
  ).bind(params.profileId).all();

  return jsonResponse({ settings: results ?? [] });
}

async function handlePut(request, env, params) {
  const dbError = requireDb(env);
  if (dbError) return dbError;
  if (!(await profileExists(env.DB, params.profileId))) return jsonResponse({ error: "Profile not found" }, 404);

  const body = await readJson(request);
  const incomingSettings = Array.isArray(body?.settings) ? body.settings : null;
  if (!incomingSettings) return jsonResponse({ error: "settings must be an array" }, 400);

  const cleaned = [];
  for (const setting of incomingSettings) {
    const result = cleanSetting(setting);
    if (result.error) return jsonResponse({ error: result.error }, 400);
    cleaned.push(result);
  }

  if (cleaned.length > 0) {
    await env.DB.batch(cleaned.map((setting) =>
      env.DB.prepare(
        `INSERT INTO profile_settings (id, profile_id, key, value, value_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(profile_id, key) DO UPDATE SET
           value = excluded.value,
           value_type = excluded.value_type,
           updated_at = CURRENT_TIMESTAMP`,
      ).bind(crypto.randomUUID(), params.profileId, setting.key, setting.value, setting.value_type),
    ));
  }

  return handleGet(env, params);
}

export async function onRequest({ request, env, params }) {
  if (request.method === "GET") return handleGet(env, params);
  if (request.method === "PUT") return handlePut(request, env, params);
  return methodNotAllowed();
}
