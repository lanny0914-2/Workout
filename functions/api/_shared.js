export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function methodNotAllowed() {
  return jsonResponse({ error: "Method not allowed" }, 405);
}

export function requireDb(env) {
  if (!env.DB) {
    return jsonResponse({ error: "D1 binding DB is not configured" }, 500);
  }
  return null;
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function cleanString(value, maxLength = 255) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function nullableString(value, maxLength = 4000) {
  if (value === null || value === undefined || value === "") return null;
  return String(value).slice(0, maxLength);
}

export function nullableInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

export function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function profileExists(db, profileId) {
  const profile = await db.prepare("SELECT id FROM profiles WHERE id = ?").bind(profileId).first();
  return Boolean(profile);
}
