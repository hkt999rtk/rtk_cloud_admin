# Cloud Admin End-to-End Tests

Cloud Admin browser E2E uses Playwright Test. The local harness starts the
actual Go Admin BFF and connects it to fixture upstreams; Browser tests do not
mock `/api/admin/*` responses.

## Local

From `web/`:

```sh
npm ci
npm run e2e:install
npm run build
npm run e2e:generate-fixture
npm run e2e:smoke
npm run e2e:chipset-sdk
npm run e2e:chipset-sdk:errors
npm run e2e
npm run e2e:report
npm run e2e:brand-fleet:smoke
npm run e2e:brand-fleet
npm run e2e:brand-fleet:full
npm run e2e:brand-fleet:errors
npm run e2e:brand-fleet:expired
```

The fixture generator reuses `loadtests/home-100k`'s `BrandPlan` validation,
device/user distribution, and `run_id` correlation. Generated data is written
under `.artifacts/e2e-fixtures/cloud-admin-e2e/` and is never production data.

## Scenarios

The default fixture covers Platform Dashboard, Operations, Service Logs,
Brand Clouds, SSO state, user lifecycle, creation flow, and authorization.
Prometheus failure behavior can be run separately:

```sh
E2E_PROMETHEUS_MODE=unavailable \
  npx playwright test e2e/platform-dashboard.spec.mjs --grep unavailable
```

The other deterministic source states and mutation failure path are available
through the same harness:

```sh
E2E_PROMETHEUS_MODE=empty npx playwright test e2e/platform-dashboard.spec.mjs --grep "empty and stale"
E2E_PROMETHEUS_MODE=stale npx playwright test e2e/platform-dashboard.spec.mjs --grep "empty and stale"
E2E_PROMETHEUS_MODE=unconfigured npx playwright test e2e/platform-dashboard.spec.mjs --grep "empty and stale"
E2E_FAIL_ACTION=member-assign npx playwright test e2e/brand-cloud.spec.mjs --grep "partial owner"
E2E_SCENARIO_MODE=unavailable npx playwright test e2e/brand-cloud.spec.mjs --grep "upstream failures"
```

Each local run starts a fresh fixture-backed Go BFF and temporary database, so
mutating tests do not reuse state from an earlier run.

Playwright retains failure screenshots, videos, traces, and the HTML report
under `.artifacts/playwright-results/` and `.artifacts/playwright-report/`.

## Staging

Staging tests use `E2E_BASE_URL`, `E2E_PLATFORM_SESSION_ID`, and
`E2E_CUSTOMER_SESSION_ID`. Read-only tests are the default. Mutation tests
require `E2E_ALLOW_MUTATIONS=true` and a disposable Brand Cloud.

Large load profiles are not run by PR E2E. Use the existing `video-1k` profile
before staging Browser validation when real metrics and operation activity are
required.

## Brandname Developer Fleet

Brandname customer flows use the same real Go BFF harness with customer-role
fixture identities. The suite covers cloud switching, cross-cloud isolation,
Developer / Release, Operations and Observer capabilities, server-side device
pagination, OTA immutable scope preview, batch jobs, reports, provisioning,
team membership and owner transfer.

Local identities are `developer@example.com`, `operations@example.com`,
`observer@example.com`, and `customer@example.com`; their passwords are only
fixture credentials used by Playwright. Run the focused suite with:

```sh
npm run e2e:brand-fleet:smoke
npm run e2e:brand-fleet
```

Staging is read-only and requires `E2E_BRAND_CLOUD_ID` plus
`E2E_CUSTOMER_SESSION_ID`:

```sh
npm run e2e:brand-fleet:staging
```

The local suite never trusts mockup totals or browser-supplied cloud scope; it
asserts the BFF request/response contract and polls real local job state.

The expanded suite separates deterministic failure modes from the normal run:

```sh
E2E_SCENARIO_MODE=partial_failure npx playwright test e2e/brand-fleet-lifecycle.spec.mjs --grep @full
E2E_SCENARIO_MODE=slow npx playwright test e2e/brand-fleet-lifecycle.spec.mjs --grep @full
E2E_SCENARIO_MODE=unavailable npm run e2e:brand-fleet:errors
E2E_RESULT_EXPIRED=true npm run e2e:brand-fleet:expired
```

The fixture exposes an internal `/__e2e__/state` endpoint for request and
mutation diagnostics only; it is not registered by the Go BFF and is never
available through a production customer route. `E2E_RESULT_EXPIRED=true` is a
test-only store switch used to verify the customer-safe `410` expired-result
contract.
