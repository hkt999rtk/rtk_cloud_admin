# My Clouds and Developer Docs navigation

Ordinary same-origin links between My Clouds, Developer Docs, and document chapters
now use the existing lightweight Console entry. History, query strings, titles,
modified clicks and new-tab behavior are preserved. SDK navigation is unchanged.
Test Lab, Firmware Burner, billing and other managed Cloud editors retain native
navigation rather than expanding this bridge into a general router.

Developer Docs uses `GET /api/developer/console/context`, an alias of the existing
SDK context implementation, preserving its session validation, one token refresh,
explicit Cloud authorization, no-store response and 5-second total deadline.
Docs does not request the unused quota/list endpoint: its Cloud switcher uses
fresh account memberships and the independently authorized selected Cloud.
No account or token cache is introduced.
The document catalog is requested only after successful authorization; SDK and
ChipSet catalogs are not fetched on the Docs route. Document search remains local.

My Clouds uses `/api/developer/console/clouds-context` to combine account
validation and the existing upstream paginated/filtered list in one browser
request. It then displays the list without waiting for the optional sidebar
Cloud request. A denied sidebar
Cloud is never used as authorized context. Obsolete requests are aborted on
navigation, filtering and refresh; expired sessions clear displayed Cloud data.

Tests: `console-navigation.spec.mjs`, existing `developer-docs.spec.mjs` and
`sdk-loading.spec.mjs`, navigation unit tests, and `TestConsoleContextAlias`.
`console-navigation-performance.spec.mjs` is an opt-in, dev-only, read-only
benchmark using a normal authorized account sign-in. It times 10 navigations in
each direction within the browser and records document reloads; it does not
infer latency from automation tool round trips.
