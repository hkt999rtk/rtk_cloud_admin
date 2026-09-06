# SDK page loading

`GET /api/developer/chipset-sdk/context?cloudId=<UUID>` is a private,
customer-view initialization endpoint (`Cache-Control: no-store`). It returns
`me`, `brand_cloud` (nullable), `brand_clouds`, and `cloud_list_status`
(`available` or `unavailable`). Existing account and catalog endpoints remain
compatible.

The endpoint resolves the account profile and refreshes tokens once if needed,
then queries the explicitly authorized selected cloud and optional cloud list
concurrently with that token. It never changes the session's active cloud. The
overall deadline is five seconds; the optional list has a one-second deadline.
List service failures degrade only the list; authorization failures fail closed.
No tokens or arbitrary upstream bodies are returned.

SDKPage calls context first, then loads the SDK and ChipSet catalogs independently.
Board routes fetch only chipsets; Firmware Burner fetches no catalog. Each section
has its own error/retry state. AbortController cancels obsolete requests; no
account data is stored in a persistent browser cache. An account service outage
blocks initialization, whereas catalog outages preserve the verified context.

The entry component observes history changes and intercepts ordinary same-origin
Console links to/from SDK and Board pages. Modified clicks and new tabs remain
native. Test Lab, Firmware Burner, Billing and Handoff transitions retain full
document navigation; existing hardware and session teardown is not bypassed.

## Tests

```sh
GOWORK=off go test ./...
GOWORK=off go test -race ./internal/app -run TestSDKContext -count=1
cd web
npm test
npm run build
npx playwright test e2e/sdk-loading.spec.mjs e2e/chipset-sdk.spec.mjs e2e/boards.spec.mjs --project=chromium
SDK_BENCHMARK=after npx playwright test e2e/sdk-performance.spec.mjs --project=chromium
```

The benchmark uses browser `performance` timestamps and waits for actual catalog
cards, not skeletons. The normal local CI suite runs this benchmark with 200 ms
injected per browser API request. `SDK_BENCHMARK` optionally labels the report. Live mode
requires an explicitly authorized test identity, targets dev only, disables
injected delays, and must be run with tracing off to avoid retaining login request
payloads. Benchmark output contains timings, not credentials. Compare 10 refresh
and 10 navigation samples per version; first-document timing is reported separately
and is not a statistically reliable cold-load result by itself.
