import { cleanString, jsonResponse, methodNotAllowed, readJson, requireDb } from "../_shared.js";

async function handleGet(env) {
  const dbError = requireDb(env);
  if (dbError) return dbError;

  const { results } = await env.DB.prepare(
    `SELECT id, name, created_at, updated_at FROM profiles ORDER BY lower(name) ASC`,
  ).all();

  return jsonResponse({ profiles: results ?? [] });
}

async function handlePost(request, env) {
  const dbError = requireDb(env);
  if (dbError) return dbError;

  const body = await readJson(request);
  const name = cleanString(body?.name, 80);
  if (!name) return jsonResponse({ error: "Profile name is required" }, 400);

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO profiles (id, name, created_at, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ).bind(id, name).run();
  } catch (error) {
    if (String(error?.message ?? "").toLowerCase().includes("unique")) {
      return jsonResponse({ error: "A profile with that name already exists" }, 409);
    }
    throw error;
  }

  const profile = await env.DB.prepare(
    `SELECT id, name, created_at, updated_at FROM profiles WHERE id = ?`,
  ).bind(id).first();

  return jsonResponse({ profile }, 201);
}

export async function onRequest({ request, env }) {
  if (request.method === "GET") return handleGet(env);
  if (request.method === "POST") return handlePost(request, env);
  return methodNotAllowed();
}
