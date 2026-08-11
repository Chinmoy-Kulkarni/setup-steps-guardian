# Contributing

SetupStepsGuardian welcomes bug reports, false-positive reports, documentation fixes, tests, and
focused pull requests.

## Before opening an issue

- Use the [bug template](https://github.com/Chinmoy-Kulkarni/setup-steps-guardian/issues/new?template=bug.yml)
  for reproducible defects.
- Use the [feature template](https://github.com/Chinmoy-Kulkarni/setup-steps-guardian/issues/new?template=feature.yml)
  for a concrete workflow-validation need.
- Use [Discussion #5](https://github.com/Chinmoy-Kulkarni/setup-steps-guardian/discussions/5)
  to report whether a finding was correct and useful.
- Report security issues through
  [private vulnerability reporting](https://github.com/Chinmoy-Kulkarni/setup-steps-guardian/security/advisories/new).

Do not post private source, workflow logs, tokens, secrets, webhook payloads, or payment details.
A minimal public fixture is the best reproduction.

## Development

Requirements:

- Node.js 24 or later
- pnpm 11.21.0

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

The committed Action bundle at `packages/action/dist/index.cjs` must be rebuilt whenever Action or
policy-engine behavior changes.

## Pull requests

- Keep changes narrowly scoped and add deterministic tests for behavior changes.
- Preserve stable finding codes unless a breaking release explicitly removes one.
- Base compatibility rules on current GitHub documentation and link the source in the pull request.
- Treat inferred dependency and security hardening as warnings unless GitHub documents a structural
  requirement.
- Do not commit third-party workflow source collected during research. Aggregated findings,
  immutable source URLs, commit SHAs, and provenance are acceptable.
- Update `docs/findings.md`, `CHANGELOG.md`, and generated Action output when applicable.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
