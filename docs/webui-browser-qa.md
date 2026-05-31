# WebUI Browser QA Smoke

The Admin WebUI browser smoke test validates the redesigned console without
requiring a live backend. It starts a local Vite SPA server, uses Playwright to
mock customer-safe BFF responses, checks app console health, and captures
screenshots for reviewer inspection.

## Command

```sh
cd web
npm run browser:smoke
```

Expected output:

```text
Browser smoke passed. Screenshots: .../.artifacts/browser-smoke
```

Screenshots are written under `.artifacts/browser-smoke/` and are intentionally
gitignored.

## Coverage

- Desktop 1440px:
  - Public auth routes: signup, check-email, and verify
  - Customer Overview
  - Devices with detail drawer open
  - Firmware & OTA campaign drill-down
  - Stream Health worst-device drill-down into Devices
  - Platform Operations Log
  - Platform SSO Providers
  - Platform Audit Log
- Mobile 390px:
  - Customer sidebar/nav remains visible
  - Devices uses compact rows instead of rendering the full table
  - Public signup remains usable on a narrow viewport

The smoke test fails on app-level `console.error`, `console.warn`, or uncaught
page errors.

## Data Boundary

The script uses deterministic mocked API responses for WebUI behavior only. It
does not validate production upstream telemetry, firmware, stream, or account
manager integrations. Those remain covered by backend contract tests and live
environment validation.

## Final Signoff Notes

- Admin repo WebUI milestone coverage is complete for the documented scope:
  Customer View four pages, public auth/signup/verification/quota states,
  Platform View four pages, route guards, source-aware states, and read-only
  customer workflows.
- Remaining blockers are upstream production sources, not admin repo WebUI
  completion: authoritative telemetry, firmware rollout facts, and WebRTC
  session facts still require live-source validation outside this mocked smoke
  test.
- Browser smoke screenshots are repeatable review artifacts and should be
  regenerated from the command above whenever WebUI layout or route behavior
  changes.

## CI Use

The command is safe to run in CI after `npm ci`. If the runner does not already
have a Playwright browser installed, install Chromium first:

```sh
cd web
npx playwright install chromium
npm run browser:smoke
```
