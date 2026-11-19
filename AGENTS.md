# AGENTS.md · ig-gateway

Guide for coding agents. What it is, how it is configured, how the MCP is registered and how it is deployed is in `README.md` (and `README.es.md`).

## What it is

Local gateway that publishes to Instagram through Meta's Graph API. A single exit point for all projects: it enforces the quota, the request limit and the publication log. It has three input adapters that share the same use cases: HTTP (`src/http/`), CLI (`src/cli/`) and an MCP server (`src/mcp/`). The MCP **does not** call the use cases: it is an HTTP client of the running service, so that the quota and the log live in one place.

**Publishing is irreversible from the API.** There is no scheduling, no drafts and no deletion. Treat it as a production operation.

## Architecture

Hexagonal in `src/`, with dependencies pointing inwards:

- `domain/`: entities and ports (`Account.ts`, `MediaItem.ts`, `Publication.ts`, `PublicationError.ts`, `Quota.ts`, `ActiveHours.ts`, `Caption.ts`, `ports.ts`). Pure logic, no I/O, no config and no logger.
- `application/`: use cases that only talk to ports: `PublishMedia`, `PublishStory`, `CheckAccount`, `GetQuota`, `ListMedia`, `GetInsights`, `GetActiveHours`, `DiscoverAccount`, `ModerateComment`, `SweepStaging`. `memory.ts` is an in-memory implementation for tests.
- `infrastructure/`: the only place that touches the network, the disk or Meta:
  - `graph/GraphClient.ts`: Graph API client, with adaptive polling and retries.
  - `staging/DiskMediaStaging.ts`: temporary copies of the media.
  - `accounts/EnvAccountResolver.ts`: account registry per project.
  - `logging/JsonlPublicationLog.ts` and `Logger.ts`.
  - `config/InstallEnvFile.ts`.
- `http/app.ts` and `http/server.ts`: Express routes (`/health`, `/v1/publications`, `/v1/quota`, `/v1/media`, `/v1/media/:id/insights`, `/v1/media/:id/comments`, `/v1/accounts/check`, `/v1/discovery/:username`, `/v1/account/active-hours`...). Each route composes its use case.
- `cli/index.ts`: command-line subcommands over the same use cases.
- `mcp/`: MCP server with its own `domain/` (`ig-gateway-port.ts`, `actions.ts`, `preview.ts`, `media-rules.ts`, `server-instructions.ts`), `application/` (`publish-preview.ts`, `publish.ts`, `execute-instagram-action.ts`, `preview-registry.ts`...) and `infrastructure/config.ts`. It calls the service's HTTP.

Publishing flow: the use case validates the media and the caption → the quota → `GraphClient` creates the container, polls until `FINISHED` and calls `media_publish` → the publication is recorded in the JSONL log. In the MCP, `publish-preview` returns a `preview_id` and `publish` requires that same content.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm install` | Installs dependencies (`--frozen-lockfile` in the Makefile). |
| `pnpm build` | Typecheck and esbuild to `dist/` (CLI, HTTP and `dist/mcp/ig-mcp.mjs`). |
| `pnpm typecheck` | `tsc --noEmit`. |
| `pnpm test` / `test:coverage` / `test:watch` | Vitest. |
| `make deploy` | Depends on `release`: versioning and `git push --follow-tags`. Then build, syncs `dist/`, reinstalls production dependencies at the destination, and restarts the unit. **Uses `sudo` and publishes to the remote. Do not run it without an explicit order.** |
| `make restart` | Restarts the unit (`sudo`). |
| `make release` | Requires a clean tree, runs `commit-and-tag-version` and pushes. |

`-include local.mk` in the Makefile allows a local deployment configuration. `local.mk` is ignored by git: do not version it.

## How to test a change

- Tests in `*.test.ts` (24 files), with Vitest. The use cases are tested with `memory.ts` and doubles of the ports.
- To exercise publishing **without** calling `media_publish`, use dry-run mode: `IG_DRY_RUN` (see the README, development section). Never test real publications in the tests.
- Before accepting a change: `pnpm test && pnpm typecheck && pnpm build`.
- Every new action, validation or fixed bug comes with its test in the same change.

## Conventions

- TypeScript ESM (`"type": "module"`) with Express 5, winston and the MCP SDK. Code in English, class names in PascalCase, files in PascalCase in `application/` and `infrastructure/`.
- Meta's API rules live in `domain/` and in `mcp/domain/media-rules.ts`. Before changing them, check Meta's current documentation with the docs tool you have available.
- Version and `CHANGELOG.md`: `commit-and-tag-version` with `make release`. **Not edited by hand.**
- Environment configuration (`.env`, not versioned, based on `.env.example`). Meta tokens never go into the repo or into logs.

## Decisions and pitfalls

- **No scheduling.** `published=false` with `scheduled_publish_time` returns an error. Scheduling is the responsibility of each project (cron or queue), not of the gateway.
- **Retries only before publishing.** The retries (0 s, 5 s, 20 s) cover only failures before `media_publish`. After publishing, it is never retried.
- **Verifying an unknown result.** If `media_publish` fails, the gateway checks the account: if the publication went out, it responds as published with `recovered: true`. Do not retry blindly.
- **App request limit.** It is different from the publishing quota (100 every 24 h). The gateway applies its own throttle (`IG_MAX_CALLS_PER_MINUTE`) and a quota cache (`IG_QUOTA_TTL_MS`).
- **Hashtag cap.** Lowered from 30 to 5 (commit `1f4bec7`), which is the real limit of the API.
- **Input errors.** An invalid input responds 400, not 500 (commit `cea7445`).
- **MCP without direct access.** Do not add an MCP call to a use case: it would break the single quota and log.
- **Domain dependency.** `domain/` does not import infrastructure; `application/` only imports from `domain/`. Keep it that way when adding code.

## Maintenance

- This file and the `README.md` are updated in the same change that makes them outdated.
- Only publishable content goes here: no local paths, machine ports, IPs, secret profiles or personal data.
