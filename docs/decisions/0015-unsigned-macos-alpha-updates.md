# 0015: Unsigned macOS alpha updates

**Status:** Accepted for unsigned alpha builds

## Context

The alpha release workflow deliberately produces unsigned/ad-hoc macOS bundles. Their
code signatures cannot provide a stable publisher identity for Squirrel.Mac updates.
Unsigned alpha support was explicitly requested for the macOS follow-up to PR #44.

## Decision

Only unsigned/ad-hoc installed `-alpha.N` versions select a separate installer. It uses
existing main-process feed configuration, architecture-specific ZIPs, and electron-updater's
SHA-512 checks. The cached archive is checked again before staging; bundle identity and
version must match. It accepts only alpha targets. Signed installations retain Squirrel.Mac.

The user must explicitly request installation. Staging and helper startup precede normal
shutdown; replacement waits for a final-quit commit and process exit. The old bundle remains
available for rollback until macOS accepts the launch request. No elevated privileges,
Gatekeeper changes, or profile replacement are performed.

## Consequences

Trust rests on the configured HTTPS release origin and its metadata, without publisher
signature authentication. A compromised release origin can distribute executable code.
This is restricted to the deliberately unsigned alpha distribution. Read-only installations
cannot update in place. Existing clients require a manual installation of the first fixed
build. Successful launch submission is not a post-launch application health check.

## Alternatives considered

Requiring Developer ID signing would leave the current unsigned alpha distribution without
in-app updates. Disabling native signature checks globally would also weaken signed releases.
The fallback therefore has a separate, narrowly selected implementation.
