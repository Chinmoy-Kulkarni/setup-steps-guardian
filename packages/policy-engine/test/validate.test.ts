import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY,
  detectPackageManagers,
  generateRecommendedWorkflow,
  packageManagerCommandMatches,
  validateSetupWorkflow,
} from "../src/index.js";

const validWorkflow = `
name: Copilot Setup Steps
on:
  workflow_dispatch:
jobs:
  copilot-setup-steps:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@0123456789012345678901234567890123456789
      - uses: actions/setup-node@1234567890123456789012345678901234567890
        with:
          node-version: "24"
      - run: npm ci
`;

describe("validateSetupWorkflow", () => {
  it("accepts a deterministic Node.js setup workflow", async () => {
    const result = await validateSetupWorkflow({
      workflowContent: validWorkflow,
      files: {
        "package.json": "{}",
        "package-lock.json": "{}",
      },
    });

    expect(result.status).toBe("valid");
    expect(result.findings).toEqual([]);
    expect(result.workflowHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns a safe create patch when the workflow is missing", async () => {
    const result = await validateSetupWorkflow({
      files: {
        "package.json": "{}",
        "pnpm-lock.yaml": "lockfileVersion: '9.0'",
      },
    });

    expect(result.status).toBe("invalid");
    expect(result.findings.map((finding) => finding.code)).toContain("WORKFLOW_MISSING");
    expect(result.patches).toHaveLength(1);
    expect(result.patches[0]?.content).toContain("pnpm install --frozen-lockfile");
  });

  it("rejects duplicate YAML keys", async () => {
    const result = await validateSetupWorkflow({
      workflowContent: `
on: workflow_dispatch
jobs: {}
jobs: {}
`,
    });

    expect(result.findings[0]?.code).toBe("WORKFLOW_YAML_INVALID");
  });

  it("reports unsupported settings, mutable actions, and broad permissions", async () => {
    const result = await validateSetupWorkflow({
      workflowContent: `
on:
  push:
jobs:
  copilot-setup-steps:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    permissions:
      contents: write
    name: production
    steps:
      - uses: actions/checkout@v6
      - run: npm install
        env:
          TOKEN: \${{ secrets.PRIVATE_TOKEN }}
`,
      files: {
        "package.json": "{}",
        "package-lock.json": "{}",
      },
      policyContent: `
schemaVersion: 1
allowedRunners:
  - ubuntu-latest
maxTimeoutMinutes: 59
requireTimeout: true
requireExplicitPermissions: true
requireWorkflowDispatch: true
`,
    });

    const codes = result.findings.map((finding) => finding.code);
    expect(result.status).toBe("invalid");
    expect(codes).toContain("WORKFLOW_DISPATCH_MISSING");
    expect(codes).toContain("TIMEOUT_EXCEEDS_LIMIT");
    expect(codes).toContain("PERMISSIONS_NOT_MINIMAL");
    expect(codes).toContain("UNSUPPORTED_JOB_KEY");
    expect(codes).toContain("ACTION_REF_MUTABLE");
    expect(codes).toContain("SECRET_REFERENCE");
    expect(codes).toContain("NODE_SETUP_MISSING");
    expect(codes).toContain("INSTALL_COMMAND_MISMATCH");
  });

  it("keeps the default policy compatible with documented optional settings", async () => {
    const result = await validateSetupWorkflow({
      workflowContent: `
on:
  push:
jobs:
  copilot-setup-steps:
    runs-on:
      group: organization-runners
      labels:
        - linux
        - x64
    steps:
      - run: echo ready
`,
    });

    expect(DEFAULT_POLICY).toMatchObject({
      allowedRunners: ["*"],
      maxTimeoutMinutes: 59,
      requireTimeout: false,
      requireExplicitPermissions: false,
      requireWorkflowDispatch: false,
    });
    expect(result).toMatchObject({
      status: "valid",
      findings: [],
    });
  });

  it("enforces configured runner labels and groups", async () => {
    const result = await validateSetupWorkflow({
      workflowContent: `
on:
  workflow_dispatch:
jobs:
  copilot-setup-steps:
    runs-on:
      group: unapproved-group
      labels: linux
    steps:
      - run: echo ready
`,
      policyContent: `
schemaVersion: 1
allowedRunners:
  - group:approved-group
  - linux
`,
    });

    expect(result.findings.map((finding) => finding.code)).toContain("RUNNER_NOT_ALLOWED");
  });

  it("rejects additional jobs but accepts the documented snapshot setting", async () => {
    const result = await validateSetupWorkflow({
      workflowContent: `
on:
  push:
jobs:
  prepare:
    runs-on: ubuntu-latest
    steps:
      - run: echo prepare
  copilot-setup-steps:
    runs-on: ubuntu-latest
    snapshot: base-environment
    steps:
      - run: echo ready
`,
    });

    expect(result.findings.map((finding) => finding.code)).toEqual(["ADDITIONAL_JOB"]);
  });

  it("reports unsupported job settings from the current GitHub contract", async () => {
    const result = await validateSetupWorkflow({
      workflowContent: `
on:
  push:
jobs:
  copilot-setup-steps:
    runs-on: ubuntu-latest
    environment: copilot
    container: node:24
    steps:
      - run: echo ready
`,
    });

    expect(result.findings.map((finding) => finding.code)).toEqual([
      "UNSUPPORTED_JOB_KEY",
      "UNSUPPORTED_JOB_KEY",
    ]);
  });

  it("rejects explicitly unsupported runner architectures", async () => {
    const result = await validateSetupWorkflow({
      workflowContent: `
on:
  push:
jobs:
  copilot-setup-steps:
    runs-on: macos-15
    steps:
      - run: echo ready
`,
    });

    expect(result.findings.map((finding) => finding.code)).toEqual(["RUNNER_UNSUPPORTED"]);
  });

  it("does not infer runner architecture from a runner group name", async () => {
    const result = await validateSetupWorkflow({
      workflowContent: `
on:
  push:
jobs:
  copilot-setup-steps:
    runs-on:
      group: macos-migration
      labels:
        - linux
        - x64
    steps:
      - run: echo ready
`,
    });

    expect(result.findings).toEqual([]);
  });

  it("treats inferred dependency setup as review guidance rather than structural invalidity", async () => {
    const result = await validateSetupWorkflow({
      workflowContent: `
on:
  push:
jobs:
  copilot-setup-steps:
    runs-on: ubuntu-latest
    steps:
      - run: echo ready
`,
      files: {
        "package.json": "{}",
        "package-lock.json": "{}",
      },
    });

    expect(result.status).toBe("valid");
    expect(
      result.findings
        .filter((finding) =>
          ["NODE_SETUP_MISSING", "INSTALL_COMMAND_MISMATCH"].includes(finding.code),
        )
        .map((finding) => finding.severity),
    ).toEqual(["warning", "warning"]);
  });

  it("recognizes common package-manager install forms and wrappers", async () => {
    const cases = [
      {
        files: { "package.json": "{}", "pnpm-lock.yaml": "" },
        steps: `
      - uses: actions/setup-node@v4
      - run: pnpm install --frozen-lockfile`,
      },
      {
        files: { "pyproject.toml": "{}", "uv.lock": "" },
        steps: `
      - uses: actions/setup-python@v5
      - run: uv sync --locked`,
      },
      {
        files: { "package.json": "{}", "yarn.lock": "" },
        steps: `
      - uses: actions/setup-node@v4
      - uses: bahmutov/npm-install@v1`,
      },
      {
        files: { "package.json": "{}", "package-lock.json": "" },
        steps: `
      - uses: actions/setup-node@v4
      - uses: nick-fields/retry@v3
        with:
          command: npm ci`,
      },
    ];

    for (const testCase of cases) {
      const result = await validateSetupWorkflow({
        workflowContent: `
on:
  push:
jobs:
  copilot-setup-steps:
    runs-on: ubuntu-latest
    steps:${testCase.steps}
`,
        files: testCase.files,
      });

      expect(result.findings.map((finding) => finding.code)).not.toContain(
        "INSTALL_COMMAND_MISMATCH",
      );
    }
  });

  it("warns when uv is allowed to update its lockfile", async () => {
    const result = await validateSetupWorkflow({
      workflowContent: `
on:
  push:
jobs:
  copilot-setup-steps:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-python@v5
      - run: uv sync --upgrade
`,
      files: {
        "pyproject.toml": "{}",
        "uv.lock": "",
      },
    });

    expect(result.findings.map((finding) => finding.code)).toContain("INSTALL_COMMAND_MISMATCH");
  });

  it("evaluates determinism on the same uv sync invocation", async () => {
    const cases = [
      {
        commands: `
      - run: |
          uv sync
          echo --locked`,
        expectsWarning: true,
      },
      {
        commands: `
      - run: |
          python -m pip install --upgrade pip
          uv sync --locked`,
        expectsWarning: false,
      },
    ];

    for (const testCase of cases) {
      const result = await validateSetupWorkflow({
        workflowContent: `
on:
  push:
jobs:
  copilot-setup-steps:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-python@v5${testCase.commands}
`,
        files: {
          "pyproject.toml": "{}",
          "uv.lock": "",
        },
      });

      expect(
        result.findings.map((finding) => finding.code).includes("INSTALL_COMMAND_MISMATCH"),
      ).toBe(testCase.expectsWarning);
    }
  });

  it("requires explicit lock protection for pnpm and yarn installs", () => {
    expect(packageManagerCommandMatches("pnpm", "pnpm install --frozen-lockfile")).toBe(true);
    expect(packageManagerCommandMatches("pnpm", "pnpm install")).toBe(false);
    expect(packageManagerCommandMatches("pnpm", "pnpm install --no-frozen-lockfile")).toBe(false);
    expect(
      packageManagerCommandMatches("pnpm", "pnpm install --frozen-lockfile --no-lockfile"),
    ).toBe(false);
    expect(packageManagerCommandMatches("pnpm", "pnpm install --frozen-lockfile=false")).toBe(
      false,
    );
    expect(packageManagerCommandMatches("pnpm", 'pnpm install --frozen-lockfile="false"')).toBe(
      false,
    );
    expect(
      packageManagerCommandMatches(
        "pnpm",
        "pnpm install --frozen-lockfile || pnpm install --no-frozen-lockfile",
      ),
    ).toBe(false);
    expect(
      packageManagerCommandMatches("pnpm", "pnpm install --frozen-lockfile || pnpm install"),
    ).toBe(false);
    expect(packageManagerCommandMatches("yarn", "yarn install --immutable")).toBe(true);
    expect(packageManagerCommandMatches("yarn", "yarn install --frozen-lockfile")).toBe(true);
    expect(packageManagerCommandMatches("yarn", "yarn install")).toBe(false);
    expect(packageManagerCommandMatches("yarn", "yarn install --no-immutable")).toBe(false);
    expect(packageManagerCommandMatches("yarn", "yarn install --immutable=false")).toBe(false);
    expect(packageManagerCommandMatches("yarn", "yarn install --no-lockfile")).toBe(false);
    expect(
      packageManagerCommandMatches(
        "yarn",
        "yarn install --immutable || yarn install --no-immutable",
      ),
    ).toBe(false);
    expect(packageManagerCommandMatches("yarn", "yarn install --immutable || yarn install")).toBe(
      false,
    );
    expect(packageManagerCommandMatches("yarn", "yarn install --immutable || yarn")).toBe(false);
    expect(packageManagerCommandMatches("uv", "uv sync --locked || uv sync --upgrade")).toBe(false);
    expect(packageManagerCommandMatches("uv", "uv sync --locked || uv sync -U")).toBe(false);
    expect(packageManagerCommandMatches("uv", "uv sync --locked || uv sync")).toBe(false);
  });

  it("rejects ambiguous root lockfiles", async () => {
    const result = await validateSetupWorkflow({
      workflowContent: validWorkflow,
      files: {
        "package.json": "{}",
        "package-lock.json": "{}",
        "pnpm-lock.yaml": "lockfileVersion: '9.0'",
      },
    });

    expect(result.findings.map((finding) => finding.code)).toContain("LOCKFILE_AMBIGUOUS");
  });

  it("rejects unsafe or unknown policy keys", async () => {
    const result = await validateSetupWorkflow({
      workflowContent: validWorkflow,
      policyContent: `
schemaVersion: 1
unknownSetting: true
`,
    });

    expect(result.findings[0]?.code).toBe("POLICY_INVALID");
  });
});

describe("package-manager detection and generation", () => {
  it("detects mixed Node.js and Python repositories", () => {
    expect(
      detectPackageManagers({
        "pnpm-lock.yaml": "",
        "uv.lock": "",
      }).packageManagers,
    ).toEqual(["pnpm", "uv"]);
  });

  it("generates the required special job", () => {
    const workflow = generateRecommendedWorkflow(
      {
        schemaVersion: 1,
        allowedRunners: ["ubuntu-latest"],
        maxTimeoutMinutes: 59,
        requireTimeout: true,
        requireExplicitPermissions: true,
        requireWorkflowDispatch: true,
        actionPinning: "warning",
        secretUsage: "warning",
        unsupportedJobKeys: "warning",
      },
      ["npm", "uv"],
    );

    expect(workflow).toContain("copilot-setup-steps:");
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("uv sync --frozen");
  });

  it("generates a workflow that satisfies a strict policy", async () => {
    const policyContent = `
schemaVersion: 1
allowedRunners:
  - ubuntu-latest
maxTimeoutMinutes: 30
requireTimeout: true
requireExplicitPermissions: true
requireWorkflowDispatch: true
actionPinning: error
secretUsage: error
unsupportedJobKeys: error
`;
    const workflow = generateRecommendedWorkflow(
      {
        schemaVersion: 1,
        allowedRunners: ["ubuntu-latest"],
        maxTimeoutMinutes: 30,
        requireTimeout: true,
        requireExplicitPermissions: true,
        requireWorkflowDispatch: true,
        actionPinning: "error",
        secretUsage: "error",
        unsupportedJobKeys: "error",
      },
      ["npm", "uv"],
    );

    const result = await validateSetupWorkflow({
      workflowContent: workflow,
      policyContent,
      files: {
        "package.json": "{}",
        "package-lock.json": "{}",
        "pyproject.toml": "",
        "uv.lock": "",
      },
    });

    expect(result).toMatchObject({
      status: "valid",
      findings: [],
    });
  });

  it("generates an explicit runner-group selection that satisfies its policy", async () => {
    const policy = {
      schemaVersion: 1 as const,
      allowedRunners: ["group:macos-migration"],
      maxTimeoutMinutes: 30,
      requireTimeout: true,
      requireExplicitPermissions: true,
      requireWorkflowDispatch: true,
      actionPinning: "warning" as const,
      secretUsage: "warning" as const,
      unsupportedJobKeys: "warning" as const,
    };
    const workflow = generateRecommendedWorkflow(policy, []);
    const result = await validateSetupWorkflow({
      workflowContent: workflow,
      policyContent: `
schemaVersion: 1
allowedRunners:
  - group:macos-migration
`,
    });

    expect(workflow).toContain('group: "macos-migration"');
    expect(result.findings).toEqual([]);
  });
});
