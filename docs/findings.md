# Finding reference

Finding codes are stable API identifiers. Severity can be changed only for explicitly
policy-configurable rules.

| Code | Default severity | Meaning | Remediation |
| --- | --- | --- | --- |
| `WORKFLOW_MISSING` | Error | The documented setup workflow path does not exist. | Create the generated workflow and review it before merging. |
| `WORKFLOW_YAML_INVALID` | Error | YAML syntax, duplicate keys, or unsafe aliases prevent parsing. | Correct the YAML and remove duplicate keys or aliases. |
| `WORKFLOW_ROOT_INVALID` | Error | The YAML root is not a mapping. | Replace it with a valid GitHub Actions workflow mapping. |
| `WORKFLOW_DISPATCH_MISSING` | Error | The workflow cannot be manually validated. | Add `workflow_dispatch`. |
| `JOBS_MISSING` | Error | No jobs mapping exists. | Add `jobs` and the required setup job. |
| `SETUP_JOB_MISSING` | Error | The exact `copilot-setup-steps` job is absent. | Rename or add the required job. |
| `ADDITIONAL_JOB` | Error | The special setup workflow contains another job even though GitHub documents a single-job contract. | Move the required steps into `copilot-setup-steps` and remove the other job. |
| `UNSUPPORTED_JOB_KEY` | Warning | The special job uses a key GitHub does not document as supported. | Move the behavior into a supported step or remove it. |
| `RUNNER_MISSING` | Error | The special job has no valid runner label, label array, or runner group. | Select a supported runner. |
| `RUNNER_UNSUPPORTED` | Error | The workflow explicitly selects a macOS or ARM runner, which Copilot cloud agent does not support. | Use an Ubuntu x64 or Windows x64 runner. |
| `RUNNER_NOT_ALLOWED` | Error | The runner violates organization policy. | Use an approved runner label, or prefix an approved runner group with `group:` in policy. |
| `TIMEOUT_MISSING` | Error | The setup job has no bounded timeout. | Add `timeout-minutes`. |
| `TIMEOUT_INVALID` | Error | The timeout is not a positive integer. | Use a positive integer. |
| `TIMEOUT_EXCEEDS_LIMIT` | Error | The timeout exceeds the effective policy. | Reduce it to the configured maximum. |
| `PERMISSIONS_NOT_MINIMAL` | Error | Permissions are absent or broader than `contents: read`. | Grant only documented read access. |
| `STEPS_MISSING` | Error | The setup job has no executable steps. | Add checkout, runtime setup, and deterministic install steps. |
| `ACTION_REF_MUTABLE` | Warning | An external Action uses a mutable tag or branch. | Pin a reviewed 40-character commit SHA. |
| `SECRET_REFERENCE` | Warning | A setup step references the `secrets` context. | Remove it or document the unavoidable requirement. |
| `LOCKFILE_AMBIGUOUS` | Error | Multiple root lockfiles exist for one ecosystem. | Keep one authoritative root lockfile. |
| `LOCKFILE_MISSING` | Warning | A supported manifest exists without a root lockfile. | Commit the package manager lockfile. |
| `NODE_SETUP_MISSING` | Warning | A Node.js lockfile exists without an explicit `actions/setup-node` runtime selection. | Add runtime setup before installation if Node dependencies are needed. |
| `PYTHON_SETUP_MISSING` | Warning | A Python lockfile exists without an explicit `actions/setup-python` runtime selection. | Add runtime setup before installation if Python dependencies are needed. |
| `INSTALL_COMMAND_MISMATCH` | Warning | A root lockfile exists but no recognized install with explicit lockfile protection was detected. | Add the recommended lock-protected command if those dependencies are needed. |
| `POLICY_INVALID` | Error | The policy YAML or schema is invalid. | Correct YAML and remove unsupported keys. |

The authoritative behavior is the tested implementation in `packages/policy-engine`.
