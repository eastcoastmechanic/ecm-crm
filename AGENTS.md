<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ECM CRM: rules for every coding agent (Grok Build, Claude Code, others)

`CLAUDE.md` is the full rulebook and status page for this repo. Read it before planning. It applies to you even if you are not Claude. Trust the code over any doc, and check the code before you plan.

The short version:

- Work on a feature branch off `main`. Never commit to `main`. One change per PR. Josh tests the Vercel preview and says "merge N". Do not merge yourself.
- Before asking Josh to test: `tsc`, lint, build and tests pass, CI is green.
- Never run production migrations. A change that needs a column ships as a numbered SQL file in `db/migrations/` for Josh to run.
- Never print secrets, `.env` contents or service-role keys. Never put customer names, phones or addresses in commits, PRs or logs.
- No invented customer data, prices or job details. If a value is unknown, add a field and let Josh fill it in.
- Techs never see prices. Money is hidden on the server, not just styled away.
- Money, send and delete server actions call `requireRole()` inside the action.
- Server actions return `{ error }` for expected problems. Do not throw.
- Customer texts only go out through `canText` and only to customers with `sms_consent`.
- Times use America/New_York (`lib/tz.ts`), not UTC.
- Job status changes go through `updateJobStatus` / job-lifecycle, so notifications and syncs keep firing.
- Before you start, run `gh pr list` and look at recent commits. Another agent may already be working on the same thing.
