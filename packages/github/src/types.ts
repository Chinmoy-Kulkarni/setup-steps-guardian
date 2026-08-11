import type { WorkflowConclusion } from "@setup-fleet/contracts";

export type GitHubAccountType = "Organization" | "User";

export interface GitHubAccount {
  readonly id: string;
  readonly name: string;
  readonly type: GitHubAccountType;
}

export interface GitHubRepositoryIdentity {
  readonly id: string;
  readonly owner: string;
  readonly name: string;
}

export interface GitHubRepository extends GitHubRepositoryIdentity {
  readonly defaultBranch: string;
  readonly isPrivate: boolean;
  readonly isArchived: boolean;
}

export interface GitHubSelectedRepository extends GitHubRepositoryIdentity {
  readonly defaultBranch: null;
  readonly isPrivate: boolean;
}

export type GitHubRepositoryReference = GitHubRepository | GitHubSelectedRepository;
export type GitHubRepositorySelection = "all" | "selected";

export type GitHubWorkflowConclusion = WorkflowConclusion | "stale";

export type GitHubWorkflowConclusionClassification =
  | {
      readonly kind: "contract";
      readonly conclusion: WorkflowConclusion;
    }
  | {
      readonly kind: "pending";
      readonly conclusion: null;
    }
  | {
      readonly kind: "stale";
      readonly conclusion: "stale";
    };

export function classifyGitHubWorkflowConclusion(
  conclusion: GitHubWorkflowConclusion | null,
): GitHubWorkflowConclusionClassification {
  if (conclusion === null) {
    return { kind: "pending", conclusion: null };
  }
  if (conclusion === "stale") {
    return { kind: "stale", conclusion };
  }
  return { kind: "contract", conclusion };
}

export interface GitHubWorkflowRun {
  readonly id: string;
  readonly workflowId: string;
  readonly name: string | null;
  readonly path: string;
  readonly headSha: string;
  readonly headBranch: string | null;
  readonly conclusion: GitHubWorkflowConclusion | null;
  readonly runAttempt: number;
  readonly runNumber: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly runStartedAt: string;
}

export interface GitHubWorkflowRunDiagnostics {
  readonly runnerLabel: string | null;
  readonly failedStep: string | null;
}
