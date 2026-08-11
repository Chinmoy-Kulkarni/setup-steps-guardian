# Public evidence

Last refreshed: **2026-08-11**

This page separates three questions that are easy to blur together:

1. **Ecosystem need:** Does the setup-workflow problem exist at meaningful scale?
2. **Product adoption:** Are people publicly using SetupStepsGuardian?
3. **Usefulness:** Does the validator produce findings that survive human review?

## Honest conclusion

| Question | Current evidence | Conclusion |
| --- | --- | --- |
| Ecosystem need | The census directly observed 873 unique public exact-path workflows across ten GitHub result pages, official documentation describes a narrow special-job contract, and at least one organization publicly synchronizes these workflows across repositories. | The problem surface is real and large enough to study. This does not prove willingness to adopt this project. |
| Product adoption | 0 stars, 0 forks, 0 subscribers, 0 indexed public direct-workflow references observed among the first 100 search items, and 0 captured external participants at the measurement baseline. | Public adoption is **not yet proven**; the bounded metrics do not prove adoption is zero. |
| Validator usefulness | In a 100-workflow convenience sample, all 5 error-level workflows were manually confirmed to violate the documented contract. Review-only warnings also exposed real hardening opportunities, but some require repository context. | The validator has demonstrated useful detection, but user-confirmed outcomes are **not yet proven**. |

The project will not claim that people are using it until public references or voluntary reports
exist.

## Ecosystem need

The authenticated census directly observed **873 unique public exact-path workflows** across ten
GitHub result pages for:

```text
filename:copilot-setup-steps.yml path:.github/workflows
```

This is a public lower bound, not an exact active-workflow count. Results not explicitly marked
public, suffix files such as `.yml.example`, and this repository were discarded. GitHub's
token-visible total count is intentionally not published because it can include private code
accessible to the token. Search pagination and index visibility can fluctuate between runs, so this
snapshot should not be interpreted as a precise trend measurement.

Primary-source evidence:

- [GitHub's setup-workflow documentation](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment)
  requires the exact path, a single exact job, a limited set of job keys, supported runner
  architectures, and a timeout no greater than 59 minutes. It also explains that dependency
  discovery without deterministic setup can be slow or unreliable.
- [GitHub's July 2025 changelog](https://github.blog/changelog/2025-07-30-copilot-coding-agent-custom-setup-steps-are-more-reliable-and-easier-to-debug/)
  shipped better setup-step visibility and changed failure handling so the agent continues after a
  failed setup step. This is platform evidence that setup reliability and diagnosis needed work.
- [Faithlife's public convention](https://github.com/Faithlife/CodingGuidelines/blob/main/conventions/faithlife-dotnet-library-workflow/README.md)
  installs and overwrites `copilot-setup-steps.yml` across repositories.
  Its [synchronizer](https://github.com/Faithlife/CodingGuidelines/blob/main/conventions/faithlife-dotnet-library-workflow/convention.ps1)
  copies the canonical workflow when a target differs.
- GitHub Community discussions document friction with
  [reusable setup workflows](https://github.com/orgs/community/discussions/170877) and
  [setup environment secrets](https://github.com/orgs/community/discussions/180346). These are
  community reports, not platform-wide statistics.
- Mature workflows such as
  [microsoft/vscode](https://github.com/microsoft/vscode/blob/main/.github/workflows/copilot-setup-steps.yml)
  and
  [microsoft/TypeScript](https://github.com/microsoft/TypeScript/blob/main/.github/workflows/copilot-setup-steps.yml)
  use extensive pinning and project-specific setup, showing that the artifact can become
  operationally significant.

## Reproducible 100-workflow study

The committed study artifacts are:

- [Human-readable summary](evidence/public-workflow-study-2026-08-11/summary.md)
- [Machine-readable records and provenance](evidence/public-workflow-study-2026-08-11/study.json)

Method:

- Select the first 100 unique exact-path results returned by GitHub code search, excluding this
  repository.
- Fetch each workflow at the immutable commit SHA returned by search.
- Detect only root package-manager filenames at that same commit.
- Execute the committed Node 24 Action bundle in an isolated temporary workspace.
- Commit normalized findings, hashes, URLs, and provenance, but not third-party workflow source.

Results:

| Result | Workflows |
| --- | ---: |
| Valid under compatibility-aligned defaults | 95 |
| Invalid | 5 |
| At least one review warning | 91 |
| Fetch or execution failures | 0 |

### Human review of every error

All five error-level results were reviewed against the immutable public source:

| Repository | Confirmed issue |
| --- | --- |
| [ripple/explorer](https://github.com/ripple/explorer/blob/78b4737bdb21c66b6293a8ed044768bd6c8625f5/.github/workflows/copilot-setup-steps.yml) | The job is named `copilot-setup`, not `copilot-setup-steps`. |
| [koplyarov/wigwag](https://github.com/koplyarov/wigwag/blob/d3e828e5bc904a0e24fad1d432c3c2f356922375/.github/workflows/copilot-setup-steps.yml) | The job is named `setup`, not `copilot-setup-steps`. |
| [johnpapa/hello-worlds](https://github.com/johnpapa/hello-worlds/blob/70ce5406169b18ba504392162cb0db49bf28c5d8/.github/workflows/copilot-setup-steps.yml) | The job is named `copilot-setup`, not `copilot-setup-steps`. |
| [johnpapa/heroes-react](https://github.com/johnpapa/heroes-react/blob/ed1b2946139221487306b9e214a44f1c5ba451f5/.github/workflows/copilot-setup-steps.yml) | The job is named `setup`, not `copilot-setup-steps`. |
| [InsightSoftwareConsortium/ITK](https://github.com/InsightSoftwareConsortium/ITK/blob/2f6c5acceda891da57371a2a82542c8f8663ca67/.github/workflows/copilot-setup-steps.yml) | `timeout-minutes` is `0`, which is not a positive integer. |

This demonstrates that the validator can find concrete contract defects. It does not prove that
the affected maintainers saw, accepted, or fixed these findings.

### Interpreting warnings

Warnings are review prompts, not claims that a workflow is broken:

- 86 workflows used at least one mutable external Action reference. Full-SHA pinning is GitHub
  security hardening, not a setup-workflow validity requirement.
- 10 workflows used job keys that current GitHub documentation says are ignored.
- 8 workflows referenced the `secrets` context and deserve repository-specific review.
- 13 workflows had a root lockfile without a recognized install using explicit lockfile protection.
  Human review found three clearly actionable cases and ten context-dependent cases. Four of the
  latter used bare pnpm commands that can rely on CI defaults but do not make lock protection
  explicit.

That review is why inferred dependency findings are warnings by default.

### Correcting the exploratory baseline

An earlier internal run marked 98 of 100 workflows invalid because optional timeout, explicit
permissions, runner allowlists, and dependency hardening were treated as mandatory. That result was
discarded rather than published as defect evidence. Defaults were aligned to current GitHub
documentation, supported runner groups and label arrays were added, dependency inference was
downgraded to review guidance, and the corpus was rerun.

## Product adoption baseline

The committed baseline is:

- [Summary](evidence/public-adoption-metrics-2026-08-11/summary.md)
- [Machine-readable metrics](evidence/public-adoption-metrics-2026-08-11/metrics.json)

As of the baseline, every measured adoption and captured participation value is zero. These are
bounded observations, not proof that no use exists. GitHub traffic is tracked separately as
awareness because views and clones can include maintainer activity.

No hidden Action telemetry is collected. The repeatable measurement command is:

```bash
node scripts/public-adoption-metrics.mjs
```

The script records stars, forks, subscribers, indexed public direct-workflow references observed
among the first 100 search items, external issues, pull requests, Discussion participation, and
owner-visible rolling traffic. A maintainer must still review voluntary reports before counting any
as confirmed usefulness.

The [public evidence workflow](../.github/workflows/public-evidence.yml) also runs both measurements
weekly and on demand, publishes the summaries in GitHub Actions, and uploads normalized artifacts
without modifying the repository. Workflow-study retries honor GitHub rate-limit reset signals, and
adoption measurement runs independently so one API quota cannot suppress the other result.

## Reproduce the workflow study

Use an authenticated GitHub session and keep raw third-party workflows outside the repository:

```bash
GITHUB_TOKEN="$(gh auth token)" \
  node scripts/public-workflow-study.mjs \
  --sample-size 100 \
  --census-pages 10 \
  --output .research/public-workflow-study
```

Add `--preserve-raw` only for local human review. `.research/` is ignored by Git.

## What would change the conclusion

Public adoption becomes evidence when external repositories reference the Action, contributors or
users participate, or maintainers voluntarily report outcomes. Confirmed usefulness requires a
reviewed report showing that a finding was correct, led to a change, or prevented a setup failure.
Until then, the project has evidence of a real problem surface and useful detection, not evidence
of sustained user adoption.
