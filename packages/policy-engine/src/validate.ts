import type { Finding, FindingSeverity, ValidationResult } from "@setup-fleet/contracts";
import { detectPackageManagers, packageManagerCommandMatches } from "./detection.js";
import { createMissingWorkflowPatch } from "./generator.js";
import { sha256, stableStringify } from "./hash.js";
import { type ConfigurableSeverity, DEFAULT_POLICY, type Policy, parsePolicy } from "./policy.js";
import { isRecord, parseYamlDocument, YamlParseError } from "./yaml.js";

const WORKFLOW_PATH = ".github/workflows/copilot-setup-steps.yml";
const SETUP_DOCS =
  "https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment";
const ACTION_SECURITY_DOCS =
  "https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions";

const SUPPORTED_JOB_KEYS = new Set([
  "steps",
  "permissions",
  "runs-on",
  "services",
  "snapshot",
  "timeout-minutes",
]);

export interface ValidationInput {
  readonly workflowContent?: string;
  readonly policyContent?: string;
  readonly files?: Readonly<Record<string, string>>;
  readonly workflowPath?: string;
}

interface FindingInput {
  readonly code: string;
  readonly severity: FindingSeverity;
  readonly title: string;
  readonly message: string;
  readonly path: string;
  readonly evidence?: Finding["evidence"];
  readonly remediation: string;
  readonly documentationUrl?: string;
}

function finding(input: FindingInput): Finding {
  return {
    code: input.code,
    severity: input.severity,
    title: input.title,
    message: input.message,
    path: input.path,
    evidence: input.evidence ?? {},
    remediation: input.remediation,
    ...(input.documentationUrl === undefined ? {} : { documentationUrl: input.documentationUrl }),
  };
}

function configuredSeverity(value: ConfigurableSeverity): FindingSeverity | undefined {
  return value === "off" ? undefined : value;
}

function parsePolicyContent(content: string | undefined): Policy {
  if (content === undefined || content.trim().length === 0) {
    return DEFAULT_POLICY;
  }

  return parsePolicy(parseYamlDocument(content));
}

function containsSecretReference(value: unknown): boolean {
  if (typeof value === "string") {
    return value.includes("${{ secrets.");
  }
  if (Array.isArray(value)) {
    return value.some(containsSecretReference);
  }
  if (isRecord(value)) {
    return Object.values(value).some(containsSecretReference);
  }
  return false;
}

function hasWorkflowDispatch(trigger: unknown): boolean {
  if (trigger === "workflow_dispatch") {
    return true;
  }
  if (Array.isArray(trigger)) {
    return trigger.includes("workflow_dispatch");
  }
  return isRecord(trigger) && Object.hasOwn(trigger, "workflow_dispatch");
}

function isExplicitReadOnlyPermissions(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return Object.keys(value).length === 1 && value.contents === "read";
}

function stepRecords(job: Record<string, unknown>): readonly Record<string, unknown>[] {
  const steps = job.steps;
  if (!Array.isArray(steps)) {
    return [];
  }
  return steps.filter(isRecord);
}

function stepName(step: Record<string, unknown>, index: number): string {
  return typeof step.name === "string" && step.name.length > 0 ? step.name : `Step ${index + 1}`;
}

function runCommands(steps: readonly Record<string, unknown>[]): string {
  return steps
    .map((step) => (typeof step.run === "string" ? step.run : ""))
    .filter((command) => command.length > 0)
    .join("\n");
}

function hasAction(steps: readonly Record<string, unknown>[], action: string): boolean {
  return steps.some(
    (step) => typeof step.uses === "string" && step.uses.toLowerCase().startsWith(`${action}@`),
  );
}

function validateJob(
  workflow: Record<string, unknown>,
  policy: Policy,
  files: Readonly<Record<string, string>>,
  path: string,
): Finding[] {
  const findings: Finding[] = [];
  const jobs = workflow.jobs;

  if (!isRecord(jobs)) {
    return [
      finding({
        code: "JOBS_MISSING",
        severity: "error",
        title: "Workflow jobs are missing",
        message: "The workflow must define a jobs mapping.",
        path,
        remediation: "Add a jobs mapping with the required copilot-setup-steps job.",
        documentationUrl: SETUP_DOCS,
      }),
    ];
  }

  const setupJob = jobs["copilot-setup-steps"];
  if (!isRecord(setupJob)) {
    return [
      finding({
        code: "SETUP_JOB_MISSING",
        severity: "error",
        title: "Required setup job is missing",
        message: "GitHub requires a job named copilot-setup-steps.",
        path,
        remediation: "Add a job whose identifier is exactly copilot-setup-steps.",
        documentationUrl: SETUP_DOCS,
      }),
    ];
  }

  const unsupportedSeverity = configuredSeverity(policy.unsupportedJobKeys);
  if (unsupportedSeverity !== undefined) {
    for (const key of Object.keys(setupJob)) {
      if (!SUPPORTED_JOB_KEYS.has(key)) {
        findings.push(
          finding({
            code: "UNSUPPORTED_JOB_KEY",
            severity: unsupportedSeverity,
            title: "Setup job contains an unsupported key",
            message: `GitHub does not document "${key}" as a supported setup-job setting.`,
            path,
            evidence: { key },
            remediation: `Remove "${key}" or move the behavior into a supported step.`,
            documentationUrl: SETUP_DOCS,
          }),
        );
      }
    }
  }

  if (typeof setupJob["runs-on"] !== "string") {
    findings.push(
      finding({
        code: "RUNNER_MISSING",
        severity: "error",
        title: "Runner label is missing",
        message: "The setup job must select a supported runner.",
        path,
        remediation: `Set runs-on to one of: ${policy.allowedRunners.join(", ")}.`,
        documentationUrl: SETUP_DOCS,
      }),
    );
  } else if (!policy.allowedRunners.includes(setupJob["runs-on"])) {
    findings.push(
      finding({
        code: "RUNNER_NOT_ALLOWED",
        severity: "error",
        title: "Runner is outside the organization policy",
        message: `Runner "${setupJob["runs-on"]}" is not approved.`,
        path,
        evidence: { runner: setupJob["runs-on"] },
        remediation: `Use one of: ${policy.allowedRunners.join(", ")}.`,
        documentationUrl: SETUP_DOCS,
      }),
    );
  }

  const timeout = setupJob["timeout-minutes"];
  if (timeout === undefined && policy.requireTimeout) {
    findings.push(
      finding({
        code: "TIMEOUT_MISSING",
        severity: "error",
        title: "Setup timeout is missing",
        message: "A bounded timeout prevents setup from consuming a runner indefinitely.",
        path,
        remediation: `Set timeout-minutes to ${Math.min(policy.maxTimeoutMinutes, 30)} or less.`,
        documentationUrl: SETUP_DOCS,
      }),
    );
  } else if (
    timeout !== undefined &&
    (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < 1)
  ) {
    findings.push(
      finding({
        code: "TIMEOUT_INVALID",
        severity: "error",
        title: "Setup timeout is invalid",
        message: "timeout-minutes must be a positive integer.",
        path,
        remediation: `Set timeout-minutes to ${Math.min(policy.maxTimeoutMinutes, 30)} or less.`,
        documentationUrl: SETUP_DOCS,
      }),
    );
  } else if (typeof timeout === "number" && timeout > policy.maxTimeoutMinutes) {
    findings.push(
      finding({
        code: "TIMEOUT_EXCEEDS_LIMIT",
        severity: "error",
        title: "Setup timeout exceeds the policy limit",
        message: `The configured timeout is ${timeout} minutes.`,
        path,
        evidence: { timeout, maximum: policy.maxTimeoutMinutes },
        remediation: `Reduce timeout-minutes to ${policy.maxTimeoutMinutes} or less.`,
        documentationUrl: SETUP_DOCS,
      }),
    );
  }

  if (policy.requireExplicitPermissions && !isExplicitReadOnlyPermissions(setupJob.permissions)) {
    findings.push(
      finding({
        code: "PERMISSIONS_NOT_MINIMAL",
        severity: "error",
        title: "Setup permissions are not explicitly read-only",
        message: "The setup job should grant only contents: read unless more is documented.",
        path,
        remediation: "Set the setup job permissions mapping to contents: read.",
        documentationUrl: SETUP_DOCS,
      }),
    );
  }

  const steps = stepRecords(setupJob);
  if (steps.length === 0) {
    findings.push(
      finding({
        code: "STEPS_MISSING",
        severity: "error",
        title: "Setup steps are missing",
        message: "The setup job must contain at least one step.",
        path,
        remediation: "Add checkout, runtime setup, and deterministic dependency-install steps.",
        documentationUrl: SETUP_DOCS,
      }),
    );
    return findings;
  }

  const pinningSeverity = configuredSeverity(policy.actionPinning);
  const secretSeverity = configuredSeverity(policy.secretUsage);
  steps.forEach((step, index) => {
    if (pinningSeverity !== undefined && typeof step.uses === "string") {
      const uses = step.uses;
      const separator = uses.lastIndexOf("@");
      const reference = separator === -1 ? "" : uses.slice(separator + 1);
      const isLocal = uses.startsWith("./");
      const isDocker = uses.startsWith("docker://");
      const isPinned = /^[a-f0-9]{40}$/i.test(reference);

      if (!isLocal && !isDocker && !isPinned) {
        findings.push(
          finding({
            code: "ACTION_REF_MUTABLE",
            severity: pinningSeverity,
            title: "Action reference is mutable",
            message: `${stepName(step, index)} uses a tag or branch instead of a full commit SHA.`,
            path,
            evidence: { step: stepName(step, index), action: uses },
            remediation: "Pin the action to a reviewed 40-character commit SHA.",
            documentationUrl: ACTION_SECURITY_DOCS,
          }),
        );
      }
    }

    if (secretSeverity !== undefined && containsSecretReference(step)) {
      findings.push(
        finding({
          code: "SECRET_REFERENCE",
          severity: secretSeverity,
          title: "Setup step references a repository secret",
          message: `${stepName(step, index)} references the secrets context.`,
          path,
          evidence: { step: stepName(step, index) },
          remediation:
            "Remove the secret reference or document why the coding-agent setup requires it.",
          documentationUrl: SETUP_DOCS,
        }),
      );
    }
  });

  const detection = detectPackageManagers(files);
  for (const group of detection.ambiguousGroups) {
    findings.push(
      finding({
        code: "LOCKFILE_AMBIGUOUS",
        severity: "error",
        title: "Multiple package-manager lockfiles were detected",
        message: `The root repository contains multiple ${group} lockfile formats.`,
        path,
        evidence: { ecosystem: group },
        remediation: "Keep one authoritative root lockfile for the ecosystem.",
      }),
    );
  }

  for (const ecosystem of detection.missingLockfiles) {
    findings.push(
      finding({
        code: "LOCKFILE_MISSING",
        severity: "warning",
        title: "Dependency manifest has no supported lockfile",
        message: `A ${ecosystem} manifest exists without a supported root lockfile.`,
        path,
        evidence: { ecosystem },
        remediation: "Commit the package manager's lockfile for deterministic installation.",
      }),
    );
  }

  const commands = runCommands(steps);
  const hasNodePackages = detection.packageManagers.some((manager) =>
    ["npm", "pnpm", "yarn"].includes(manager),
  );
  const hasPythonPackages = detection.packageManagers.some((manager) =>
    ["uv", "poetry", "pip"].includes(manager),
  );

  if (hasNodePackages && !hasAction(steps, "actions/setup-node")) {
    findings.push(
      finding({
        code: "NODE_SETUP_MISSING",
        severity: "error",
        title: "Node.js runtime setup is missing",
        message: "A Node.js lockfile exists but actions/setup-node is not used.",
        path,
        remediation: "Add actions/setup-node before installing Node.js dependencies.",
      }),
    );
  }

  if (hasPythonPackages && !hasAction(steps, "actions/setup-python")) {
    findings.push(
      finding({
        code: "PYTHON_SETUP_MISSING",
        severity: "error",
        title: "Python runtime setup is missing",
        message: "A Python lockfile exists but actions/setup-python is not used.",
        path,
        remediation: "Add actions/setup-python before installing Python dependencies.",
      }),
    );
  }

  for (const packageManager of detection.packageManagers) {
    if (!packageManagerCommandMatches(packageManager, commands)) {
      findings.push(
        finding({
          code: "INSTALL_COMMAND_MISMATCH",
          severity: "error",
          title: "Deterministic install command is missing",
          message: `The workflow does not use the expected locked install for ${packageManager}.`,
          path,
          evidence: { packageManager },
          remediation: `Use the documented deterministic install command for ${packageManager}.`,
        }),
      );
    }
  }

  return findings;
}

export async function validateSetupWorkflow(input: ValidationInput): Promise<ValidationResult> {
  const workflowPath = input.workflowPath ?? WORKFLOW_PATH;
  const files = input.files ?? {};
  let policy: Policy;

  try {
    policy = parsePolicyContent(input.policyContent);
  } catch (error) {
    const message =
      error instanceof YamlParseError
        ? error.issues.join("; ")
        : error instanceof Error
          ? error.message
          : "Unknown policy error";
    const policyHash = await sha256(input.policyContent ?? "");

    return {
      schemaVersion: 1,
      status: "invalid",
      workflowPath,
      policyHash,
      findings: [
        finding({
          code: "POLICY_INVALID",
          severity: "error",
          title: "Organization policy is invalid",
          message,
          path: "agent-setup-policy.yml",
          remediation: "Correct the YAML and use only supported policy keys and values.",
        }),
      ],
      patches: [],
    };
  }

  const policyHash = await sha256(stableStringify(policy));
  const detection = detectPackageManagers(files);

  if (input.workflowContent === undefined) {
    return {
      schemaVersion: 1,
      status: "invalid",
      workflowPath,
      policyHash,
      findings: [
        finding({
          code: "WORKFLOW_MISSING",
          severity: "error",
          title: "Copilot setup workflow is missing",
          message: `No workflow was found at ${workflowPath}.`,
          path: workflowPath,
          remediation: "Create the documented Copilot setup workflow on the default branch.",
          documentationUrl: SETUP_DOCS,
        }),
      ],
      patches: [createMissingWorkflowPatch(policy, detection.packageManagers)],
    };
  }

  const workflowHash = await sha256(input.workflowContent);
  let workflow: unknown;

  try {
    workflow = parseYamlDocument(input.workflowContent);
  } catch (error) {
    const message =
      error instanceof YamlParseError
        ? error.issues.join("; ")
        : error instanceof Error
          ? error.message
          : "Unknown workflow error";

    return {
      schemaVersion: 1,
      status: "invalid",
      workflowPath,
      workflowHash,
      policyHash,
      findings: [
        finding({
          code: "WORKFLOW_YAML_INVALID",
          severity: "error",
          title: "Setup workflow YAML is invalid",
          message,
          path: workflowPath,
          remediation: "Correct the YAML syntax and duplicate keys.",
          documentationUrl: SETUP_DOCS,
        }),
      ],
      patches: [],
    };
  }

  if (!isRecord(workflow)) {
    return {
      schemaVersion: 1,
      status: "invalid",
      workflowPath,
      workflowHash,
      policyHash,
      findings: [
        finding({
          code: "WORKFLOW_ROOT_INVALID",
          severity: "error",
          title: "Setup workflow root is invalid",
          message: "The workflow root must be a YAML mapping.",
          path: workflowPath,
          remediation: "Replace the workflow with a valid GitHub Actions mapping.",
          documentationUrl: SETUP_DOCS,
        }),
      ],
      patches: [],
    };
  }

  const findings: Finding[] = [];
  if (policy.requireWorkflowDispatch && !hasWorkflowDispatch(workflow.on)) {
    findings.push(
      finding({
        code: "WORKFLOW_DISPATCH_MISSING",
        severity: "error",
        title: "Manual validation trigger is missing",
        message: "The workflow should support workflow_dispatch for explicit validation.",
        path: workflowPath,
        remediation: "Add workflow_dispatch to the workflow triggers.",
        documentationUrl: SETUP_DOCS,
      }),
    );
  }

  findings.push(...validateJob(workflow, policy, files, workflowPath));
  const status = findings.some((item) => item.severity === "error") ? "invalid" : "valid";

  return {
    schemaVersion: 1,
    status,
    workflowPath,
    workflowHash,
    policyHash,
    findings,
    patches: [],
  };
}
