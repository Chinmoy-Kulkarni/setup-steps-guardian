import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { REPOSITORY_INPUT_PATHS } from "@setup-fleet/policy-engine";

export const REPOSITORY_METADATA_FILES = REPOSITORY_INPUT_PATHS;

function isWithinWorkspace(workspace: string, candidate: string): boolean {
  const pathFromWorkspace = relative(workspace, candidate);
  return (
    pathFromWorkspace === "" ||
    (!pathFromWorkspace.startsWith(`..${sep}`) &&
      pathFromWorkspace !== ".." &&
      !isAbsolute(pathFromWorkspace))
  );
}

export function resolveWorkspacePath(workspace: string, path: string): string {
  if (path.trim().length === 0) {
    throw new Error("Repository paths must not be empty.");
  }
  if (isAbsolute(path)) {
    throw new Error(`Absolute repository path is not allowed: ${path}`);
  }

  const candidate = resolve(workspace, path);
  if (!isWithinWorkspace(resolve(workspace), candidate)) {
    throw new Error(`Repository path escapes GITHUB_WORKSPACE: ${path}`);
  }

  return candidate;
}

async function resolveRegularWorkspaceFile(
  workspace: string,
  path: string,
): Promise<string | undefined> {
  const resolvedWorkspace = await realpath(workspace);
  const candidate = resolveWorkspacePath(resolvedWorkspace, path);

  try {
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed for repository inputs: ${path}`);
    }

    const resolvedCandidate = await realpath(candidate);
    if (!isWithinWorkspace(resolvedWorkspace, resolvedCandidate)) {
      throw new Error(`Repository input resolves outside GITHUB_WORKSPACE: ${path}`);
    }

    if (!metadata.isFile()) {
      throw new Error(`Repository input is not a regular file: ${path}`);
    }

    return resolvedCandidate;
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function readWorkspaceFile(
  workspace: string,
  path: string,
): Promise<string | undefined> {
  const resolvedCandidate = await resolveRegularWorkspaceFile(workspace, path);
  return resolvedCandidate === undefined ? undefined : await readFile(resolvedCandidate, "utf8");
}

export async function readRepositoryMetadata(workspace: string): Promise<Record<string, string>> {
  const entries = await Promise.all(
    REPOSITORY_METADATA_FILES.map(async (path) => {
      const resolvedCandidate = await resolveRegularWorkspaceFile(workspace, path);
      return resolvedCandidate === undefined ? undefined : ([path, ""] as const);
    }),
  );

  return Object.fromEntries(entries.filter((entry) => entry !== undefined));
}
