import { describe, expect, it } from "vitest";
import {
  deleteAccount,
  grantAccountAdministrator,
  isAccountAdministrator,
  listAdministeredAccountIds,
  removeInstallation,
  removeRepository,
  revokeAccountAdministrators,
  upsertInstallation,
  upsertRepository,
} from "../src/index.js";
import { normalizeSql, RecordingD1Database } from "./fake-d1.js";

const timestamp = "2026-08-10T22:00:00.000Z";

describe("tenant-scoped writes", () => {
  it("parameterizes repository data instead of interpolating it", async () => {
    const db = new RecordingD1Database();
    const owner = "owner' OR 1 = 1 --";

    await upsertRepository(db, {
      accountId: "account-1",
      installationId: "installation-1",
      repositoryId: "repository-1",
      owner,
      name: "dashboard",
      isPrivate: true,
      defaultBranch: "main",
      isArchived: false,
      isSelected: true,
      observedAt: timestamp,
    });

    const statement = db.prepared[0];
    expect(statement).toBeDefined();
    expect(statement?.sql).not.toContain(owner);
    expect(normalizeSql(statement?.sql ?? "")).toContain(
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unproven', ?, ?)",
    );
    expect(statement?.bindings).toContain(owner);
    expect(statement?.bindings).toContain("account-1");
  });

  it("filters repository, installation, and account deletion by tenant identity", async () => {
    const db = new RecordingD1Database();
    db.queueRunChanges(1, 1, 1);

    await expect(
      removeRepository(db, {
        accountId: "account-1",
        repositoryId: "repository-1",
      }),
    ).resolves.toBe(true);
    await expect(
      removeInstallation(db, {
        accountId: "account-1",
        installationId: "installation-1",
      }),
    ).resolves.toBe(true);
    await expect(deleteAccount(db, "account-1")).resolves.toBe(true);

    expect(normalizeSql(db.prepared[0]?.sql ?? "")).toContain("WHERE account_id = ? AND id = ?");
    expect(db.prepared[0]?.bindings).toEqual(["account-1", "repository-1"]);
    expect(normalizeSql(db.prepared[1]?.sql ?? "")).toContain("WHERE account_id = ? AND id = ?");
    expect(db.prepared[1]?.bindings).toEqual(["account-1", "installation-1"]);
    expect(normalizeSql(db.prepared[2]?.sql ?? "")).toContain("WHERE id = ?");
    expect(db.prepared[2]?.bindings).toEqual(["account-1"]);
  });

  it("upserts the account before its installation in one batch", async () => {
    const db = new RecordingD1Database();

    await upsertInstallation(db, {
      accountId: "account-1",
      accountLogin: "example",
      accountType: "Organization",
      installationId: "installation-1",
      repositorySelection: "selected",
      suspendedAt: null,
      observedAt: timestamp,
    });

    expect(db.batches).toHaveLength(1);
    expect(normalizeSql(db.batches[0]?.[0]?.sql ?? "")).toContain("INSERT INTO github_accounts");
    expect(normalizeSql(db.batches[0]?.[1]?.sql ?? "")).toContain("INSERT INTO installations");
    expect(db.batches[0]?.[1]?.bindings.slice(0, 2)).toEqual(["account-1", "installation-1"]);
  });

  it("stores and checks account administrators by immutable numeric IDs", async () => {
    const db = new RecordingD1Database();

    await grantAccountAdministrator(db, {
      accountId: "42",
      githubUserId: "7",
      createdAt: timestamp,
    });
    db.queueFirst({ authorized: 1 });
    await expect(isAccountAdministrator(db, "42", "7")).resolves.toBe(true);
    db.queueAll([{ account_id: "42" }]);
    await expect(listAdministeredAccountIds(db, "7")).resolves.toEqual(["42"]);
    await revokeAccountAdministrators(db, "42");

    expect(db.prepared.map((statement) => statement.bindings)).toEqual([
      ["42", "7", timestamp],
      ["42", "7", "7"],
      ["7", "7"],
      ["42"],
    ]);
    expect(normalizeSql(db.prepared[1]?.sql ?? "")).toContain("account_type = 'User' AND id = ?");
  });
});
