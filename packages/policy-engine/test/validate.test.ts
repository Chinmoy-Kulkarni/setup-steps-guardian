import { describe, expect, it } from "vitest";
import {
  detectPackageManagers,
  generateRecommendedWorkflow,
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
    environment: production
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
});
