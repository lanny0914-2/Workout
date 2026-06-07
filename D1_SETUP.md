# D1 Setup

This app uses Cloudflare Pages Functions with a D1 binding named `DB`.

Do not commit real Cloudflare account IDs, database IDs, API tokens, zone IDs, or secrets.

## Create the D1 database

```powershell
npx wrangler d1 create workout-profiles
```

## Local development binding

Copy `wrangler.example.toml` to `wrangler.toml` locally and replace only the placeholder `database_name` and `database_id` values.

## Apply migrations locally

```powershell
npx wrangler d1 migrations apply workout-profiles --local
```

## Apply migrations remotely

```powershell
npx wrangler d1 migrations apply workout-profiles --remote
```

## Bind D1 to Cloudflare Pages

In the Cloudflare Pages project settings, add a D1 database binding:

- Binding name: `DB`
- Database: the D1 database created above

The existing GitHub Actions workflow deploys Cloudflare Pages from `main`. This feature branch should not be merged or deployed until the D1 database and binding are ready.
