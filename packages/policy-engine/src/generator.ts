import type { PatchProposal } from "@setup-fleet/contracts";
import { type PackageManager, packageManagerInstallCommand } from "./detection.js";
import type { Policy } from "./policy.js";

const WORKFLOW_PATH = ".github/workflows/copilot-setup-steps.yml";
const CHECKOUT_REF = "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803";
const SETUP_NODE_REF = "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020";
const SETUP_PYTHON_REF = "actions/setup-python@ece7cb06caefa5fff74198d8649806c4678c61a1";
const SETUP_UV_REF = "astral-sh/setup-uv@d0d8abe699bfb85fec6de9f7adb5ae17292296ff";

function indent(lines: readonly string[], spaces: number): string[] {
  const prefix = " ".repeat(spaces);
  return lines.map((line) => (line.length === 0 ? line : `${prefix}${line}`));
}

function nodeSteps(packageManager: PackageManager): string[] {
  if (!["npm", "pnpm", "yarn"].includes(packageManager)) {
    return [];
  }

  const cache = packageManager === "npm" ? "npm" : packageManager;
  const setup = [
    "- name: Set up Node.js",
    `  uses: ${SETUP_NODE_REF}`,
    "  with:",
    '    node-version: "24"',
    `    cache: "${cache}"`,
  ];

  if (packageManager !== "npm") {
    setup.push("- name: Enable Corepack", "  run: corepack enable");
  }

  setup.push(
    "- name: Install Node.js dependencies",
    `  run: ${packageManagerInstallCommand(packageManager)}`,
  );

  return setup;
}

function pythonSteps(packageManager: PackageManager): string[] {
  if (!["uv", "poetry", "pip"].includes(packageManager)) {
    return [];
  }

  const steps = [
    "- name: Set up Python",
    `  uses: ${SETUP_PYTHON_REF}`,
    "  with:",
    '    python-version: "3.13"',
  ];

  if (packageManager === "uv") {
    steps.push("- name: Install uv", `  uses: ${SETUP_UV_REF}`);
  } else if (packageManager === "poetry") {
    steps.push("- name: Install Poetry", "  run: pipx install poetry");
  }

  steps.push(
    "- name: Install Python dependencies",
    `  run: ${packageManagerInstallCommand(packageManager)}`,
  );

  return steps;
}

export function generateRecommendedWorkflow(
  policy: Policy,
  packageManagers: readonly PackageManager[],
): string {
  const selectedManagers = packageManagers.filter((manager, index, values) => {
    const group = ["npm", "pnpm", "yarn"].includes(manager) ? "node" : "python";
    return (
      values.findIndex((candidate) =>
        group === "node"
          ? ["npm", "pnpm", "yarn"].includes(candidate)
          : ["uv", "poetry", "pip"].includes(candidate),
      ) === index
    );
  });

  const setupSteps = selectedManagers.flatMap((manager) => [
    ...nodeSteps(manager),
    ...pythonSteps(manager),
  ]);

  const steps = ["- name: Checkout repository", `  uses: ${CHECKOUT_REF}`, ...setupSteps];

  return [
    'name: "Copilot Setup Steps"',
    "",
    "on:",
    "  workflow_dispatch:",
    "  push:",
    "    paths:",
    `      - "${WORKFLOW_PATH}"`,
    "      - package.json",
    "      - package-lock.json",
    "      - pnpm-lock.yaml",
    "      - yarn.lock",
    "      - pyproject.toml",
    "      - uv.lock",
    "      - poetry.lock",
    "      - requirements.txt",
    "  pull_request:",
    "    paths:",
    `      - "${WORKFLOW_PATH}"`,
    "      - package.json",
    "      - package-lock.json",
    "      - pnpm-lock.yaml",
    "      - yarn.lock",
    "      - pyproject.toml",
    "      - uv.lock",
    "      - poetry.lock",
    "      - requirements.txt",
    "",
    "jobs:",
    "  copilot-setup-steps:",
    `    runs-on: ${policy.allowedRunners[0]}`,
    `    timeout-minutes: ${Math.min(policy.maxTimeoutMinutes, 30)}`,
    "    permissions:",
    "      contents: read",
    "    steps:",
    ...indent(steps, 6),
    "",
  ].join("\n");
}

export function createMissingWorkflowPatch(
  policy: Policy,
  packageManagers: readonly PackageManager[],
): PatchProposal {
  return {
    path: WORKFLOW_PATH,
    operation: "create",
    description: "Create a deterministic Copilot coding-agent setup workflow.",
    content: generateRecommendedWorkflow(policy, packageManagers),
  };
}
