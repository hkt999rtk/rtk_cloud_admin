# RTK Cloud Admin SSO / OIDC Design

Status: proposed source of truth.

Audience:

- `rtk_cloud_admin` frontend and backend developers
- `rtk_account_manager` backend developers
- PM / QA

## Summary

RTK Cloud Admin should use standards-based single sign-on for daily
authentication. The first SSO version covers both Customer users and Platform
Admins, uses OIDC Authorization Code with PKCE, and treats SAML as a deferred
enterprise bridge.

Account Manager is the identity broker and authorization source. Admin Console
does not connect directly to external identity providers and does not trust raw
IdP claims for product roles. Admin Console consumes Account Manager SSO
results, creates the existing local `rtk_admin_session` cookie, and continues to
serve the React BFF APIs from that session.

## Goals

- Customer users and Platform Admins use SSO for daily login.
- OIDC Authorization Code with PKCE is the first supported protocol.
- Account Manager owns identity provider discovery, OIDC token exchange,
  external claim normalization, platform role authorization, customer
  memberships, and organization context.
- Admin Console owns the BFF-facing SSO contract, local session creation,
  WebUI login entry, Platform Admin SSO settings surface, and regression tests.
- Each customer organization can bring its own OIDC provider.
- Login uses email domain discovery to find the right organization provider.
- Platform Admin permissions are granted by Account Manager, not by directly
  trusting external IdP groups or claims in Admin Console.
- Daily login is SSO only.
- Local Platform Admin break-glass access is preserved but disabled by default.

## Non-Goals

- Do not implement OIDC provider configuration, authorization redirects, token
  exchange, or SAML handling directly in Admin Console.
- Do not make Admin Console authoritative for users, external identities,
  organization memberships, or platform role assignment.
- Do not store external IdP client secrets in the Admin Console SQLite
  database.
- Do not implement Customer self-service IdP setup in the first version.
- Do not implement SAML 2.0 in the first version.

## Ownership Boundaries

Account Manager owns:

- email domain discovery
- organization-level OIDC provider configuration
- OIDC Authorization Code with PKCE flow
- external identity to RTK user mapping
- organization memberships, roles, tiers, and quota metadata
- Platform Admin authorization
- refresh token lifecycle for upstream API access
- optional future SAML bridge or external identity broker integration

Admin Console owns:

- an email-first SSO login UI
- BFF endpoints that start and complete the Account Manager SSO flow
- the local `rtk_admin_session` cookie and session row
- `/api/me` projection for frontend routing and authorization display
- Platform Admin UI/API surfaces for viewing and managing customer SSO settings
- audit records for local session and break-glass events
- regression tests for the BFF contract and UI behavior

## Login Flow

1. The user opens Admin Console and enters an email address.
2. Admin Console calls Account Manager to start SSO discovery.
3. Account Manager maps the verified email domain to an organization OIDC
   provider and returns an authorization redirect.
4. The browser completes OIDC login through Account Manager.
5. Account Manager validates the callback, maps the external identity, resolves
   roles and memberships, and returns an Admin Console session result.
6. Admin Console creates the existing `rtk_admin_session` cookie and stores
   local session metadata plus upstream access and refresh tokens.
7. The frontend calls `/api/me` and renders either Customer View or Platform
   View based on the Account Manager-authorized `kind`.

The session kind remains either `customer` or `platform_admin`. Customer
sessions continue to use `memberships` and `active_org_id`. Platform Admin
sessions continue to gate platform-only routes through the existing
`platform_admin` session kind.

## Protocol Strategy

First version:

- OIDC Authorization Code with PKCE.
- Multi-tenant bring-your-own IdP at the customer organization level.
- Email domain discovery as the primary routing mechanism.
- Platform Admin-managed customer SSO settings.

Deferred:

- SAML 2.0 support.
- Customer self-service IdP setup.
- Tenant impersonation.
- Direct trust of external IdP group claims in Admin Console.

SAML should be handled by Account Manager or an external identity broker that
normalizes SAML into the Account Manager identity model before Admin Console
sees the login result.

## Admin Console API Contract

Admin Console should add BFF endpoints for the frontend, backed by Account
Manager APIs:

- `POST /api/auth/sso/start`: accepts an email address, asks Account Manager to
  start SSO discovery, and returns the authorization redirect details.
- `GET /api/auth/sso/callback`: accepts Account Manager callback parameters,
  exchanges them with Account Manager, creates `rtk_admin_session`, and
  redirects the browser back to the console.
- `GET /api/auth/sso/providers/status`: lets Platform Admins inspect customer
  organization SSO status.

Platform Admin provider management endpoints may be added in Admin Console, but
secrets must be written through Account Manager and must not be stored in the
Admin Console SQLite database.

The existing `/api/me` shape remains stable:

- `user_id`
- `email`
- `name`
- `kind`
- `memberships`
- `active_org_id`
- `demo_mode`
- `authenticated`

## Legacy Login And Break-Glass

Daily customer and platform login should move to SSO only. Existing password
login endpoints are legacy compatibility surfaces and should be disabled by
default once the SSO flow is implemented.

Local Platform Admin break-glass access remains available for operational
recovery, but it must be explicitly enabled by deployment configuration. When
disabled, local platform password login is rejected. When enabled, successful
and failed break-glass login attempts must be written to audit.

Customer password login should not be used as the long-term production login
path. Account Manager remains responsible for any migration period or emergency
customer-account recovery policy.

## Implementation Issues After This Document

After this document is merged, implementation should be split into developer
issues:

1. Add Account Manager SSO client contract to Admin Console.
2. Add Console BFF SSO start and callback endpoints.
3. Enforce SSO-only login with controlled break-glass admin access.
4. Implement email-first SSO login UI.
5. Add Platform Admin SSO provider settings view.
6. Add SSO rollout, audit, and regression coverage.
