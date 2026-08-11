import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ActionCore } from "../src/run.js";
import { runAction } from "../src/run.js";

class FakeSummary {
  readonly entries: string[] = [];

  addHeading(text: string): this {
    this.entries.push(text);
    return this;
  }

  addRaw(text: string): this {
    this.entries.push(text);
    return this;
  }

  addTable(): this {
    this.entries.push("table");
    return this;
  }

  addDetails(label: string): this {
    this.entries.push(label);
    return this;
  }

  async write(): Promise<this> {
    return this;
  }
}

function createCore(inputs: Readonly<Record<string, string>> = {}): {
  core: ActionCore;
  failures: (string | Error)[];
  outputs: Map<string, unknown>;
  errors: string[];
  warnings: string[];
} {
  const failures: (string | Error)[] = [];
  const outputs = new Map<string, unknown>();
  const errors: string[] = [];
  const warnings: string[] = [];
  const summary = new FakeSummary();

  return {
    failures,
    outputs,
    errors,
    warnings,
    core: {
      summary,
      getInput: (name) => inputs[name] ?? "",
      getBooleanInput: (name) => inputs[name] === "true",
      setOutput: (name, value) => outputs.set(name, value),
      setFailed: (message) => failures.push(message),
      error: (message) => errors.push(String(message)),
      warning: (message) => warnings.push(String(message)),
      notice: () => undefined,
    },
  };
}

async function createWorkspace(workflow: string): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "setup-steps-guardian-"));
  await mkdir(join(workspace, ".github", "workflows"), { recursive: true });
  await writeFile(join(workspace, ".github", "workflows", "copilot-setup-steps.yml"), workflow);
  await writeFile(join(workspace, "package.json"), "{}");
  await writeFile(join(workspace, "package-lock.json"), "{}");
  return workspace;
}

describe("runAction", () => {
  it("publishes outputs without failing for a valid workflow", async () => {
    const workspace = await createWorkspace(`
on:
  workflow_dispatch:
jobs:
  copilot-setup-steps:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: read
    steps:
      - uses: actions/setup-node@1234567890123456789012345678901234567890
      - run: npm ci
`);
    const state = createCore();

    await runAction(state.core, { workspace });

    expect(state.failures).toEqual([]);
    expect(state.outputs.get("status")).toBe("valid");
    expect(state.outputs.get("error-count")).toBe(0);
  });

  it("fails and annotates invalid workflows", async () => {
    const workspace = await createWorkspace(`
on:
  push:
jobs:
  wrong-name:
    runs-on: ubuntu-latest
    steps:
      - run: npm install
`);
    const state = createCore();

    await runAction(state.core, { workspace });

    expect(state.outputs.get("status")).toBe("invalid");
    expect(state.failures).toHaveLength(1);
    expect(state.errors.length).toBeGreaterThan(0);
  });

  it("can fail on warning-only policy findings", async () => {
    const workspace = await createWorkspace(`
on:
  workflow_dispatch:
jobs:
  copilot-setup-steps:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: read
    steps:
      - uses: actions/setup-node@v7
      - run: npm ci
`);
    const state = createCore({ "fail-on-warnings": "true" });

    await runAction(state.core, { workspace });

    expect(state.outputs.get("status")).toBe("valid");
    expect(state.warnings).toHaveLength(1);
    expect(state.failures).toHaveLength(1);
  });
});
