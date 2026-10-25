## What changed

<!-- One change per PR. Plain words. -->

## How to test on the preview

1.

## Checklist

- [ ] One change only
- [ ] Migration SQL included (file or block for Josh to run), or no DB change
- [ ] Techs never see prices; money fields stay server-side
- [ ] Money, send and delete actions call `requireRole()`
- [ ] Texts only go to customers with `sms_consent`
- [ ] Times use America/New_York
- [ ] CI green (typecheck, lint, tests) and Vercel preview builds
- [ ] Tested on the preview
