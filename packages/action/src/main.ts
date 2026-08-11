import * as core from "@actions/core";
import { runAction } from "./run.js";

async function main(): Promise<void> {
  const workspace = process.env.GITHUB_WORKSPACE;

  if (workspace === undefined || workspace.length === 0) {
    core.setFailed("GITHUB_WORKSPACE is not set.");
    return;
  }

  await runAction(core, { workspace });
}

void main().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error : new Error("Unexpected Action failure."));
});
