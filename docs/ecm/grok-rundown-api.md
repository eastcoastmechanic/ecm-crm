# Grok daily rundown API

The nightly "ECM DAILY RUNDOWN" goes to the CRM as JSON. The CRM keeps one row per item and turns them into cards on the owner-only Planner plan **ECM Daily Rundown** (private group "ECM Owner Rundown", Josh is the only member; techs can't see it, since it carries money flags).

## Auth

A bot key from **/account → Bot keys** (for example make one named `rundown`, or reuse Grok's key). Send it as:

```
Authorization: Bearer ecmbot_...
```

The bot's name comes from its key. Items are stored per bot, so two bots never overwrite each other. Never paste the key into chat logs or docs.

## POST /api/rundown

`https://ecm-crm.vercel.app/api/rundown`, `Content-Type: application/json`.

```json
{
  "date": "2026-11-26",
  "period": { "from": "2026-11-25T22:00:00-05:00", "to": "2026-11-26T22:00:00-05:00" },
  "summary": "optional: the full rundown as markdown, kept for the record",
  "items": [
    {
      "key": "stable-id",
      "section": "happened | money | waiting | next | conflict",
      "title": "short card title (max 250)",
      "detail": "plain text or markdown (max 8000), optional",
      "due": "YYYY-MM-DD or null",
      "priority": "urgent | important | normal (default normal)",
      "source": "board | quo | email | quote | invoice | mass_save | crm | other, optional",
      "job_id": "CRM job uuid or null",
      "lead_id": "CRM lead uuid or null",
      "customer_id": "CRM customer uuid or null",
      "text_draft": { "customer_id": "uuid", "body": "the text you'd send (max 1000)" }
    }
  ],
  "closed_keys": ["keys you know are finished"]
}
```

Rules:

- `date` is the New York day the rundown covers. Up to 200 items per post.
- **`key` must be stable.** The same key updates the same card; it never makes a second one. Use the CRM id when there is one: `job:<job uuid>`, `lead:<lead uuid>`, `invoice:<doc number>`, `quo:<thread id>`, `email:<message id>`, `massave:<application #>`. Letters, numbers and `: _ . - /`, up to 120 characters, first character a letter or number.
- `section` picks the column: `waiting` → Waiting on me, `money` → Money / admin, `next` → Next actions, `conflict` → Conflicts, `happened` → What happened. Any item with a `text_draft` goes in **Texts to approve** instead.
- Items you stop sending stay open until Josh completes them. To close one yourself, put its key in `closed_keys`.
- A card Josh completed is never reopened. If you send its key again, it shows in `already_done` in the reply and nothing changes. Check `/api/rundown/state` before writing the rundown so you stop repeating finished items.
- "What happened" cards close on their own once you haven't repeated them for 2 days.
- If you change `section`, the card moves. If Josh moved, re-dated or relabelled a card by hand, it stays where he put it until you change that same field. If Josh edited the card's notes (for example the text draft wording), his edit is kept.
- `job_id`, `lead_id` and `customer_id` that don't exist in the CRM are dropped with a warning; the item still saves.
- `text_draft` is a suggested customer text. **Nothing is sent yet.** In a later update, Josh completing the card will send it through Quo, only if the customer has text consent. Write it the way Josh talks: short, plain, no sales fluff.
- Posting the same rundown twice is safe.

Reply (200):

```json
{
  "ok": true,
  "run_id": "uuid",
  "created": 3,
  "updated": 1,
  "unchanged": 6,
  "already_done": ["lead:..."],
  "closed": [],
  "auto_closed": ["board:2026-11-23-..."],
  "warnings": [],
  "planner": "queued"
}
```

Errors: 401 (bad or missing key), 400 `{ "error": "Invalid rundown", "details": ["items.3.section: ..."] }` (fix the field named and post again), 503 (tables not set up yet), 500 (try again).

## GET /api/rundown/state?since=ISO

Same key. Returns this bot's open items and the ones finished since `since` (default the last 14 days):

```json
{
  "ok": true,
  "since": "2026-11-12T00:00:00.000Z",
  "open": [{ "key": "job:...", "section": "next", "title": "...", "status": "open", "done_at": null, "done_by": null, "done_source": null, "last_run_date": "2026-11-26", "on_planner": true, "sent_at": null }],
  "finished": [{ "key": "lead:...", "status": "done", "done_at": "2026-11-27T14:02:00Z", "done_by": "josh", "done_source": "planner" }]
}
```

`status`: `open`, `done` (Josh completed it, or you closed it, or it auto-closed) or `dropped` (Josh deleted the card). `done_source`: `planner`, `grok` or `auto`.

## Example

Placeholder names only.

```json
{
  "date": "2026-11-26",
  "summary": "ECM DAILY RUNDOWN 11/26 ...",
  "items": [
    {
      "key": "job:11111111-1111-4111-8111-111111111111",
      "section": "happened",
      "title": "Furnace no-heat at Sample St finished, report filed",
      "source": "board",
      "job_id": "11111111-1111-4111-8111-111111111111"
    },
    {
      "key": "invoice:INV-1234",
      "section": "money",
      "title": "INV-1234 balance unpaid 14 days",
      "detail": "Second reminder went out 11/20. No reply.",
      "priority": "important",
      "source": "invoice"
    },
    {
      "key": "quo:thread-abc123",
      "section": "waiting",
      "title": "Reply to Pat Example about Tuesday slot",
      "detail": "Asked if Tuesday morning works for the AC tune-up.",
      "due": "2026-11-27",
      "priority": "urgent",
      "source": "quo",
      "customer_id": "22222222-2222-4222-8222-222222222222",
      "text_draft": {
        "customer_id": "22222222-2222-4222-8222-222222222222",
        "body": "Hi Pat, Tuesday at 9 works. We'll text when we're on the way. - Josh, East Coast Mechanical"
      }
    },
    {
      "key": "massave:APP-0001",
      "section": "next",
      "title": "Upload Mass Save rebate photos for APP-0001",
      "due": "2026-11-28",
      "source": "mass_save"
    },
    {
      "key": "conflict:2026-11-27-0900",
      "section": "conflict",
      "title": "Two jobs booked at 9 AM Friday",
      "priority": "urgent",
      "source": "crm"
    }
  ],
  "closed_keys": ["lead:33333333-3333-4333-8333-333333333333"]
}
```

## Instruction block for the Grok bot

Paste this into the bot's instructions (put the key in its secret store, not in the text):

```
After you write the ECM DAILY RUNDOWN, also send it to the CRM as JSON.

1. First GET https://ecm-crm.vercel.app/api/rundown/state with header
   Authorization: Bearer <your CRM bot key>. Anything in "finished" is done: don't
   list it again. Anything in "open" is still on Josh's board.
2. Then POST https://ecm-crm.vercel.app/api/rundown with the same header and
   Content-Type: application/json. Body: {"date": "<New York date, YYYY-MM-DD>",
   "period": {"from": ISO, "to": ISO}, "summary": "<the rundown text>", "items": [...],
   "closed_keys": [...]}.
3. One item per thing Josh should see. section: "happened" (what happened: jobs and
   board, texts and calls from Quo, email, quotes/invoices/Mass Save), "money" (money
   and admin flags), "waiting" (waiting on Josh), "next" (next actions), "conflict"
   (conflicts). Title short, like a to-do. Put the rest in detail.
4. key must stay the same every night for the same thing: job:<job id>, lead:<lead id>,
   invoice:<doc number>, quo:<thread id>, email:<message id>, massave:<application #>.
   Never put dates or counts in a key unless the thing itself is one day only.
5. Include job_id, lead_id, customer_id (CRM uuids) when you know them. priority
   "urgent" for today, "important" for this week, else "normal". due as YYYY-MM-DD
   when there is a real date.
6. If a customer is waiting on a text reply, add text_draft {"customer_id": "<uuid>",
   "body": "<the text>"}: short, plain, signed "- Josh, East Coast Mechanical". It is
   NOT sent; Josh approves it on his board.
7. When you know something is finished, put its key in closed_keys.
8. If the reply is 400, fix the fields listed in "details" and post again. Posting
   twice is safe.
```
