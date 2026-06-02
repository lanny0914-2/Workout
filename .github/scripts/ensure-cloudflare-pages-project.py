import json
import os
import random
import string
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


API_BASE = "https://api.cloudflare.com/client/v4"
DEFAULT_PROJECT_NAME_FILE = ".cloudflare-pages-project-name"
MAX_ATTEMPTS = 12
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


def project_name_file():
    return os.environ.get("PAGES_PROJECT_NAME_FILE", DEFAULT_PROJECT_NAME_FILE)


def read_existing_project_name(path):
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as file:
        value = file.read().strip()
    if not value:
        raise RuntimeError(f"{path} exists but does not contain a project name")
    return value


def write_project_name(path, project_name):
    with open(path, "w", encoding="utf-8") as file:
        file.write(f"{project_name}\n")


def append_github_env(project_name):
    github_env = os.environ.get("GITHUB_ENV")
    if not github_env:
        return
    with open(github_env, "a", encoding="utf-8") as file:
        file.write(f"PAGES_PROJECT_NAME={project_name}\n")


def error_messages(payload):
    return [item.get("message", "") for item in payload.get("errors", []) if item.get("message")]


def cloudflare_request(method, path, token, body=None):
    data = None
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")

    for attempt in range(1, MAX_API_RETRIES + 1):
        request = urllib.request.Request(f"{API_BASE}{path}", data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            payload = error.read().decode("utf-8")
            try:
                parsed = json.loads(payload)
                messages = error_messages(parsed)
            except json.JSONDecodeError:
                messages = []
            api_error = CloudflareApiError(
                f"Cloudflare API request failed with HTTP {error.code}",
                status=error.code,
                error_messages=messages,
            )
            if error.code >= 500 and attempt < MAX_API_RETRIES:
                print(f"Cloudflare API returned HTTP {error.code}; retrying ({attempt}/{MAX_API_RETRIES})")
                time.sleep(attempt * 2)
                continue
            raise api_error
        except urllib.error.URLError as error:
            if attempt < MAX_API_RETRIES:
                print(f"Cloudflare API request failed transiently; retrying ({attempt}/{MAX_API_RETRIES})")
                time.sleep(attempt * 2)
                continue
            raise RuntimeError("Cloudflare API request failed after retries") from error

        parsed = json.loads(payload)
        if not parsed.get("success", False):
            raise CloudflareApiError("Cloudflare API request failed", error_messages=error_messages(parsed))
        return parsed

    raise RuntimeError("Cloudflare API request failed after retries")


def is_name_unavailable(error):
    messages = " ".join(error.error_messages).lower()
    return any(phrase in messages for phrase in ("already exists", "already taken", "name is taken", "unavailable", "not available"))


def suffix():
    alphabet = string.ascii_lowercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(3))


def candidate_names(base_project_name):
    yield base_project_name
    for _ in range(MAX_ATTEMPTS - 1):
        yield f"{base_project_name}-{suffix()}"


def create_pages_project(account_id, token, project_name):
    body = {"name": project_name, "production_branch": "main"}
    cloudflare_request("POST", f"/accounts/{account_id}/pages/projects", token, body)


def get_pages_project(account_id, token, project_name):
    project = urllib.parse.quote(project_name, safe="")
    return cloudflare_request("GET", f"/accounts/{account_id}/pages/projects/{project}", token)


def is_missing_project(error):
    messages = " ".join(error.error_messages).lower()
    return error.status == 404 or "project not found" in messages


def ensure_project_exists(account_id, token, project_name):
    try:
        get_pages_project(account_id, token, project_name)
        return project_name
    except CloudflareApiError as error:
        if not is_missing_project(error):
            raise
    create_pages_project(account_id, token, project_name)
    return project_name


def select_project_name(base_project_name, account_id, token, path):
    existing = read_existing_project_name(path)
    if existing:
        try:
            return ensure_project_exists(account_id, token, existing)
        except CloudflareApiError as error:
            if not is_name_unavailable(error):
                raise

    for project_name in candidate_names(base_project_name):
        try:
            create_pages_project(account_id, token, project_name)
        except CloudflareApiError as error:
            if is_name_unavailable(error):
                continue
            raise
        write_project_name(path, project_name)
        return project_name

    raise RuntimeError(f"Unable to reserve a Cloudflare Pages project name after {MAX_ATTEMPTS} attempts")


def main():
    base_project_name = require_env("BASE_PROJECT_NAME")
    account_id = require_env("CLOUDFLARE_ACCOUNT_ID")
    token = require_env("CLOUDFLARE_API_TOKEN")
    path = project_name_file()
    selected = select_project_name(base_project_name, account_id, token, path)
    append_github_env(selected)
    print(f"Selected Cloudflare Pages project: {selected}")


if __name__ == "__main__":
    main()