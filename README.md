# JellyGlance Demo

A live, read-only [JellyGlance](https://github.com/Nerdy-Technician/JellyGlance) you can put in front of people. Visitors land on a fully populated dashboard: a year of viewing history, people watching right now, recaps, statistics and alerts. No real media server needed, no setup screens and no login.

## What's in the stack

| Service | What it does |
| --- | --- |
| `jellyglance` | The stock JellyGlance image, configured entirely from environment variables. |
| `mock-jellyfin` | A stand-in Jellyfin server: 3 libraries, 388 films, 46 series (1,281 episodes), 14 users, generated artwork, and simulated viewers who start, pause and finish things in real time. |
| `seeder` | Writes about 3,700 plays covering the last year (evening peaks, weekend binges, a mix of devices and transcodes) and rebuilds it every night so the demo always looks current. |
| `gateway` | The public front door. Signs visitors in automatically, adds a small "Live demo" badge, and refuses anything that would change data. |
| `db` | Postgres for JellyGlance. |

All titles, people and artwork are generated, so there's nothing copyrighted and nothing real in the demo.

## Run it

```bash
cp .env.example .env
# fill in POSTGRES_PASSWORD, JWT_SECRET and DEMO_PASSWORD (openssl rand -hex 32)
docker compose up -d
```

Open <http://localhost:8080>. The first start takes about a minute while JellyGlance syncs the demo library and the history is written; `docker compose logs -f seeder` shows progress.

## How read-only works

The gateway lets through page loads, reads, and the live-update socket. It refuses with a friendly message:

- anything that changes data (`POST`/`PUT`/`DELETE`), except the handful of read-only POST calls JellyGlance makes (`/api/get…`, `/stats/get…`, login)
- GET routes that start work, such as syncs, tasks, backups and utilities

Even if something slips through, the nightly reset (04:00 by default) rebuilds the history from scratch.

## Settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `DEMO_PORT` | `8080` | Port the gateway listens on. |
| `JELLYGLANCE_TAG` | `latest` | JellyGlance image tag to demo. |
| `DEMO_SEED` | `jellyglance-demo` | Change it for a different set of users, titles and history. |
| `DEMO_HISTORY_DAYS` | `365` | How much history to generate. |
| `DEMO_RESET_HOUR` | `4` | Local hour of the nightly reset. |
| `DEMO_MAX_SESSIONS` | `4` | Peak number of simulated viewers in the evening (there's always at least one). |
| `DEMO_SITE_URL` | `https://jellyglance.com` | Where the badge's "Get JellyGlance" link goes. |
| `GATEWAY_BEHIND_PROXY` | `false` | Set to `true` behind Caddy, Traefik, Cloudflare or similar, so each visitor is rate-limited on their own address. |
| `TZ` | `Europe/London` | Time zone for history and the reset. |

## Putting it online

Run the stack on any small server and put a reverse proxy with HTTPS in front of the gateway, for example with Caddy:

```
demo.jellyglance.com {
  reverse_proxy localhost:8080
}
```

Then set `GATEWAY_BEHIND_PROXY=true`.

## Development

```bash
npm install
npm test                       # gateway rules and dataset checks
PORT=18096 npm run mock        # run the mock server on its own
```

## Licence

MIT
