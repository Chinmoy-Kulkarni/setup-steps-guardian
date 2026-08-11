# Privacy

SetupStepsGuardian is designed for data minimization.

## Public GitHub Action

The Action runs in the repository's GitHub Actions job. It reads the configured workflow, optional
policy, and supported root manifest or lockfile names from that workspace. It does not send
workflow content, findings, hashes, or run telemetry to SetupStepsGuardian.

GitHub retains Actions data according to the repository owner's GitHub settings and GitHub's terms.

## Public research

The study scripts use authenticated GitHub APIs. Published study records contain public repository
names, immutable commit SHAs, public source URLs, root metadata filenames, hashes, and normalized
findings. Third-party workflow source is not committed. Raw inputs may be preserved only when a
researcher explicitly uses `--preserve-raw` under an ignored local path.

## Hosted implementation

The repository contains a read-only GitHub App and billing implementation, but no hosted service is
available for external installation. If that changes, the project must publish active controller,
contact, retention, deletion, and payment-provider terms before accepting external data.
