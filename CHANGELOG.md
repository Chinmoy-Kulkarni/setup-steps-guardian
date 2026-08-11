# Changelog

All notable changes to SetupStepsGuardian are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-08-10

### Added

- Added a deterministic Node 24 GitHub Action for validating
  `.github/workflows/copilot-setup-steps.yml`.
- Added stable findings, GitHub annotations, job summaries, machine-readable outputs, and
  deterministic workflow patches.
- Added Node.js and Python manifest and lockfile validation with strict organization policy
  support.
- Added a read-only GitHub App backend, React fleet dashboard, Cloudflare Worker/D1 persistence,
  scan queues, workflow evidence, and account deletion.
- Added Free, Team, and Fleet entitlements with Paddle checkout and subscription lifecycle
  handling.
- Added public privacy, security, support, architecture, deployment, and finding documentation.

### Security

- Scoped fleet, repository-detail, and manual-scan access to repositories visible to the
  authenticated GitHub user.
- Restricted checkout and retained-data deletion to the GitHub App installer administrator.
- Bound Paddle entitlements to provider-owned price IDs and signed account/plan/price metadata.
- Hardened OAuth return paths against control characters, backslashes, repeated encoding,
  scheme-relative URLs, and dot-segment normalization.
- Added raw-body webhook verification, encrypted short-lived sessions, CSRF protection,
  rate limits, secure headers, bounded processing, and data-minimizing retention.

[1.0.0]: https://github.com/Chinmoy-Kulkarni/setup-steps-guardian/releases/tag/v1.0.0
