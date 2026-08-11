export type PackageManager = "npm" | "pnpm" | "yarn" | "uv" | "poetry" | "pip";

export interface DetectionResult {
  readonly packageManagers: readonly PackageManager[];
  readonly ambiguousGroups: readonly string[];
  readonly missingLockfiles: readonly string[];
}

export const REPOSITORY_INPUT_PATHS = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "pyproject.toml",
  "uv.lock",
  "poetry.lock",
  "requirements.txt",
] as const;

const ROOT_FILES = {
  npm: ["package-lock.json", "npm-shrinkwrap.json"],
  pnpm: ["pnpm-lock.yaml"],
  yarn: ["yarn.lock"],
  uv: ["uv.lock"],
  poetry: ["poetry.lock"],
  pip: ["requirements.txt"],
} as const satisfies Record<PackageManager, readonly string[]>;

const NODE_MANAGERS = new Set<PackageManager>(["npm", "pnpm", "yarn"]);
const PYTHON_MANAGERS = new Set<PackageManager>(["uv", "poetry", "pip"]);

function hasFile(files: Readonly<Record<string, string>>, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => Object.hasOwn(files, candidate));
}

export function detectPackageManagers(files: Readonly<Record<string, string>>): DetectionResult {
  const packageManagers = (Object.keys(ROOT_FILES) as PackageManager[]).filter((manager) =>
    hasFile(files, ROOT_FILES[manager]),
  );

  const nodeManagers = packageManagers.filter((manager) => NODE_MANAGERS.has(manager));
  const pythonManagers = packageManagers.filter((manager) => PYTHON_MANAGERS.has(manager));

  const ambiguousGroups: string[] = [];
  if (nodeManagers.length > 1) {
    ambiguousGroups.push("node");
  }
  if (pythonManagers.length > 1) {
    ambiguousGroups.push("python");
  }

  const missingLockfiles: string[] = [];
  if (Object.hasOwn(files, "package.json") && nodeManagers.length === 0) {
    missingLockfiles.push("node");
  }
  if (Object.hasOwn(files, "pyproject.toml") && pythonManagers.length === 0) {
    missingLockfiles.push("python");
  }

  return {
    packageManagers,
    ambiguousGroups,
    missingLockfiles,
  };
}

export function packageManagerInstallCommand(packageManager: PackageManager): string {
  switch (packageManager) {
    case "npm":
      return "npm ci";
    case "pnpm":
      return "pnpm install --frozen-lockfile";
    case "yarn":
      return "yarn install --immutable";
    case "uv":
      return "uv sync --frozen";
    case "poetry":
      return "poetry install --no-interaction";
    case "pip":
      return "python -m pip install -r requirements.txt";
  }
}

export function packageManagerCommandMatches(
  packageManager: PackageManager,
  runCommands: string,
): boolean {
  switch (packageManager) {
    case "npm":
      return /\bnpm\s+ci\b/.test(runCommands);
    case "pnpm":
      return (
        /\bpnpm\s+(?:install|i)\b/.test(runCommands) && /--frozen-lockfile\b/.test(runCommands)
      );
    case "yarn":
      return (
        /\byarn\s+install\b/.test(runCommands) &&
        /--(?:immutable|frozen-lockfile)\b/.test(runCommands)
      );
    case "uv":
      return /\buv\s+sync\b/.test(runCommands) && /--frozen\b/.test(runCommands);
    case "poetry":
      return /\bpoetry\s+install\b/.test(runCommands);
    case "pip":
      return /(?:\bpython(?:3)?\s+-m\s+pip|\bpip(?:3)?)\s+install\b[^;\n]*\s-r\s+requirements\.txt\b/.test(
        runCommands,
      );
  }
}
