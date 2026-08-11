import type {
  RepositorySetupStatus,
  ValidationResult,
  WorkflowEvidence,
} from "@setup-fleet/contracts";

function recordsEqual(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftEntries = Object.entries(left).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  );
  const rightEntries = Object.entries(right).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  );

  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

export interface RepositoryStatusInput {
  readonly validation: ValidationResult;
  readonly evidence: WorkflowEvidence | null;
  readonly lockfileHashes: Readonly<Record<string, string>>;
}

export function deriveRepositoryStatus(input: RepositoryStatusInput): RepositorySetupStatus {
  if (input.validation.findings.some((finding) => finding.code === "WORKFLOW_MISSING")) {
    return "missing";
  }

  if (input.validation.status === "invalid") {
    return "invalid";
  }

  if (input.evidence === null) {
    return input.validation.findings.some((finding) => finding.severity === "warning")
      ? "drifting"
      : "unproven";
  }

  if (
    input.validation.workflowHash !== input.evidence.workflowHash ||
    input.validation.policyHash !== input.evidence.policyHash ||
    !recordsEqual(input.lockfileHashes, input.evidence.lockfileHashes)
  ) {
    return "stale";
  }

  if (input.validation.findings.some((finding) => finding.severity === "warning")) {
    return "drifting";
  }

  return input.evidence.conclusion === "success" ? "passing" : "failing";
}
