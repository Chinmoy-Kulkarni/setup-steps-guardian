# SetupStepsGuardian

SetupStepsGuardian is a deterministic validator and read-only fleet assurance service for
`.github/workflows/copilot-setup-steps.yml`.

The working name and `setup-steps-guardian` slug had no exact conflicts in GitHub Marketplace,
npm, PyPI, or general web searches when development began. This is not legal trademark
clearance.

## What it checks

- The required `copilot-setup-steps` job exists.
- The setup job uses documented keys, an approved runner, a bounded timeout, and explicit
  read-only permissions.
- Node.js and Python dependency installation matches committed root lockfiles.
- Action references, secret usage, and manual validation triggers follow the selected policy.
- Findings use stable codes and deterministic remediation. No LLM is involved.

SetupStepsGuardian validates the setup workflow. It does not claim that every coding-agent task
will succeed, and it does not replace code quality, security, or dependency scanning.

## Use the Action

```yaml
name: Validate Copilot setup

on:
  pull_request:
    paths:
      - ".github/workflows/copilot-setup-steps.yml"
      - ".github/agent-setup-policy.yml"
      - "package.json"
      - "pnpm-lock.yaml"

permissions:
  contents: read

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803
      - uses: Chinmoy-Kulkarni/setup-steps-guardian@0de8f30000634b8930a2eae1a1e7b8ae20b602dc
```

This is the reviewed commit behind `v1.0.0`. Keep the full SHA pin when enabling
SetupStepsGuardian in a production repository.

### Inputs

| Input | Default | Purpose |
| --- | --- | --- |
| `workflow-path` | `.github/workflows/copilot-setup-steps.yml` | Setup workflow to validate |
| `policy-path` | `.github/agent-setup-policy.yml` | Optional strict policy |
| `fail-on-warnings` | `false` | Treat warning findings as a failed Action |

### Outputs

`status`, `error-count`, `warning-count`, `workflow-hash`, `policy-hash`, and `result-json`
support downstream automation without parsing logs.

## Policy

```yaml
schemaVersion: 1
allowedRunners:
  - ubuntu-latest
maxTimeoutMinutes: 30
requireTimeout: true
requireExplicitPermissions: true
requireWorkflowDispatch: true
actionPinning: warning
secretUsage: warning
unsupportedJobKeys: warning
```

See [the finding reference](docs/findings.md) for stable codes and remediation.
Release history is documented in [CHANGELOG.md](CHANGELOG.md).

## Development

```bash
pnpm install
pnpm check
pnpm build
```

The project is a TypeScript workspace containing a shared deterministic policy engine, a
GitHub Action, a Cloudflare Worker API, and a React dashboard.

## Privacy model

The hosted service is designed to retain account, installation, repository, and installer-admin
numeric IDs plus hashes, normalized findings, workflow run metadata, and billing entitlement state
only. It must not retain raw source, workflow YAML, job logs, artifacts, GitHub access tokens,
webhook payloads, secrets, or payment-card data.

See [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), and [SUPPORT.md](SUPPORT.md).
