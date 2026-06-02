import os
import re
import sys
from pathlib import Path

REQUEST_PATH = Path("SITE_REQUEST.md")
PROJECT_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]*[a-z0-9]$")
HOSTNAME_PATTERN = re.compile(r"^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)


def clean_value(value):
    value = value.strip()
    if value.startswith("`") and value.endswith("`"):
        value = value[1:-1].strip()
    return value


def extract_field(text, label):
    pattern = re.compile(rf"^- {re.escape(label)}:\s*(.+)$", re.MULTILINE)
    match = pattern.search(text)
    if not match:
        fail(f"SITE_REQUEST.md is missing required field: {label}")
    return clean_value(match.group(1))


def append_github_env(values):
    github_env = os.environ.get("GITHUB_ENV")
    if not github_env:
        return

    with open(github_env, "a", encoding="utf-8") as file:
        for key, value in values.items():
            file.write(f"{key}={value}\n")


def main():
    if not REQUEST_PATH.exists():
        fail("SITE_REQUEST.md does not exist")

    text = REQUEST_PATH.read_text(encoding="utf-8")
    base_project_name = extract_field(text, "Pages project base name")
    custom_domain = extract_field(text, "Custom domain")

    if not PROJECT_NAME_PATTERN.match(base_project_name):
        fail("Pages project base name must be lowercase letters, numbers, and hyphens")

    if not HOSTNAME_PATTERN.match(custom_domain):
        fail("Custom domain does not look like a valid hostname")

    append_github_env(
        {
            "BASE_PROJECT_NAME": base_project_name,
            "CUSTOM_DOMAIN": custom_domain,
        }
    )
    print(f"Loaded site request for Cloudflare Pages project base: {base_project_name}")
    print(f"Loaded custom domain: {custom_domain}")


if __name__ == "__main__":
    main()