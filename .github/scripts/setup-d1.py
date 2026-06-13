import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API_BASE = "https://api.cloudflare.com/client/v4"
DB_NAME = os.environ.get("D1_DATABASE_NAME", "workout-profiles")
BINDING_NAME = os.environ.get("D1_BINDING_NAME", "DB")
MIGRATION_PATH = Path(os.environ.get("D1_MIGRATION_PATH", "migrations"))
MAX_API_RETRIES = 4


class CloudflareApiError(RuntimeError):
    def __init__(self, message, status=None, error_messages=None):
        super().__init__(message)
        self.status = status
        self.error_messages = error_messages or []


def require_env(name):
    value = os.environ.get(name)
    if not value:
        print(f"Missing required environment variable: {name}", file=sys.stderr)
        sys.exit(1)
    return value


def collect_error_messages(payload):
    return [item.get("message", "") for item in payload.get("errors", []) if item.get("message")]


def cloudflare_request(method, path, token, body=None):
    data = None
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")

    for attempt in range(1, MAX_API_RETRIES + 1):
        request = urllib.request.Request(f"{API_BASE}{path}", data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                payload = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            payload = error.read().decode("utf-8")
            try:
                parsed = json.loads(payload)
                messages = collect_error_messages(parsed)
            except json.JSONDecodeError:
                messages = []
            if error.code >= 500 and attempt < MAX_API_RETRIES:
                print(f"Cloudflare API returned HTTP {error.code}; retrying ({attempt}/{MAX_API_RETRIES})")
                time.sleep(attempt * 2)
                continue
            raise CloudflareApiError(
                f"Cloudflare API request failed with HTTP {error.code}",
                status=error.code,
                error_messages=messages,
            )
        except urllib.error.URLError as error:
            if attempt < MAX_API_RETRIES:
                print(f"Cloudflare API request failed transiently; retrying ({attempt}/{MAX_API_RETRIES})")
                time.sleep(attempt * 2)
                continue
            raise RuntimeError("Cloudflare API request failed after retries") from error

        parsed = json.loads(payload)
        if not parsed.get("success", False):
            raise CloudflareApiError("Cloudflare API request failed", error_messages=collect_error_messages(parsed))
        return parsed

    raise RuntimeError("Cloudflare API request failed after retries")


def result_list(payload):
    result = payload.get("result", [])
    if isinstance(result, list):
        return result
    if isinstance(result, dict):
        for key in ("items", "data", "projects", "domains"):
            value = result.get(key)
            if isinstance(value, list):
                return value
    return []


def list_databases(account_id, token):
    result = cloudflare_request("GET", f"/accounts/{account_id}/d1/database", token)
    return result_list(result)


def database_name(database):
    return database.get("name") or database.get("database_name")


def database_id(database):
    return database.get("uuid") or database.get("id")


def ensure_database(account_id, token):
    for database in list_databases(account_id, token):
        if database_name(database) == DB_NAME:
            print(f"Using existing D1 database: {DB_NAME}")
            return database_id(database)

    result = cloudflare_request("POST", f"/accounts/{account_id}/d1/database", token, {"name": DB_NAME})
    database = result.get("result", {})
    print(f"Created D1 database: {DB_NAME}")
    return database_id(database)


def split_sql(sql):
    statements = []
    current = []
    in_single = False
    in_double = False
    i = 0
    while i < len(sql):
        char = sql[i]
        next_char = sql[i + 1] if i + 1 < len(sql) else ""
        if not in_single and not in_double and char == "-" and next_char == "-":
            while i < len(sql) and sql[i] != "\n":
                i += 1
            continue
        if char == "'" and not in_double:
            in_single = not in_single
        elif char == '"' and not in_single:
            in_double = not in_double
        if char == ";" and not in_single and not in_double:
            statement = "".join(current).strip()
            if statement:
                statements.append(statement)
            current = []
        else:
            current.append(char)
        i += 1
    trailing = "".join(current).strip()
    if trailing:
        statements.append(trailing)
    return statements


def query_database(account_id, token, db_id, sql, params=None):
    body = {"sql": sql}
    if params:
        body["params"] = params
    return cloudflare_request("POST", f"/accounts/{account_id}/d1/database/{db_id}/query", token, body)


def migration_files():
    if MIGRATION_PATH.is_file():
        return [MIGRATION_PATH]
    if MIGRATION_PATH.is_dir():
        files = sorted(MIGRATION_PATH.glob("*.sql"))
        if files:
            return files
    raise RuntimeError(f"Migration path not found or empty: {MIGRATION_PATH}")


def is_repeatable_migration_error(error):
    text = " ".join(error.error_messages or [str(error)]).lower()
    repeatable_fragments = [
        "duplicate column name",
        "already exists",
        "table",
        "index",
    ]
    return "duplicate column name" in text or ("already exists" in text and any(fragment in text for fragment in repeatable_fragments))


def apply_migration(account_id, token, db_id):
    total = 0
    for migration in migration_files():
        statements = split_sql(migration.read_text(encoding="utf-8"))
        applied = 0
        skipped = 0
        for statement in statements:
            try:
                query_database(account_id, token, db_id, statement)
                applied += 1
            except CloudflareApiError as error:
                if is_repeatable_migration_error(error):
                    skipped += 1
                    continue
                raise
        total += applied
        print(f"Applied migration {migration}: {applied} statements, {skipped} already present")
    print(f"Applied migration statements total: {total}")


def verify_tables(account_id, token, db_id):
    expected = {"profiles", "profile_settings", "workout_sessions", "workout_entries", "workout_rep_metrics"}
    result = query_database(
        account_id,
        token,
        db_id,
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('profiles','profile_settings','workout_sessions','workout_entries','workout_rep_metrics') ORDER BY name",
    )
    rows = []
    for item in result.get("result", []):
        rows.extend(item.get("results", []))
    found = {row.get("name") for row in rows}
    missing = expected - found
    if missing:
        raise RuntimeError(f"Missing D1 tables after migration: {', '.join(sorted(missing))}")
    print(f"Verified D1 tables: {', '.join(sorted(found))}")


def get_project(account_id, token, project_name):
    project = urllib.parse.quote(project_name, safe="")
    return cloudflare_request("GET", f"/accounts/{account_id}/pages/projects/{project}", token).get("result", {})


def list_pages_projects(account_id, token):
    payload = cloudflare_request("GET", f"/accounts/{account_id}/pages/projects", token)
    return result_list(payload)


def project_domains(account_id, token, project_name):
    encoded = urllib.parse.quote(project_name, safe="")
    payload = cloudflare_request("GET", f"/accounts/{account_id}/pages/projects/{encoded}/domains", token)
    return result_list(payload)


def domain_name(domain):
    if isinstance(domain, str):
        return domain.lower()
    return str(domain.get("name") or domain.get("domain") or "").lower()


def find_project_by_custom_domain(account_id, token, custom_domain):
    target = custom_domain.lower()
    matches = []
    for project in list_pages_projects(account_id, token):
        project_name = project.get("name")
        if not project_name:
            continue
        try:
            domains = project_domains(account_id, token, project_name)
        except CloudflareApiError as error:
            if error.status == 404:
                continue
            raise
        if any(domain_name(domain) == target for domain in domains):
            matches.append(project_name)

    if len(matches) == 1:
        print(f"Found Pages project for {custom_domain}: {matches[0]}")
        return matches[0]
    if not matches:
        raise RuntimeError(f"No Cloudflare Pages project found for custom domain: {custom_domain}")
    raise RuntimeError(f"Multiple Cloudflare Pages projects found for custom domain {custom_domain}: {', '.join(sorted(matches))}")


def bind_pages_project(account_id, token, db_id, project_name):
    project = get_project(account_id, token, project_name)
    deployment_configs = project.get("deployment_configs") or {}
    for env_name in ("production", "preview"):
        config = deployment_configs.get(env_name) or {}
        d1_databases = config.get("d1_databases") or {}
        d1_databases[BINDING_NAME] = {"id": db_id}
        config["d1_databases"] = d1_databases
        deployment_configs[env_name] = config

    encoded_project_name = urllib.parse.quote(project_name, safe="")
    cloudflare_request(
        "PATCH",
        f"/accounts/{account_id}/pages/projects/{encoded_project_name}",
        token,
        {"deployment_configs": deployment_configs},
    )
    print(f"Bound D1 database to Pages project '{project_name}' as '{BINDING_NAME}'")


def verify_binding(account_id, token, db_id, project_name):
    project = get_project(account_id, token, project_name)
    configs = project.get("deployment_configs") or {}
    for env_name in ("production", "preview"):
        binding = ((configs.get(env_name) or {}).get("d1_databases") or {}).get(BINDING_NAME) or {}
        if binding.get("id") != db_id:
            raise RuntimeError(f"Missing Pages D1 binding in {env_name}")
    print("Verified Pages D1 binding for production and preview")


def main():
    account_id = require_env("CLOUDFLARE_ACCOUNT_ID")
    token = require_env("CLOUDFLARE_API_TOKEN")
    custom_domain = require_env("CUSTOM_DOMAIN")

    project_name = find_project_by_custom_domain(account_id, token, custom_domain)
    db_id = ensure_database(account_id, token)
    if not re.match(r"^[0-9a-fA-F-]{32,36}$", db_id or ""):
        raise RuntimeError("Cloudflare did not return a valid D1 database ID")
    apply_migration(account_id, token, db_id)
    verify_tables(account_id, token, db_id)
    bind_pages_project(account_id, token, db_id, project_name)
    verify_binding(account_id, token, db_id, project_name)
    print("D1 setup complete")


if __name__ == "__main__":
    main()
