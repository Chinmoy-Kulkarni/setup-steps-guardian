# Security policy

## Reporting a vulnerability

Before public launch, enable GitHub private vulnerability reporting for this repository. Do not
post suspected vulnerabilities, credentials, repository content, or customer data in public
issues.

The owner must add a monitored security contact before accepting external installations.

## Security boundaries

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

See `docs/architecture.md` for the implementation boundaries.
