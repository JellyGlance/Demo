# JellyGlance Demo

A live, read-only [JellyGlance](https://github.com/Nerdy-Technician/JellyGlance) you can put in front of people. Visitors land on a fully populated dashboard: real films and shows, a year of viewing history, people watching right now, a busy download queue, upcoming releases, requests and alerts. No real media server or apps needed, no setup screens and no login.

## What's in the stack

| Service | What it does |
| --- | --- |
| `jellyglance` | The stock JellyGlance image, configured entirely from environment variables. |
| `mock-services` | Stand-ins for the apps JellyGlance talks to, all built from one library (below). |
| `seeder` | Writes about 3,500 plays covering the last year, connects the integrations, switches off scheduled backups, and rebuilds everything every 4 hours so the demo always looks current. |
| `gateway` | The public front door. Signs visitors in automatically, adds a small "Live demo" badge, and refuses anything that would change data. |
| `db` | Postgres for JellyGlance. |

### The library

With a free [TMDB](https://www.themoviedb.org/settings/api) key, the library is real: about 300 popular films, 50 documentaries and 50 TV shows, with posters, backdrops, overviews, seasons and episodes. Episodes that have aired are in the library; upcoming ones appear in the calendar. Without a key, the demo falls back to generated titles and artwork.

TMDB data is cached in a volume and refreshed weekly, so restarts don't hit TMDB again.

### The fake apps

`mock-services` answers as each app under its own hostname:

| App | What the demo shows |
| --- | --- |
| Jellyfin | Libraries, users, artwork, and people watching in real time (more in the evening, never nobody). |
| Sonarr, Radarr | Calendar of upcoming episodes and films; disk space, with one disk nearly full so the low-disk alert fires. |
| Prowlarr | Six indexers, one failing. |
| Bazarr | Missing subtitles and recent subtitle downloads. |
| Jellyseerr | Requests from the demo users (pending, approved, declined, available) and a few open issues. |
| qBittorrent, SABnzbd | A moving download queue: items start, progress and finish, plus one stuck torrent, a paused one and a queued one. |

Everything comes from the same library, so a show in the calendar, a request in Jellyseerr and a torrent in the queue all match titles in JellyGlance.

## Run it locally

```bash
cp .env.example .env
# fill in POSTGRES_PASSWORD, JWT_SECRET, DEMO_PASSWORD (openssl rand -hex 32) and TMDB_API_KEY
docker compose up -d --build
```

Open <http://localhost:8080>. The first start takes a minute or two while the TMDB library is fetched, JellyGlance syncs it, and history is written; `docker compose logs -f seeder` shows progress.

## Deploy with GitHub Actions

`.github/workflows/deploy.yml` runs on every push to `main`, nightly (to pick up new JellyGlance releases), and on demand:

1. **Test**: unit tests and a compose file check.
2. **Build image**: builds `ghcr.io/jellyglance/demo` for amd64 and arm64 and pushes it to GitHub Container Registry.
3. **Deploy**: copies `docker-compose.yml` to your server over SSH, writes `.env` from repository secrets, then pulls and restarts.

### Hetzner Cloud (easiest)

`.github/workflows/hetzner.yml` creates the server for you:

1. In the [Hetzner Cloud console](https://console.hetzner.cloud), create a project and an API token with read and write access. Save it as the `HCLOUD_TOKEN` secret.
2. Make a deploy key with `ssh-keygen -t ed25519 -N "" -f demo_key` and save the contents of `demo_key` (the private half) as the `DEMO_SSH_KEY` secret.
3. Add `POSTGRES_PASSWORD`, `JWT_SECRET` and `DEMO_PASSWORD` secrets (`openssl rand -hex 32` for each) and the `TMDB_API_KEY` variable.
4. Run **Actions → Provision Hetzner server → Run workflow**. It creates a `cx23` server (about €4 a month) running Ubuntu 24.04 with Docker, a `deploy` user that can only log in with the key, and a firewall that only lets in SSH, HTTP and HTTPS. Then it starts a deploy. Running it again leaves an existing server alone.
5. The run summary shows the server's IP address and a line for the optional `DEMO_SSH_KNOWN_HOSTS` secret. The demo is on `http://<ip>` straight away.

For HTTPS on your own domain, add a DNS A record pointing at the IP, set the `DEMO_DOMAIN` variable (for example `demo.jellyglance.com`), and run **Test, build and deploy**. Caddy starts in front of the gateway and gets a certificate automatically.

You don't need `DEMO_HOST` with Hetzner: each deploy looks the server up by name.

### Any other server

Any small Linux server with Docker and the Compose plugin works. Create a user that can run Docker, add the deploy public key to its `~/.ssh/authorized_keys`, and set `DEMO_HOST`. For HTTPS, set `DEMO_DOMAIN` and point it at the server (Caddy is included), or put your own reverse proxy in front of port 8080.

### Repository secrets

Add these under **Settings → Secrets and variables → Actions**:

| Secret | Required | Purpose |
| --- | --- | --- |
| `HCLOUD_TOKEN` | Hetzner only | Hetzner Cloud API token. Used to create the server and to find its IP on each deploy. |
| `DEMO_HOST` | other servers | Server hostname or IP. Without it (or a Hetzner server) the deploy step is skipped. |
| `DEMO_SSH_USER` | no | SSH user on the server. Defaults to `deploy`. |
| `DEMO_SSH_KEY` | yes | Private key for that user. |
| `DEMO_SSH_KNOWN_HOSTS` | recommended | Output of `ssh-keyscan your-server`, so the server's identity is checked. |
| `DEMO_SSH_PORT` | no | Defaults to 22. |
| `DEMO_PATH` | no | Folder on the server. Defaults to `/opt/jellyglance-demo`. |
| `POSTGRES_PASSWORD`, `JWT_SECRET`, `DEMO_PASSWORD` | yes* | Written to the server's `.env`. *Leave them out to manage `.env` on the server yourself. |

And these under the **Variables** tab:

| Variable | Required | Purpose |
| --- | --- | --- |
| `TMDB_API_KEY` | recommended | Real titles and artwork. (A secret with the same name also works.) |
| `DEMO_DOMAIN` | no | Domain for the demo. When set, Caddy serves it over HTTPS. |
| `DEMO_SERVER_NAME` | no | Name of the Hetzner server. Defaults to `jellyglance-demo`. |
| `DEMO_EXTRA_ENV` | no | Extra settings for `.env`, one `KEY=value` per line, for example `GATEWAY_BEHIND_PROXY=true`. |

Variables aren't masked in workflow logs. The workflow never prints the TMDB key, but use a secret instead if you'd rather it was hidden even from people who can edit the workflow.

## How read-only works

The gateway lets through page loads, reads, and the live-update socket. It refuses with a friendly message:

- anything that changes data (`POST`/`PUT`/`DELETE`), except the handful of read-only POST calls JellyGlance makes (`/api/get…`, `/stats/get…`, login)
- GET routes that start work, such as syncs, tasks, backups and utilities

Even if something slipped through, the reset every 4 hours rebuilds the history and integrations from scratch.

Backups are switched off: the gateway blocks every backup route, and on each reset the seeder pushes JellyGlance's scheduled backup out to once every ten years, so the demo never writes backup files.

## Settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `TMDB_API_KEY` | (none) | Real film and TV data. v3 API key or v4 read access token. |
| `DEMO_PORT` | `8080` | Port the gateway listens on (the deploy sets `80` on Hetzner without a domain). |
| `DEMO_DOMAIN` | (none) | With `COMPOSE_PROFILES=https`, Caddy serves this domain over HTTPS. |
| `DEMO_RESET_EVERY_HOURS` | `4` | How often to rebuild history and integrations (on the hour, counted from midnight). |
| `DEMO_HISTORY_DAYS` | `365` | How much history to generate. |
| `DEMO_MAX_SESSIONS` | `4` | Peak number of simulated viewers in the evening. |
| `DEMO_SEED` | `jellyglance-demo` | Change it for a different set of users and history. |
| `JELLYGLANCE_TAG` | `latest` | JellyGlance image tag to demo. |
| `DEMO_IMAGE_TAG` | `latest` | Demo image tag (set by the deploy workflow). |
| `DEMO_SITE_URL` | `https://jellyglance.com` | Where the badge's "Get JellyGlance" link goes. |
| `GATEWAY_BEHIND_PROXY` | `false` | Set to `true` behind Caddy, Traefik, Cloudflare or similar, so each visitor is rate-limited on their own address. |
| `TZ` | `Europe/London` | Time zone for history and resets. |

## Development

```bash
npm install
npm test                                              # gateway rules, dataset and fake app checks
PORT=18096 ARR_PORT=18097 DEMO_DATA_DIR=./data npm run services
curl -H "Host: sonarr" localhost:18097/api/v3/calendar # talk to a fake app
```

## Credits

Film and TV data and images come from [TMDB](https://www.themoviedb.org). This product uses the TMDB API but is not endorsed or certified by TMDB.

## Licence

MIT
