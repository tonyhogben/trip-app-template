# Hooking up an AI agent

The feature request loop is what turns a trip itinerary into something the whole
group builds. This guide covers the webhook, the status API, and the exact pattern
used on the trip this template came from (where the agent was Grok Bot). Any agent
or automation can be plugged in the same way.

## The loop

```
 phone                Pages Function              your agent
 -----                --------------              ----------
 Send request  --->   POST /api/feature-request
                      saves feat:req:<id> in KV
                      POST FEATURE_WEBHOOK_URL ---> run starts
                                                    POST /api/feature-status  building
                                                    edit repo, npm run deploy
                                                    POST /api/feature-status  done + note
 Reload prompt <---   new build id on next check
 list shows Done <--  GET /api/feature-requests
```

## 1. The webhook (app to agent)

Set these as **secrets** on the Pages project:

- `FEATURE_WEBHOOK_URL`: an `https://` URL. Anything that can receive a POST and
  start your agent: an agent platform's webhook trigger, an automation tool hook,
  or a small server or Worker of your own. Leave unset to disable.
- `FEATURE_WEBHOOK_AUTH`: optional value for the `Authorization` header, usually
  `Bearer <token>`.
- `TRIP_SLUG`: optional (plain var), sent as `source` so one agent can serve
  several trips.

Every new request (text or voice) triggers one POST:

```json
{
  "source": "trip-app",
  "event": "feature-request",
  "id": "a1b2c3d4e5f6",
  "name": "Person A",
  "title": "Add a quote wall",
  "text": "Save the best one-liners with who said them",
  "transcript": "",
  "audioKey": null,
  "status": "open",
  "createdAt": 1767225600000,
  "callback": {
    "appUrl": "https://your-trip-app.pages.dev/",
    "statusUrl": "https://your-trip-app.pages.dev/api/feature-status",
    "listUrl": "https://your-trip-app.pages.dev/api/feature-requests?status=open",
    "audioUrl": null
  }
}
```

It is fire and forget: the request is stored in KV first, so a failed or slow
webhook never loses a request. Your agent can always catch up by polling `listUrl`.

### The Authorization header fix

On the original trip the webhook secret was pasted as the whole header line,
`Authorization: Bearer abc123`, so the receiver got
`Authorization: Authorization: Bearer abc123` and rejected every call. `_notify.js`
now strips a leading `Authorization:` from `FEATURE_WEBHOOK_AUTH`, so either form
works. If your receiver expects a different header name, change `_notify.js`.

## 2. The status API (agent to app)

```
POST /api/feature-status
Content-Type: application/json
Authorization: Bearer <AGENT_TOKEN>        (or X-Trip-Auth: <passcode hash> if AGENT_TOKEN is unset)

{ "id": "a1b2c3d4e5f6", "status": "building" }
{ "id": "a1b2c3d4e5f6", "status": "done", "note": "Live now: scroll to Quotes" }
{ "id": "a1b2c3d4e5f6", "status": "blocked", "note": "Needs a paid API key" }
```

Statuses: `open` (new), `building` (picked up), `done` (shipped), `blocked`
(cannot proceed, always add a note). `PATCH` works too. Send `"note": ""` to clear a
note. The call only rewrites that one request.

Set `AGENT_TOKEN` so only your agent can change statuses. Without it, anyone with
the passcode could (which is how the original trip ran, with the agent using the
same `X-Trip-Auth` header as the app).

## 3. Reading requests (catch-up and voice memos)

```bash
# open requests, newest first
curl -sS -H "Authorization: Bearer $AGENT_TOKEN" "$APP/api/feature-requests?status=open"

# voice memo bytes (Content-Type is the recorded type, e.g. audio/mp4 or audio/webm)
curl -sS -H "Authorization: Bearer $AGENT_TOKEN" -o memo "$APP/api/feature-audio/$AUDIO_KEY"
```

On phones the app does not run live speech-to-text (it steals the mic and leaves
recordings silent on iPhones), so voice requests usually arrive with an empty
`transcript`. Transcribe the audio on your side.

If a request ever seems missing from the list, `GET /api/feature-requests?repair=1`
(agent token only) rebuilds the index from the stored keys.

## 4. The Grok Bot pattern (what the original trip did)

1. A routine in the agent platform exposed a webhook trigger URL and token. Those
   went into `FEATURE_WEBHOOK_URL` and `FEATURE_WEBHOOK_AUTH`.
2. Each webhook started an agent run with the payload as its input. The run had
   this repo checked out, plus wrangler credentials to deploy the Pages project.
3. The run marked the request `building`, implemented it in the single-page app,
   built and deployed, then marked it `done` with a note (or `blocked`).
4. A second, scheduled routine polled `?status=open` as a safety net for any
   webhook that failed.
5. Open phones noticed the new build id and showed "New version ready".

Lessons worth keeping:

- Mark `building` first, deploy, then `done`. People loved watching the status move.
- A short `note` on done ("tap Theme, then Midnight") saves a flood of "where is it?"
  messages in the group chat.
- Keep the safety-net poll infrequent (every 15 to 30 minutes is plenty) and turn it
  off when the trip ends. Old routines left running keep using quota.
- Keep a list of what you built. It makes a great end-of-trip recap.

## Plugging in something else

- **Another agent platform**: same as above. Point the webhook at its trigger and
  give it AGENTS.md as instructions.
- **An automation tool** (Zapier, Make, n8n): catch the webhook, post it to a chat,
  a ticket, or a coding agent, and call `statusUrl` from a later step.
- **A human**: point the webhook at a chat channel's incoming webhook (via a tiny
  relay that formats a message) and update statuses with curl.
- **No webhook at all**: poll `listUrl` on a schedule.
