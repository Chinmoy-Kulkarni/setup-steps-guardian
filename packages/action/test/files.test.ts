import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readRepositoryMetadata, readWorkspaceFile, resolveWorkspacePath } from "../src/files.js";

describe("workspace file access", () => {
  it("checks only known repository metadata filenames without returning their contents", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "setup-steps-guardian-"));
    await writeFile(join(workspace, "package.json"), "{}");
    await writeFile(join(workspace, "package-lock.json"), "{}");
    await writeFile(join(workspace, "secret.txt"), "do not read");

    await expect(readRepositoryMetadata(workspace)).resolves.toEqual({
      "package.json": "",
      "package-lock.json": "",
    });
  });

  it("rejects paths that escape the workspace", () => {
    expect(() => resolveWorkspacePath("/tmp/workspace", "../secret")).toThrow(
      "escapes GITHUB_WORKSPACE",
    );
    expect(() => resolveWorkspacePath("/tmp/workspace", "/etc/passwd")).toThrow(
      "Absolute repository path",
    );
  });

  it("rejects symlink inputs", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "setup-steps-guardian-"));
    const outside = await mkdtemp(join(tmpdir(), "setup-steps-guardian-outside-"));
    await mkdir(join(workspace, ".github", "workflows"), { recursive: true });
    await writeFile(join(outside, "workflow.yml"), "jobs: {}");
    await symlink(
      join(outside, "workflow.yml"),
      join(workspace, ".github", "workflows", "copilot-setup-steps.yml"),
    );

    await expect(
      readWorkspaceFile(workspace, ".github/workflows/copilot-setup-steps.yml"),
    ).rejects.toThrow("Symbolic links are not allowed");
  });
});
