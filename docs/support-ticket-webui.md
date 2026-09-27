# Support Ticket WebUI Target

Status: draft target; no support-ticket screen is implemented.

Owner: rtk_cloud_admin.

Last reviewed: 2026-09-27.

The canonical routes, authorization and response contract are in
[`support_tickets.md`](../../rtk_cloud_contracts_doc/support_tickets.md).
This document describes only the Admin presentation and interaction design.

## Navigation and visual structure

Add `Support` to the selected Brand Cloud's Management group, with canonical
route `/console/clouds/{cloudId}/support`. It is available whenever the
membership has `ticket.read`; Viewer sees the same ticket list and conversation
without write controls. It is disabled with other Cloud-scoped items when no
Cloud is selected. Add `Support` to the Platform shell for support-read users at
`/admin/support`. A platform user without a Cloud membership never enters a
customer route as an agent shortcut.

Reuse the existing Admin shell, table density, colors, typography, focus states
and responsive drawer. Do not embed the Zammad UI or expose its URL. The list
page has a compact title, new-ticket action when allowed, search, state chips,
and rows with ticket number, subject, category, state, assignee, last activity
and unread marker. Empty, loading, permission and dependency-unavailable
states use the existing UI patterns. Search and state filters persist in the
page URL; Cloud switch clears ticket-specific selection and request caches.

Ticket detail is a full page, not a narrow drawer. It has a concise metadata
header, ordered conversation, attachment links and a reply composer. Customer
messages and support replies are visually distinct through labels and layout,
not color alone. Customer UI shows only public articles. Read-only Viewer gets
an explanation that replies require an editing membership. Public replies on
closed tickets show that the case will reopen.

The Platform queue offers `Unassigned`, `Mine` and `Team` tabs. Every support
agent with read access can inspect Team tickets. An unassigned ticket can be
claimed by an eligible operator; only a platform admin can reassign it to
another agent. The detail composer requires an explicit `Public reply` or
`Internal note` choice and displays a persistent visibility label before
submission. Internal notes carry a distinct staff-only badge and never appear
in customer output. Agents can close/reopen from the detail header.

## Notifications and interaction

V1 uses in-app unread markers and a Support navigation badge, with polling
only while a support view is open. Opening a ticket advances that actor's read
marker. Badge and row counts are hints, not an authorization source. No ticket
email or push delivery is assumed. The browser uses only same-origin Admin BFF
routes; existing login and `next` handling support customer and Platform
ticket deep links after server authorization.

Create and reply forms require text, show upload progress and enforce the
contract's attachment limits before submit. Buttons prevent accidental repeat
submission while pending; a timeout keeps the draft and offers a refresh of
the ticket before retry. Server-returned validation errors appear beside the
relevant field. The UI does not display raw Zammad errors or tokens.

## Acceptance views

- Desktop and mobile customer list, new-ticket and conversation for owner,
  member and Viewer.
- Desktop and mobile agent queue and detail for unassigned, self-assigned and
  teammate-owned tickets, including the public/internal distinction.
- Loading, empty, forbidden, unavailable and invalid-upload states.
- Deep-link refresh, Cloud switch and multi-tab navigation without leaking
  another Cloud's ticket data.
