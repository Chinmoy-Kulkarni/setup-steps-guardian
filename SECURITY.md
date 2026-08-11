# Security policy

## Supported versions

Security fixes are applied to the latest release and the default branch.

## Reporting a vulnerability

Use
[GitHub private vulnerability reporting](https://github.com/Chinmoy-Kulkarni/setup-steps-guardian/security/advisories/new).
Do not post suspected vulnerabilities, credentials, repository content, or private data in public
issues. Reports are handled on a best-effort basis; the project does not promise an SLA.

## Security boundaries

- The public Action reads repository files available in its job workspace and does not send
  validation data to SetupStepsGuardian.
- Public research scripts use authenticated GitHub APIs, publish provenance, and do not commit
  third-party workflow source.
- The initial GitHub App is read-only: Metadata read, Contents read, and Actions read.
- Installation is limited to repositories selected by the GitHub account owner.
- Dashboard reads and manual scans are further limited to repositories visible to the signed-in
  GitHub user within that installation.
- Checkout and retained-data deletion require the installer-admin identity recorded from GitHub's
  signed installation-created webhook.
- The hosted service never executes repository code.
- GitHub App installation tokens never enter customer Actions runners.
- Webhooks are verified against their raw bodies and processed idempotently.
- Paid entitlements require an authenticated account/plan/price HMAC using a dedicated binding
  secret and the matching provider-owned Paddle subscription price.
- Raw source, workflow YAML, logs, artifacts, access tokens, secrets, and payment data are not
  retained.

The hosted backend is not available for external installation. See
[`docs/architecture.md`](docs/architecture.md) for its implementation boundaries.
