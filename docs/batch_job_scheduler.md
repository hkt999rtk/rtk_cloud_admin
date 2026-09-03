# Durable Batch Job Scheduler

Status: implementation design constrained by
`rtk_cloud_contracts_doc/batch_jobs.md`.

Cloud Admin owns orchestration and customer-safe result presentation. Account
Manager remains authoritative for authorization, registry devices, lifecycle
operations, and provisioning result projection.

Jobs and items live on the existing single-replica SQLite PVC. A scheduler, not
an HTTP request goroutine, claims work through state-version compare-and-swap and
a renewable lease. The default dev worker count is one. Startup reclaims expired
leases, preserves paused jobs, and reconciles an interrupted item with its stable
upstream operation ID before dispatching more work.

Pause and cancel are cooperative item-boundary requests. `pausing` becomes
`paused` after the current item; `cancelling` becomes `cancelled` and undispatched
items become `skipped/USER_CANCELLED`. Resume returns a paused job to `queued` and
requires a fresh restricted-token exchange. Completed mutations are never rolled
back. Authorization loss stops dispatch with `AUTHORIZATION_REVOKED`.

Provisioning validation persists one result per CSV row. Permanent input or
ownership failures are not retryable; timeout, 429, and bounded 5xx failures are.
A retry job copies prior successes and dispatches only retryable failures. Device
execution uses `job_id + item_id + operation` as the stable Account Manager
operation identity. Batch completion means Account Manager accepted or replayed
the matching lifecycle operation, not that final Video Cloud readiness is online.

The UI consumes server-provided `allowed_actions`, paginated item results, and
safe failure codes. Partial, failed, cancelled, paused, and completed jobs retain
downloadable evidence until the result expiry.

