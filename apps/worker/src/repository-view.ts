import {
  type RepositoryDetail,
  RepositoryDetailSchema,
  type RepositorySummary,
  RepositorySummarySchema,
} from "@setup-fleet/contracts";
import type { RepositoryDetails, RepositoryRecord } from "@setup-fleet/data";

function findingCounts(findings: RepositoryDetails["findings"]): {
  errors: number;
  warnings: number;
} {
  return findings.reduce(
    (counts, finding) => ({
      errors: counts.errors + (finding.severity === "error" ? 1 : 0),
      warnings: counts.warnings + (finding.severity === "warning" ? 1 : 0),
    }),
    { errors: 0, warnings: 0 },
  );
}

export function repositorySummary(
  repository: RepositoryRecord,
  details: Pick<RepositoryDetails, "findings" | "evidence">,
): RepositorySummary {
  const counts = findingCounts(details.findings);

  return RepositorySummarySchema.parse({
    repositoryId: repository.repositoryId,
    owner: repository.owner,
    name: repository.name,
    isPrivate: repository.isPrivate,
    defaultBranch: repository.defaultBranch,
    status: repository.status,
    lastEvidenceAt: details.evidence?.completedAt ?? null,
    errorCount: counts.errors,
    warningCount: counts.warnings,
  });
}

export function repositoryDetail(details: RepositoryDetails): RepositoryDetail {
  return RepositoryDetailSchema.parse({
    repository: repositorySummary(details.repository, details),
    findings: details.findings,
    evidence: details.evidence,
  });
}
