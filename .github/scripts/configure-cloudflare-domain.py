import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from urllib.parse import urlparse


API_BASE = "https://api.cloudflare.com/client/v4"
MAX_API_RETRIES = 4
PAGES_DEV_WAIT_SECONDS = 300
PAGES_DEV_POLL_SECONDS = 10
DOMAIN_ACTIVE_WAIT_SECONDS = 900
DOMAIN_ACTIVE_POLL_SECONDS = 15
DOMAIN_READY_STATES = {
    "active",
    "pending",
    "pending_verification",
    "pending_validation",
    "pending_deployment",
    "initializing",
}


class CloudflareApiError(RuntimeError):
    def __init__(self, message, status=None, error_messages=None):
        super().__init__(message)
        self.status = status
        self.error_messages = error_messages or []


def collect_error_messages(payload):
    return [
        item.get("message", "")
        for item in payload.get("errors", [])
        if item.get("message")
    ]


def require_env(name):
    value = os.environ.get(name)
    if not value:
        print(f"Missing required environment variable: {name}", file=sys.stderr)
        sys.exit(1)
    return value


def cloudflare_request(method, path, token, body=None):
    data = None
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    if body is not None:
        data = json.dumps(body).encode("utf-8")

    for attempt in range(1, MAX_API_RETRIES + 1):
        request = urllib.request.Request(
            f"{API_BASE}{path}",
            data=data,
            headers=headers,
            method=method,
        )

        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            payload = error.read().decode("utf-8")
            try:
                parsed = json.loads(payload)
            except json.JSONDecodeError:
                api_error = CloudflareApiError(
                    f"Cloudflare API request failed with HTTP {error.code}",
                    status=error.code,
                )
            else:
                error_messages = collect_error_messages(parsed)
                messages = " ".join(error_messages).lower()
                api_error = CloudflareApiError(
                    f"Cloudflare API request failed with HTTP {error.code}: {messages}",
                    status=error.code,
                    error_messages=error_messages,
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

        try:
            parsed = json.loads(payload)
        except json.JSONDecodeError as error:
            raise RuntimeError("Cloudflare API returned invalid JSON") from error

        if not parsed.get("success", False):
            error_messages = collect_error_messages(parsed)
            messages = " ".join(error_messages).lower()
            raise CloudflareApiError(
                f"Cloudflare API request failed: {messages}",
                error_messages=error_messages,
            )

        return parsed

    raise RuntimeError("Cloudflare API request failed after retries")


def is_already_exists_error(error):
    messages = " ".join(error.error_messages).lower()
    return (
        "already exists" in messages
        or "already associated" in messages
        or "already added" in messages
    )


def domain_result(payload):
    result = payload.get("result", payload)
    return result if isinstance(result, dict) else {}


def domain_state_from_payload(payload):
    domain = domain_result(payload)
    state = str(domain.get("status") or domain.get("state") or "").lower()
    return state.replace(" ", "_").replace("-", "_")


def get_pages_project(account_id, project_name, token):
    project = urllib.parse.quote(project_name, safe="")
    return cloudflare_request(
        "GET",
        f"/accounts/{account_id}/pages/projects/{project}",
        token,
    ).get("result", {})


def normalize_pages_hostname(value):
    if not value:
        return ""

    candidate = str(value).strip()
    if not candidate:
        return ""

    if "://" not in candidate:
        candidate = f"https://{candidate}"

    hostname = urlparse(candidate).hostname or ""
    return hostname.lower()


def collect_deployment_aliases(project):
    aliases = []
    for deployment_key in ("latest_deployment", "canonical_deployment"):
        deployment = project.get(deployment_key)
        if isinstance(deployment, dict):
            aliases.extend(deployment.get("aliases") or [])
    return aliases


def pages_production_hostname(project):
    subdomain = normalize_pages_hostname(project.get("subdomain"))
    if subdomain.endswith(".pages.dev"):
        return subdomain

    aliases = [
        normalize_pages_hostname(alias)
        for alias in collect_deployment_aliases(project)
    ]
    aliases = [alias for alias in aliases if alias.endswith(".pages.dev")]
    stable_aliases = [alias for alias in aliases if alias.count(".") == 2]

    if stable_aliases:
        return stable_aliases[0]

    raise RuntimeError("Cloudflare Pages project did not report a production pages.dev hostname")


def wait_for_pages_dev(pages_target):
    url = f"https://{pages_target}/"
    deadline = time.time() + PAGES_DEV_WAIT_SECONDS
    last_error = ""

    while time.time() < deadline:
        request = urllib.request.Request(url, headers={"User-Agent": "SiteFactory/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                if 200 <= response.status < 400:
                    print(f"pages.dev URL: {pages_target}")
                    return
                last_error = f"HTTP {response.status}"
        except Exception as error:
            last_error = str(error)

        print(f"Waiting for pages.dev URL: {pages_target}")
        time.sleep(PAGES_DEV_POLL_SECONDS)

    raise RuntimeError(f"pages.dev URL did not become ready: {pages_target} ({last_error})")


def attach_pages_domain(account_id, project_name, custom_domain, token):
    project = urllib.parse.quote(project_name, safe="")
    path = f"/accounts/{account_id}/pages/projects/{project}/domains"
    try:
        result = cloudflare_request("POST", path, token, {"name": custom_domain})
    except CloudflareApiError as error:
        if not is_already_exists_error(error):
            raise
        print(f"Custom domain status: already exists")
        return

    state = domain_state_from_payload(result)
    if state and state not in DOMAIN_READY_STATES:
        raise RuntimeError(f"Cloudflare Pages custom domain is not ready for DNS: {custom_domain} ({state})")

    print(f"Custom domain status: {state or 'accepted'}")


def get_pages_domain(account_id, project_name, custom_domain, token):
    project = urllib.parse.quote(project_name, safe="")
    domain = urllib.parse.quote(custom_domain, safe="")
    path = f"/accounts/{account_id}/pages/projects/{project}/domains/{domain}"
    return cloudflare_request("GET", path, token)


def poll_domain_until_active(account_id, project_name, custom_domain, token):
    deadline = time.time() + DOMAIN_ACTIVE_WAIT_SECONDS
    last_state = "unknown"

    while time.time() < deadline:
        try:
            payload = get_pages_domain(account_id, project_name, custom_domain, token)
            state = domain_state_from_payload(payload) or "unknown"
        except CloudflareApiError as error:
            state = f"api_error_{error.status or 'unknown'}"

        if state != last_state:
            print(f"Custom domain status: {state}")
            last_state = state

        if state == "active":
            return

        time.sleep(DOMAIN_ACTIVE_POLL_SECONDS)

    raise RuntimeError(f"Custom domain did not become active: {custom_domain} ({last_state})")


def find_dns_record(zone_id, custom_domain, token):
    query = urllib.parse.urlencode({"type": "CNAME", "name": custom_domain})
    path = f"/zones/{zone_id}/dns_records?{query}"
    result = cloudflare_request("GET", path, token)
    records = result.get("result", [])
    return records[0] if records else None


def upsert_cname_record(zone_id, custom_domain, target, token):
    existing = find_dns_record(zone_id, custom_domain, token)
    body = {
        "type": "CNAME",
        "name": custom_domain,
        "content": target,
        "ttl": 1,
    }

    if existing:
        body["proxied"] = existing.get("proxied", True)
        record_id = existing["id"]
        cloudflare_request("PUT", f"/zones/{zone_id}/dns_records/{record_id}", token, body)
    else:
        body["proxied"] = True
        cloudflare_request("POST", f"/zones/{zone_id}/dns_records", token, body)

    print(f"DNS target: {custom_domain} -> {target}")


def main():
    custom_domain = require_env("CUSTOM_DOMAIN")
    project_name = require_env("PAGES_PROJECT_NAME")
    account_id = require_env("CLOUDFLARE_ACCOUNT_ID")
    zone_id = require_env("CLOUDFLARE_ZONE_ID")
    token = require_env("CLOUDFLARE_API_TOKEN")

    print(f"Pages project name: {project_name}")
    print(f"Custom domain: {custom_domain}")

    project = get_pages_project(account_id, project_name, token)
    pages_target = pages_production_hostname(project)
    wait_for_pages_dev(pages_target)
    attach_pages_domain(account_id, project_name, custom_domain, token)
    upsert_cname_record(zone_id, custom_domain, pages_target, token)
    poll_domain_until_active(account_id, project_name, custom_domain, token)


if __name__ == "__main__":
    main()