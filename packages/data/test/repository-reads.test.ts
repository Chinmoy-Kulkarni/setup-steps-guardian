import { describe, expect, it } from "vitest";
import {
  getInstallationById,
  getRepository,
  getRepositoryDetails,
  listAccountRepositories,
  listAccountsWithQueuedScanJobs,
  listInstallations,
  listSelectedRepositories,
  setRepositoryScanEnabled,
  setRepositorySelection,
} from "../src/index.js";
import { normalizeSql, RecordingD1Database } from "./fake-d1.js";

const timestamp = "2026-08-10T22:00:00.000Z";

function repositoryRow() {
  return {
    account_id: "account-1",
    id: "repository-1",
    installation_id: "installation-1",
    owner: "example",
    name: "dashboard",
    is_private: 1,
    default_branch: "main",
    is_archived: 0,
    is_selected: 1,
    scan_enabled: 1,
    setup_status: "failing",
    last_scanned_at: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

describe("repository and installation reads", () => {
  it("gets one repository with both tenant and repository filters", async () => {
    const db = new RecordingD1Database();
    db.queueFirst(repositoryRow());

    const repository = await getRepository(db, "account-1", "repository-1");

    expect(repository).toMatchObject({
      accountId: "account-1",
      repositoryId: "repository-1",
      isPrivate: true,
      status: "failing",
    });
    expect(normalizeSql(db.prepared[0]?.sql ?? "")).toContain("WHERE account_id = ? AND id = ?");
    expect(db.prepared[0]?.bindings).toEqual(["account-1", "repository-1"]);
  });

  it("lists active selected repositories and installations for one account", async () => {
    const db = new RecordingD1Database();
    db.queueAll(
      [repositoryRow()],
      [
        {
          account_id: "account-1",
          id: "installation-1",
          repository_selection: "selected",
          suspended_at: null,
          created_at: timestamp,
          updated_at: timestamp,
        },
      ],
    );

    await expect(listSelectedRepositories(db, "account-1")).resolves.toHaveLength(1);
    await expect(listInstallations(db, "account-1")).resolves.toEqual([
      {
        accountId: "account-1",
        installationId: "installation-1",
        repositorySelection: "selected",
        suspendedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);

    expect(normalizeSql(db.prepared[0]?.sql ?? "")).toContain(
      "WHERE account_id = ? AND is_selected = 1 AND scan_enabled = 1 AND is_archived = 0",
    );
    expect(normalizeSql(db.prepared[1]?.sql ?? "")).toContain("WHERE account_id = ?");
  });

  it("resolves a signed webhook installation ID to its account", async () => {
    const db = new RecordingD1Database();
    db.queueFirst({
      account_id: "account-1",
      id: "installation-1",
      repository_selection: "selected",
      suspended_at: null,
      created_at: timestamp,
      updated_at: timestamp,
    });

    await expect(getInstallationById(db, "installation-1")).resolves.toMatchObject({
      accountId: "account-1",
      installationId: "installation-1",
    });
    expect(normalizeSql(db.prepared[0]?.sql ?? "")).toContain("WHERE id = ?");
    expect(db.prepared[0]?.bindings).toEqual(["installation-1"]);
  });

  it("lists all account repositories and updates selection with tenant scoping", async () => {
    const db = new RecordingD1Database();
    db.queueAll([repositoryRow()]);
    db.queueRunChanges(1);

    await expect(listAccountRepositories(db, "account-1")).resolves.toHaveLength(1);
    await expect(
      setRepositorySelection(db, {
        accountId: "account-1",
        repositoryId: "repository-1",
        isSelected: false,
        updatedAt: timestamp,
      }),
    ).resolves.toBe(true);

    expect(normalizeSql(db.prepared[0]?.sql ?? "")).toContain("WHERE account_id = ?");
    expect(normalizeSql(db.prepared[1]?.sql ?? "")).toContain("WHERE account_id = ? AND id = ?");
    expect(db.prepared[1]?.bindings).toEqual([0, timestamp, "account-1", "repository-1"]);
  });

  it("updates scan entitlement separately from repository selection", async () => {
    const db = new RecordingD1Database();
    db.queueRunChanges(1);

    await expect(
      setRepositoryScanEnabled(db, {
        accountId: "account-1",
        repositoryId: "repository-1",
        scanEnabled: false,
        updatedAt: timestamp,
      }),
    ).resolves.toBe(true);

    expect(normalizeSql(db.prepared[0]?.sql ?? "")).toContain(
      "SET scan_enabled = ?, updated_at = ?",
    );
    expect(db.prepared[0]?.bindings).toEqual([0, timestamp, "account-1", "repository-1"]);
  });

  it("returns normalized evidence and findings in repository details", async () => {
    const db = new RecordingD1Database();
    db.queueBatchResults(
      [repositoryRow()],
      [
        {
          repository_id: "repository-1",
          commit_sha: "a".repeat(40),
          workflow_hash: "b".repeat(64),
          policy_hash: "c".repeat(64),
          lockfile_hashes_json: JSON.stringify({
            "pnpm-lock.yaml": "d".repeat(64),
          }),
          runner_label: "ubuntu-latest",
          conclusion: "failure",
          duration_ms: 1_500,
          failed_step: "Install dependencies",
          run_id: "run-1",
          run_attempt: 1,
          completed_at: timestamp,
        },
      ],
      [
        {
          code: "INSTALL_COMMAND_MISMATCH",
          severity: "error",
          title: "Install command does not match",
          message: "Use the lockfile-specific command.",
          path: ".github/workflows/copilot-setup-steps.yml",
          line: 12,
          evidence_json: JSON.stringify({ packageManager: "pnpm" }),
          remediation: "Use pnpm install --frozen-lockfile.",
          documentation_url: null,
        },
      ],
    );

    const details = await getRepositoryDetails(db, "account-1", "repository-1");

    expect(details?.evidence).toMatchObject({
      repositoryId: "repository-1",
      conclusion: "failure",
      failedStep: "Install dependencies",
    });
    expect(details?.findings).toEqual([
      expect.objectContaining({
        code: "INSTALL_COMMAND_MISMATCH",
        line: 12,
        evidence: { packageManager: "pnpm" },
      }),
    ]);
    expect(db.batches[0]).toHaveLength(3);
    for (const statement of db.batches[0] ?? []) {
      expect(statement.bindings).toEqual(["account-1", "repository-1"]);
    }
  });
});

describe("cross-tenant queue discovery", () => {
  it("returns account IDs ordered by their oldest queued work", async () => {
    const db = new RecordingD1Database();
    db.queueAll([{ account_id: "account-1" }, { account_id: "account-2" }]);

    await expect(listAccountsWithQueuedScanJobs(db, 25)).resolves.toEqual([
      "account-1",
      "account-2",
    ]);

    const sql = normalizeSql(db.prepared[0]?.sql ?? "");
    expect(sql).toContain("WHERE status = 'queued'");
    expect(sql).toContain("GROUP BY account_id");
    expect(sql).toContain("ORDER BY MIN(available_at), account_id");
    expect(db.prepared[0]?.bindings).toEqual([25]);
  });
});
