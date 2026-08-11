# Public Copilot setup workflow study

Generated: 2026-08-11T06:44:31.508Z

## Census

- GitHub code-search query: `filename:copilot-setup-steps.yml path:.github/workflows`
- Public exact-path workflows directly observed: **873**
- Search-result pages inspected: **10**
- Search marked incomplete: **no**
- Non-exact suffix paths discarded while selecting the sample: **10**

## Convenience sample

- Requested: 100
- Attempted: 100
- Validated: 100
- Fetch or execution failures: 0
- Valid under the default SetupStepsGuardian policy: 95 (95.0%)
- Invalid under the default policy: 5 (5.0%)
- At least one warning: 91 (91.0%)

| Finding | Default severity | Workflows | Share of validated sample |
| --- | --- | ---: | ---: |
| `ACTION_REF_MUTABLE` | warning | 86 | 86.0% |
| `LOCKFILE_MISSING` | warning | 15 | 15.0% |
| `INSTALL_COMMAND_MISMATCH` | warning | 13 | 13.0% |
| `UNSUPPORTED_JOB_KEY` | warning | 10 | 10.0% |
| `SECRET_REFERENCE` | warning | 8 | 8.0% |
| `NODE_SETUP_MISSING` | warning | 4 | 4.0% |
| `PYTHON_SETUP_MISSING` | warning | 4 | 4.0% |
| `SETUP_JOB_MISSING` | error | 4 | 4.0% |
| `TIMEOUT_INVALID` | error | 1 | 1.0% |

## Method and limits

- The GitHub query can also match suffix variants such as `.yml.example` or `.yml.disabled`, so
  they are excluded from both the observed count and sample.
- Only results explicitly marked public by GitHub are eligible. The observed count is a lower
  bound from the inspected pages, not GitHub's total count for the authenticated query.
- The sample keeps only the exact `.github/workflows/copilot-setup-steps.yml` path from the first unique public results
  after excluding this repository. It is a convenience sample, not a random or statistically
  representative sample.
- GitHub code search may omit unindexed, deleted, or otherwise unavailable public repositories.
- Each workflow was fetched at the immutable commit SHA returned by GitHub search.
- Root package-manager filenames were detected at that same commit. Third-party workflow source
  is not included in this report.
- Validation used the repository's committed Node 24 Action bundle with its default policy.
- A finding count is evidence that the rule triggered, not proof that every maintainer would choose
  the same policy. Human review is required before treating aggregate findings as confirmed defects.
