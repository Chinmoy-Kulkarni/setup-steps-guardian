# Privacy

SetupStepsGuardian is designed for data minimization.

## Intended retained data

- GitHub account, installation, and repository IDs
- The installing GitHub user's numeric ID for billing and deletion authorization
- Repository owner/name and default branch
- Hashes of the setup workflow, policy, and relevant lockfiles
- Normalized finding codes and severities
- Workflow run ID, commit SHA, runner label, conclusion, duration, and timestamps
- Subscription entitlement state and provider identifiers
- Idempotency and security audit metadata

## Data the service must not retain

- Raw source code or repository archives
- Raw setup workflow or policy content
- Workflow logs or artifacts
- GitHub user or installation access tokens
- Webhook payload bodies or signatures
- Repository secrets
- Payment-card or bank details

Payment details are handled by the merchant-of-record provider. Repository file content is
fetched only when needed for deterministic evaluation, normalized in memory, and discarded
after hashes and findings are produced.

Uninstall and account-deletion flows remove retained tenant data. Final public retention terms,
controller identity, and contact details require owner approval before launch.
