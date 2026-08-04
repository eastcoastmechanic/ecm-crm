# Connecting ECM Platform to Microsoft Copilot Studio

Source of truth: this ECM Platform app (Supabase Postgres + Next.js on Vercel). SharePoint is not used.

## 1. Existing API endpoints usable by Copilot Studio

None, as-is. `app/api/` currently has only three narrow, single-purpose routes:

| Route | Method | Purpose |
|---|---|---|
| `/api/stripe/webhook` | POST | Stripe payment confirmation (Stripe → app, not a general API) |
| `/api/sms/webhook` | POST | Inbound SMS from the SMS gateway (device → app) |
| `/api/cron/email-reminders` | GET | Daily Vercel Cron job |

All real CRM operations (customers, documents/estimates, jobs, diagnostics, leads, inventory, price book — see `app/(internal)/**/actions.ts`) are implemented as Next.js Server Actions, which are **not reachable over HTTP** — they only exist as function closures called from React forms in the same request. There is nothing at a URL for Copilot Studio to call today.

## 2. Existing authentication methods

| Mechanism | Where | Notes |
|---|---|---|
| Supabase Auth (magic link/OTP, cookie session) | Customer portal (`app/portal/**`) only | Not applicable to a machine-to-machine Copilot integration |
| Stripe signature verification | `/api/stripe/webhook` | SDK-verified, Stripe-specific |
| Custom HMAC-SHA256 (`x-signature` header) | `/api/sms/webhook` | Bespoke webhook secret pattern |
| Bearer token exact-match | `/api/cron/email-reminders` | `Authorization: Bearer ${CRON_SECRET}` — **this is the reusable template** for a Copilot Studio API key |
| **None** | All internal app pages/Server Actions (`app/(internal)/**`) | Runs on the Supabase anon key with permissive `for all to anon using (true)` RLS policies — i.e. no real access control today |

There is no service-role Supabase key anywhere in the codebase — every query, internal or webhook, goes through the anon key.

## 3. Existing Supabase tables

16 tables (see `db/schema.sql`, `db/migrations/0001`–`0010`): `companies`, `customers`, `properties`, `equipment`, `service_contracts`, `price_book_items`, `documents`, `diagnostics`, `jobs`, `equipment_costs` (internal-only, never expose), `sms_messages`, `tasks`, `leads`, `inventory_items`, `survey_responses`, `sms_optins`. Full column list is in the investigation notes; `documents` (estimates/invoices/proposals) and `customers` are the two Copilot Studio is most likely to need.

## 4. Existing OpenAPI/Swagger spec

None existed before this change. `docs/openapi.yaml` (added alongside this file) documents the 3 existing routes plus the one proposed new route.

## 5. Can `app/api/chat` or `app/api/dispatch` serve as a Copilot endpoint?

Neither exists. There is no `/api/chat` and no `/api/dispatch` anywhere in the repo. The closest analog — a natural-language "CRM Assistant" — is `runAssistantCommand` in `app/(internal)/assistant-actions.ts`, but it's a Server Action, not an HTTP route, so it can't be called by Copilot Studio without a new wrapper.

## 6. Simplest way to expose ECM Platform to Copilot Studio

Add **one** new route, `POST /api/copilot/assistant`, that is a thin HTTP wrapper around the existing `runAssistantCommand` logic — no new business logic, just transport + auth:

```ts
// app/api/copilot/assistant/route.ts (proposed)
import { NextResponse } from "next/server";
import { runAssistantCommand } from "@/app/(internal)/assistant-actions";

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.COPILOT_API_KEY}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { command } = await request.json();
  if (!command || typeof command !== "string") {
    return NextResponse.json({ error: "Missing command" }, { status: 400 });
  }
  const result = await runAssistantCommand(command);
  return NextResponse.json(result);
}
```

This is the minimum-surface option because it reuses Claude-based intent classification (`create_customer` / `create_document` / `create_task`) that already exists — Copilot Studio just forwards the user's natural-language request as `command` and relays back `reply`. It currently only supports those three write actions and has no read/lookup capability; adding read endpoints (e.g. "look up a customer's job history") would be a second phase if needed.

`runAssistantCommand` currently lives under `app/(internal)/` and calls `revalidatePath()`, which assumes a page-render context — pulling it into a plain route handler may need `revalidatePath` calls removed or the function relocated to `lib/`. Flag this when implementing.

## Generated artifacts

- **OpenAPI 3.0 spec**: `docs/openapi.yaml`
- **REST endpoint URL for Copilot Studio**: `https://ecm-crm.vercel.app/api/copilot/assistant` (POST) — production Vercel domain confirmed via the linked project (`ecm-crm`, team `team_kIXFaU5sO6kyiODo37o5wyRf`); route does not exist yet, see below.
- **Authentication configuration**:
  - New env var `COPILOT_API_KEY` (generate a random secret, set in Vercel project env vars, production + any preview envs Copilot Studio should reach).
  - Copilot Studio custom connector: Authentication type **API Key**, parameter location **Header**, header name `Authorization`, value `Bearer <COPILOT_API_KEY>`.
- **Minimum steps to connect**:
  1. Implement `app/api/copilot/assistant/route.ts` as above (relocate/adjust `runAssistantCommand` if `revalidatePath` breaks outside a render context).
  2. Set `COPILOT_API_KEY` in Vercel env vars; redeploy.
  3. In Copilot Studio: create a custom connector (or "REST API" action) from `docs/openapi.yaml`, pointing at `https://ecm-crm.vercel.app`.
  4. Configure the connector's auth as API Key / Bearer using `COPILOT_API_KEY`.
  5. Add an agent action/topic that calls `POST /api/copilot/assistant` with `{ "command": "<user utterance>" }` and surfaces `reply` back to the user.
  6. Test with a low-risk command first (e.g. "add a task to call the supplier") before enabling write actions like `create_document` in production.
