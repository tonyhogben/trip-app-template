# AGENTS.md

Instructions for an AI coding agent working on this repo. Read this before you
change anything. Humans: see README.md.

## What this is

A private group-trip web app on Cloudflare Pages + KV. The organiser seeds it with
an agenda and a crew. During the trip the crew sends feature requests from the app,
and you (the agent) build them live: edit, deploy, report status. The app should
end the trip feeling like the group's own creation.

## How it is structured

- `src/config.js`: **all trip data and settings** (`window.TRIP_CONFIG`): trip name,
  dates, `utcOffset`, crew, agenda, links, notices, themes, poll intervals, `mode`.
  Shipped to every browser, so never put secrets here.
- `src/index.html`: markup for the gate, hero, ticker, nav, sections (About, Agenda,
  Crew, Requests), bottom bar, sheets (theme, check-in, install), update prompt.
- `src/app.js`: one IIFE, plain ES5-style JS, no framework. Sections are
  `setupX()` functions called from `start()` (after unlock) or at boot.
  Key helpers: `api(path, opts)` adds the auth header and re-locks on 401;
  `poller(fn, ms)` is the ONLY way to poll; `chips(el, selected, onPick)` renders
  crew name pickers; `esc()` escapes HTML (use it for every user string).
- `src/styles.css`: CSS variables in `:root` define the Mono base theme. Themes
  override variables in `[data-theme="id"]` blocks.
- `src/sw.js`: versioned shell cache, network-first HTML, no skipWaiting until the
  user taps Reload.
- `functions/`: Pages Functions. Files starting with `_` are shared modules, not
  routes. `functions/api/<name>.js` serves `/api/<name>`.
  - `_auth.js`: `guard()`, `isCrew()` (X-Trip-Auth vs `TRIP_PASS_HASH`),
    `isAgent()` (Bearer `AGENT_TOKEN`), `requestsClosed()`.
  - `_features.js`: request storage. Keys `feat:req:<id>`, index `feat:ids`,
    change marker `feat:version`, audio `feat:audio:<id>`.
  - `_notify.js`: POSTs new requests to `FEATURE_WEBHOOK_URL`.
- `scripts/build.sh`: copies `src/` to `dist/` and stamps `__BUILD_ID__` into
  `index.html` (meta `app-build`, asset `?v=`) and `sw.js`. Every deploy gets a new
  build id, which triggers the "New version ready" prompt on open phones.

### API

| Method | Path | Auth | Body / query |
|---|---|---|---|
| POST | `/api/auth` | crew | checks the passcode hash, no KV |
| POST | `/api/feature-request` | crew | `{ title, details?, name? }` |
| POST | `/api/feature-voice` | crew | multipart `audio`, `title?`, `details?`, `name?`, `transcript?` |
| GET | `/api/feature-requests` | crew or agent | `?status=`, `?since=<version>`, `?repair=1` (agent) |
| POST/PATCH | `/api/feature-status` | agent (or crew if no `AGENT_TOKEN`) | `{ id, status, note? }` |
| GET | `/api/feature-audio/<audioKey>` | crew or agent | voice memo bytes |
| POST | `/api/checkin` | crew | `{ placeId, name }` |
| GET | `/api/checkins` | crew or agent | `?places=a,b&since=<version>` |

Crew auth: header `X-Trip-Auth: <sha256 hex of passcode>`. Agent auth:
`Authorization: Bearer <AGENT_TOKEN>`, or the crew header when `AGENT_TOKEN` is unset.

## Setup checklist (new trip)

Work through this with the organiser. Ask for anything you do not know rather than
inventing it.

1. [ ] **Trip**: `trip.name`, `tagline`, `place`, `startDate` (real date, not
       `"auto"`), `utcOffset`, `timeLabel`, `slug` in `src/config.js`.
2. [ ] **Agenda**: replace every placeholder day and item. Give each item a stable
       `id` (check-ins are stored by it). Use 24h `HH:MM` so Now / Up next works.
3. [ ] **Crew**: first names or nicknames only. No surnames, emails, phone numbers.
4. [ ] **Theme**: keep `mono` as the default. Optionally add one trip theme.
5. [ ] **Passcode**: organiser picks it; you set `TRIP_PASS_HASH`
       (`npm run hash -- "passcode"`) as a secret. Never commit the passcode or hash.
6. [ ] **KV**: `npx wrangler kv namespace create TRIP_KV`, put the id in
       `wrangler.toml`, set the project `name`.
7. [ ] **Webhook**: set `FEATURE_WEBHOOK_URL` (and `FEATURE_WEBHOOK_AUTH`) to your
       trigger, and `AGENT_TOKEN` for status updates. See docs/AGENT-HOOKUP.md.
8. [ ] **Links**: `links.groupChat` if the group has one. Update `notices`.
9. [ ] Deploy (`npm run deploy`), then run the smoke test against the live URL
       with a throwaway request and mark it done.
10. [ ] Replace the About section copy if the organiser wants their own words.

## Handling a feature request

When a webhook arrives (or you find `status=open` items):

1. **Read it fully**: `title`, `text`, `transcript`, and the voice memo
   (`GET /api/feature-audio/<audioKey>`) if there is one. Transcribe it yourself if
   `transcript` is empty.
2. **Mark it building** straight away so the requester sees it was picked up:
   ```bash
   curl -sS -X POST "$APP/api/feature-status" \
     -H "Authorization: Bearer $AGENT_TOKEN" -H "Content-Type: application/json" \
     -d '{"id":"REQUEST_ID","status":"building"}'
   ```
3. **Build it**. Prefer small, self-contained additions: a new section or a new
   bottom sheet plus a `setupX()` in `app.js`, or a new theme block. Keep the
   request's spirit; these are fun requests, and delight matters more than polish.
4. **Test locally** (`npm run dev`, and `npm run smoke` if you touched the API).
5. **Deploy**: `npm run deploy`. The build id changes and open phones get the
   Reload prompt.
6. **Mark it done** with a short note telling people where to find it:
   `{"id":"...","status":"done","note":"Live: tap Theme, then Midnight"}`.
   If you cannot do it, use `blocked` with a note that says why and what would
   unblock it. Never leave a request sitting in `building`.
7. Requests can arrive in bursts. Handle them one at a time and deploy after each,
   or batch a few related ones, but update every status.

### Saying no

Use `blocked` with a kind note for anything that would: collect personal data
(surnames, phone numbers, locations stored long term), cost money, need paid API
keys nobody has provided, embarrass or target a person, or weaken the passcode
gate. Offer a safer alternative in the note when you can.

## Keep KV usage low (important)

The original trip blew through its daily KV quota because of 10 to 60 second polls
that never paused, an extra `kv.list()` on every read, and a forgotten browser tab
left polling overnight. Rules:

- **All polling goes through `poller()`**, which stops while the tab is hidden and
  backs off on errors. Never use a bare `setInterval` for network calls.
- **Intervals in minutes, not seconds.** Defaults: features 120s, check-ins 180s,
  build check 600s (`TRIP_CONFIG.pollSeconds`). Do not go below 60s.
- **Use the version pattern for anything polled**: write a `<prefix>:version` key
  on every change; clients send `?since=`; return `{ unchanged: true }` after one
  read. See `feature-requests.js` and `checkins.js`.
- **No `kv.list()` in request paths.** It is the scarcest operation (1,000 a day
  on the free plan). Keep an index key instead, like `feat:ids`.
- **Fetch on demand**: load data when a sheet opens or a section scrolls into view,
  not on a timer, unless it really needs to be live.
- **One key per record** when several people can write at once (avoids lost
  updates), plus a small index.
- Do not leave a headless or real browser tab open on the live site.
- Free plan limits (per day): 100,000 reads, 1,000 writes, 1,000 deletes, 1,000
  lists. Workers Paid lifts these a lot if a trip gets busy.

## Wind down (end of trip)

1. **Wrap mode** (last day): set `mode: "wrap"` and a `wrapMessage` in
   `src/config.js`; set `FEATURE_REQUESTS_CLOSED=1`; delete `FEATURE_WEBHOOK_URL`
   (this disconnects the agent); deploy. Form hidden, "all wrapped up" note shown,
   wrap message in the bottom bar and ticker, no polling, every feature still works.
2. **Pause your own automations**: disable the webhook trigger or routine on your
   side and stop any scheduled jobs that call the app.
3. **Archive** (a day or two later): `npm run archive` (with `TRIP_URL` and
   `TRIP_PASSCODE`) writes `src/archive/features.json`; back up KV with
   `scripts/kv-backup.sh`; set `mode: "archive"`; deploy. No KV calls at all after this.
   Leave the KV data in place unless the organiser asks you to delete it.
4. **Revive**: set `mode: "live"`, unset `FEATURE_REQUESTS_CLOSED`, restore the
   webhook, deploy.

## Conventions

- **No personal data**: first names or nicknames only. No surnames, emails, phone
  numbers, booking references, ticket images, or exact home addresses in the repo
  or in KV. Venue names and public addresses for the agenda are fine.
- **No secrets in the repo**: passcodes, hashes, tokens, webhook URLs and KV ids for
  real deployments go in env vars or the Cloudflare dashboard. `.dev.vars` is
  gitignored.
- **Copy style**: short, friendly, plain English. **No em dashes** anywhere in
  copy, docs or comments: use commas, full stops or brackets.
- **One config spot**: trip data goes in `src/config.js`. Every name picker uses
  `TRIP_CONFIG.crew` via `chips()`.
- **Themes**: only through CSS variables. New theme = `[data-theme="id"]` block in
  `styles.css` + entry in `TRIP_CONFIG.themes`. Keep `mono` as the default and keep
  text readable on every surface (check the gate, hero, cards, bottom bar, sheets).
- **Accessibility**: real buttons, `aria-label` on icon buttons, respect
  `prefers-reduced-motion`, never rely on colour alone for status.
- **Mobile first**: test at 390x844. Inputs at 16px or more (no iOS zoom).
- **Sound and motion**: anything loud, flashing or vibrating must be opt-in and
  stop when the tab is hidden.
- **Escape user content** with `esc()` before putting it in HTML.
- **Keep it lean**: plain JS, no frameworks or build tools unless the organiser
  asks. Add new endpoints as `functions/api/<name>.js` using `guard()`.
- **Commit messages** say what the crew gets, e.g. "Add quote wall (request abc123)".
