# Service Logging Migration

Status: implementation handoff.

Owner: `rtk_cloud_admin`.

## Goal

Use `rtk_cloud_logger` zap logging for the Cloud Admin BFF/server so operator
workflows can be traced across the dashboard, Account Manager, and Video Cloud.

## Required Changes

- Build the root logger with `rtk_cloud_logger`.
- Emit JSON logs to stdout/stderr only.
- Wrap server routes with zap request logging.
- Preserve or generate `request_id` for browser/API calls.
- Propagate `trace_id`, `request_id`, and `operation_id` to upstream Account
  Manager and Video Cloud requests when those calls are part of a workflow.
- Use structured fields for upstream failures, cache refresh failures,
  service-health checks, and admin operations.
- Keep local SQLite/audit records as durable audit data; do not replace them
  with service logs.

## Acceptance Criteria

- The native `rtk-cloud-admin.service` emits single-line JSON zap logs.
- Request logs include sanitized path, status, duration, remote address, and
  request id.
- Upstream calls can be correlated with Account Manager and Video Cloud logs.
- Secrets such as `VIDEO_CLOUD_ADMIN_TOKEN`, bootstrap password, cookies, and
  bearer tokens never appear in logs.
- `go test ./...` and web tests continue to pass.
