import type { RepositoryDetails } from "@setup-fleet/data";
import { describe, expect, it } from "vitest";
import { repositoryDetail } from "../src/repository-view.js";

describe("repository API view", () => {
  it("maps tenant data to the public contract", () => {
    const details: RepositoryDetails = {
      repository: {
        accountId: "42",
        repositoryId: "100",
        installationId: "200",
        owner: "octo-org",
        name: "web",
        isPrivate: true,
        defaultBranch: "main",
        isArchived: false,
        isSelected: true,
        scanEnabled: true,
        status: "invalid",
        lastScannedAt: "2026-08-10T22:00:00.000Z",
        createdAt: "2026-08-10T22:00:00.000Z",
        updatedAt: "2026-08-10T22:00:00.000Z",
      },
      evidence: null,
      findings: [
        {
          code: "SETUP_JOB_MISSING",
          severity: "error",
          title: "Missing job",
          message: "Missing job",
          path: ".github/workflows/copilot-setup-steps.yml",
          evidence: {},
          remediation: "Add the job",
        },
      ],
    };

    expect(repositoryDetail(details)).toMatchObject({
      repository: {
        errorCount: 1,
        warningCount: 0,
      },
      evidence: null,
    });
  });
});
