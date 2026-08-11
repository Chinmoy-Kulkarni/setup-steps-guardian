import type { RepositorySetupStatus } from "@setup-fleet/contracts";

export const SETUP_STATUSES = [
  "missing",
  "invalid",
  "drifting",
  "unproven",
  "passing",
  "failing",
  "stale",
] as const satisfies readonly RepositorySetupStatus[];

interface StatusMetadata {
  label: string;
  tone: "positive" | "critical" | "warning" | "neutral";
  description: string;
  nextStep: string;
}

export const STATUS_METADATA = {
  missing: {
    label: "Missing",
    tone: "critical",
    description: "The required Copilot setup workflow was not found.",
    nextStep: "Add .github/workflows/copilot-setup-steps.yml to the default branch.",
  },
  invalid: {
    label: "Invalid",
    tone: "critical",
    description: "The workflow is present but does not satisfy the setup policy.",
    nextStep: "Review validation findings and correct the workflow configuration.",
  },
  drifting: {
    label: "Drifting",
    tone: "warning",
    description: "The current workflow differs from the last proven configuration.",
    nextStep: "Run the setup workflow again and review the configuration change.",
  },
  unproven: {
    label: "Unproven",
    tone: "neutral",
    description: "The workflow is valid, but no matching run evidence is available yet.",
    nextStep: "Run the workflow on the current default-branch revision.",
  },
  passing: {
    label: "Passing",
    tone: "positive",
    description: "Current validation and workflow evidence are passing.",
    nextStep: "No immediate action is required. Continue normal monitoring.",
  },
  failing: {
    label: "Failing",
    tone: "critical",
    description: "The latest matching workflow evidence reports a failure.",
    nextStep: "Open the latest GitHub Actions run and resolve the failed setup step.",
  },
  stale: {
    label: "Stale",
    tone: "warning",
    description: "The available workflow evidence is older than the accepted window.",
    nextStep: "Run the workflow again to produce current setup evidence.",
  },
} satisfies Record<RepositorySetupStatus, StatusMetadata>;
