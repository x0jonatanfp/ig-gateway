# ig-gateway

**English** · [Español](README.es.md)

A standalone service that centralises Instagram Graph API access for other local
projects. It keeps the Page tokens, enforces the publishing quota and the rate
limits, stages the media Instagram has to download and logs every publication.
Callers never see a token: they only name the account they use.

Three entry points share the same use cases: an HTTP API, a CLI and an MCP
server for agents.

## What it does

- Publishes photo, carousel (2–10), reel and story.
- Reads the account, the publishing quota, the media list and the insights of a
  single post.
- Tells you when the account's followers are online: the average per hour over
  the last 30 days, in the time zone you ask for.
- Searches Instagram's audio library (Meta's music or original sounds) and
  attaches a track to a reel when publishing it.
- Lists, replies to and hides comments.
- Reads public data (profile, counters, up to 100 posts) of a **different**
  Business/Creator account through Business Discovery.
- Runs a two-step publication flow (preview, then confirm) so nothing is
  published by accident.

## Architecture

Hexagonal, with dependencies pointing inwards:

| Directory | Contents |
| --- | --- |
| `src/domain/` | Entities, errors and ports (`Account`, `MediaItem`, `Publication`, `PublicationError`, `ports.ts`). Pure logic: no I/O, no config, no logger. |
| `src/application/` | Use cases that talk only to those ports: `PublishMedia`, `PublishStory`, `CheckAccount`, `GetQuota`, `ListMedia`, `GetInsights`, `GetActiveHours`, `DiscoverAccount`, `ModerateComment`, `SweepStaging`. |
| `src/infrastructure/` | Adapters, the only layer that touches the network, the filesystem or Meta: `GraphClient` (Graph API), `DiskMediaStaging` (staged copies), `EnvAccountResolver` (account registry), `JsonlPublicationLog` (publication log), `Logger`. |
| `src/http/`, `src/cli/`, `src/mcp/` | Three input adapters. Each one is a composition root that wires infrastructure into use cases. |

The MCP server repeats the same split (`src/mcp/domain`, `application`,
`infrastructure`) and deliberately does **not** call the use cases: it is an HTTP
client of the running service, so quota, rate limiting and the publication log
stay in a single place.

## MCP actions

The server exposes one tool, `instagram`, with `action` plus `params`:

| Action | Kind | What it does |
| --- | --- | --- |
| `check` | read | Resolves the project's account and reports counters plus Meta call stats. |
| `quota` | read | Publishing quota used, total and remaining. |
| `media` | read | Recent posts with their canonical permalinks. |
| `audio` | read | Instagram audio library: Meta's music or original sounds, with the ids to attach to a reel. |
| `insights` | read | Metrics of one post (`media_id`). |
| `active_hours` | read | Average followers online per hour (last 30 days) in the requested `timezone`. |
| `comments` | read | Comments of one post. |
| `discover` | read | Public data of another Business/Creator account. |
| `publication_status` | read | Status of a publication by its gateway id. |
| `publish_preview` | write | Dry run: validates media and returns a `preview_id`. |
| `publish` | write | Publishes a preview created in the same process. |
| `reply_comment` | write | Replies to a comment. |
| `hide_comment` | write | Hides a comment. |

None of the four write actions runs without an explicit `confirm: true`.
`publish` also requires the `preview_id` returned by `publish_preview` **in the
same process** and identical content (type, media, caption and options are
hashed with SHA-256; any change invalidates the preview).

## Quick start from scratch

### 1. Create a Meta app

Create an app in [Meta for Developers](https://developers.facebook.com/) and add
the **Instagram API with Facebook Login** product. Business Discovery,
publishing, comments and insights all go through `graph.facebook.com` with a
**Facebook Page token**; the older Instagram Login flow is not supported.

### 2. Instagram account and Page

You need an Instagram **professional** account (Business or Creator) linked to a
Facebook Page you administer. The account is queried by its ID: with a Page token
`/me` is the Page, not the Instagram account.

### 3. Permissions

`instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`,
`instagram_manage_insights`, `pages_show_list` and `pages_read_engagement`.
Reading messages would also need `instagram_manage_messages` (and enabling
message access in the Instagram account settings).

The Page token does not expire on its own (`debug_token`: type `PAGE`,
`expires_at` 0), but it is invalidated if the Facebook password changes, the app
is revoked or the role on the Page is lost (error 190). The **user** token behind
it does have an expiry: the app's access to data (`data_access_expires_at`) runs
out at some point, and then the whole cycle has to be repeated.

### 4. Get the Page token

With a long-lived user token carrying the permissions above:

```
GET /<page-id>?fields=access_token,instagram_business_account{id,username}
```

Page IDs come from `granular_scopes` (`pages_show_list`) when `me/accounts` comes
back empty. Then check each Page token with `debug_token` (type `PAGE`,
`expires_at` 0).

### 5. Create the account registry file

Each account is defined **once**, in `<IG_ACCOUNTS_DIR>/<name>.env` (mode 600,
never in git — default directory `./data/accounts`):

```
IG_FB_PAGE_TOKEN=…
IG_FB_ACCOUNT_ID=…        # the Instagram account id, not the Page id
IG_USERNAME=example_studio
```

Optional keys: `IG_CAPABILITY_ALT_TEXT`, `IG_CAPABILITY_USER_TAGS`,
`IG_CAPABILITY_COLLABORATORS`, `IG_CAPABILITY_LOCATION` (`0` disables a feature
for that account).

### 6. Point a project at the account

Projects never copy a token; they only name the account in their own `.env`:

```
IG_ACCOUNT=example_studio
```

`--account <name>` in the CLI overrides `IG_ACCOUNT` and does not need a project
at all. Registry keys win over the project's keys; a project without
`IG_ACCOUNT` keeps working with its own `IG_FB_PAGE_TOKEN` and
`IG_FB_ACCOUNT_ID`. If the account is missing from the registry the error is
`AUTHENTICATION` and nothing is published.

### 7. Serve the media over public HTTPS

Instagram can only download the staged copy from a public HTTPS URL, so
`IG_MEDIA_BASE_URL` must point at a location served by your web server. The
snippet in [`deploy/nginx/ig-media.conf`](deploy/nginx/ig-media.conf) enables
GET/HEAD only over that directory; adjust the `alias` to your install path:

```nginx
location ^~ /ig-media/ {
    alias /opt/ig-gateway/data/media/;
    limit_except GET HEAD { deny all; }
    autoindex off;
    try_files $uri =404;
}
```

```
IG_MEDIA_BASE_URL=https://your-domain.example/ig-media
```

### 8. Run the service

```bash
pnpm install
cp .env.example .env      # fill in IG_GATEWAY_TOKEN, IG_MEDIA_BASE_URL, …
chmod 600 .env
pnpm build
node dist/http/server.js
```

The HTTP server listens on loopback only. `GET /health` needs no authentication;
every other route requires the `x-ig-gateway-token` header.

### 9. Register the MCP server

Any stdio MCP client can launch it (the bundle is `dist/mcp/ig-mcp.mjs`):

```json
{
  "mcpServers": {
    "ig-gateway": {
      "command": "node",
      "args": ["/opt/ig-gateway/dist/mcp/ig-mcp.mjs"],
      "env": {
        "IG_GATEWAY_URL": "http://127.0.0.1:4005",
        "IG_GATEWAY_TOKEN": "<service-token>",
        "IG_DEFAULT_PROJECT": "/path/to/project"
      }
    }
  }
}
```

## Environment variables

| Variable | Use |
| --- | --- |
| `PORT` | HTTP port, loopback only. Default `4005`. |
| `IG_GRAPH_VERSION` | Graph API version. Default `v27.0`. |
| `IG_MEDIA_BASE_URL` | Public base URL Instagram downloads from. Required to publish. |
| `IG_GATEWAY_TOKEN` | Token expected in `x-ig-gateway-token`. |
| `IG_ACCOUNTS_DIR` | Account registry directory. Default `./data/accounts`. |
| `IG_STAGING_DIR` | Staged media copies. Default `./data/media`. |
| `IG_STAGING_TTL_HOURS` | Age after which `sweep` deletes orphan copies. Default `24`. |
| `IG_PUBLICATION_LOG` | Publication log (JSONL). Default `./data/logs/publications.jsonl`. |
| `IG_CALLS_LOG` | Shared call counter; empty keeps the count in-process only. |
| `IG_QUOTA_TTL_MS` | Quota cache. Default `300000` (5 min). |
| `IG_MAX_CALLS_PER_MINUTE` | Soft brake on calls to Meta. Default `30`. |
| `IG_DRY_RUN` | `1` runs the whole flow without calling `media_publish`. |
| `IG_GATEWAY_ENV` | CLI only: env file to load instead of `<install>/.env`. |
| `LOG_FILE` | Application log file. Default `/var/log/ig-gateway.log`. |
| `LOG_LEVEL` | Log level. Default `info`. |
| `IG_GATEWAY_URL` | MCP only: gateway base URL. Default `http://127.0.0.1:4005`. |
| `IG_GATEWAY_TOKEN` | MCP only: same token as the service. |
| `IG_DEFAULT_PROJECT` | MCP only: project used when the tool gets none. |

The CLI reads `<install>/.env` (two levels above `dist/cli/index.js`), so it can
run from any directory.

## Real Meta API limits

- Photo, reel and story take exactly one media item; carousel takes 2–10. Caption
  up to 2200 characters and 5 hashtags (20 mentions).
- `alt_text`, `user_tags`, `collaborators` (max 3, not in stories), `cover_url`,
  `thumb_offset`, `audio_name` and `share_to_feed` (reels only) are supported as
  far as each type allows; `location_id` is not allowed in carousels.
- Reels can carry a track from the audio library: `audio_id` plus the optional
  `audio_volume` and `video_volume` (integers 1–100) reach Meta as
  `audio_configuration` when the container is created. `audio_name` is something
  else: the label of the video's own original audio.
- **No scheduling** (`published=false` with `scheduled_publish_time` returns HTTP
  500, code 1), no drafts and no deletion through the API: scheduling belongs to
  each project's cron or queue, and what is published is removed by hand in the
  app.
- `is_paid_partnership` and `branded_content_sponsor_ids` return 400 (subcode
  2207109).
- Publishing quota: 100 posts every 24 h per account.

## API usage and resilience

Instagram has two different limits: the **publishing quota** and the **app
request limit** (code 4, “Application request limit reached”), which is the one
that bursts trigger. The gateway is tuned to spend as little as possible:

- **Adaptive polling**: after creating a container it asks with growing waits
  (2 s → 15 s). Separate profiles for image (45 s cap) and video (6 min cap). A
  normal photo is published with a single check.
- **Container failures with a reason**: the container is polled with
  `status_code,status`. If it ends in `ERROR` or `EXPIRED`, the message carries
  Meta's subcode (`… failed with ERROR (subcode 2207026: unsupported video
  format; upload an MOV or MP4)`), and so do the HTTP body, the caller's
  `result.json`, the CLI and the MCP. Unknown subcodes are shown as they come;
  without `status` the message says `Meta no dio detalle`. Only subcodes Meta
  documents have a text: it publishes none of its own for duration, edit list,
  codec, size or audio, so the gateway does not invent causes for those. Every
  failed publication is also written to `publications.jsonl` as a
  `publish_failed` event with `code`, `subcode`, `retryable` and `message`.
- **Cached quota** for 5 minutes per account (`IG_QUOTA_TTL_MS`); it always asks
  again when less than 20 % of margin is left, and publishing raises it by
  itself.
- **Retries with backoff** (0 s, 5 s, 20 s) and only for failures that happen
  before `media_publish`. After publishing it never retries.
- **Unknown-result verification**: if `media_publish` fails, the account is
  checked to see whether the post actually went out. If it did, it is reported
  as published with `recovered: true`; if it is confirmed absent, the error is
  retryable; if it cannot be checked, it is reported and not retried.
- **Soft brake**: at most `IG_MAX_CALLS_PER_MINUTE` calls per minute (30 by
  default). It waits instead of failing.
- **Visible counter**: `check` and `/health` report the calls made in the last
  hour and in the last minute.

## Development

```bash
pnpm install
pnpm test
pnpm test:coverage
pnpm typecheck
pnpm build
```

To exercise publishing without calling `media_publish`:

```bash
IG_DRY_RUN=1 pnpm exec ig-gateway publish --project /path/to/project --media image.jpg --caption "Test" --dry-run --json
```

Reading another account:

```bash
node dist/cli/index.js discover --account example_studio --username example_brand --limit 8 --json
```

Read-only: it returns the profile, the counters and up to 100 posts (25 per
page). Meta's `mediaUrl`/`thumbnailUrl` expire, so whoever uses them has to
download the images; `VIDEO` items carry `thumbnailUrl` instead of `mediaUrl`. A
personal or nonexistent target gives `NOT_FOUND`. The same is available over
HTTP as `GET /v1/discovery/:username?project=…&limit=…` and the metrics of one
post as `GET /v1/media/:id/insights?project=…`.

When followers are online (Meta's `online_followers` metric):

```bash
node dist/cli/index.js active-hours --project /path/to/project --timezone Europe/Madrid --json
```

Audio for a reel (read-only):

```bash
node dist/cli/index.js audio --project /path/to/project --type music --query "example" --limit 10 --json
```

Over HTTP: `GET /v1/audio?project=…&audio_type=music&search_query=…&limit=…`.
`audio_type` is `music` (Meta's collection, the default) or `original_sound`
(sounds taken from existing reels); without `search_query` Meta returns what is
trending. Each result carries the `audioId`, the title, the artist or account,
the duration and a preview link. Pass that `audioId` (with `audioVolume` and
`videoVolume` if the mix needs it) when publishing a reel.

Over HTTP: `GET /v1/account/active-hours?project=…&timezone=…` (UTC when no
`timezone` is given; an unknown zone gives `INVALID_REQUEST`). It returns the
average for every hour from 0 to 23, the three peak hours and how many days
were counted. Meta reports each day in Pacific hours; the gateway converts them
to the requested zone from the real end of each day, so daylight-saving changes
never shift anything. Only accounts with 100 or more followers have data, and
the last two days usually come back empty because Meta has not computed them
yet.

Never commit real tokens: the resolver reads the calling project's `.env`
through `--env-file`, `.env` or any `.env.*` holding the supported names.

## Example deployment

Build, copy `dist/` and the production dependencies next to it, and run
`dist/http/server.js` as a service. [`deploy/ig-gateway.service.example`](deploy/ig-gateway.service.example)
is a systemd unit with the secrets in an `EnvironmentFile` outside the
repository; [`Makefile`](Makefile) automates the same steps: `make deploy`
installs into `DEST`, and `make deploy DEST=/path` picks another prefix, which a
git-ignored `local.mk` (`DEST := …`) keeps for the next run.

The media directory has to be readable by the web server that serves
`IG_MEDIA_BASE_URL`, and `IG_STAGING_DIR` must match the nginx `alias`.

## License

MIT — see [LICENSE](LICENSE).
