import type { Finding, ValidationResult } from "@setup-fleet/contracts";
import { validateSetupWorkflow } from "@setup-fleet/policy-engine";
import { readRepositoryMetadata, readWorkspaceFile } from "./files.js";

interface AnnotationProperties {
  readonly file?: string;
  readonly startLine?: number;
  readonly title?: string;
}

interface SummaryTableCell {
  readonly data: string;
  readonly header?: boolean;
}

interface ActionSummary {
  addHeading(text: string, level?: number): ActionSummary;
  addRaw(text: string, addEol?: boolean): ActionSummary;
  addTable(rows: readonly (readonly (string | SummaryTableCell)[])[]): ActionSummary;
  addDetails(label: string, content: string): ActionSummary;
  write(): Promise<ActionSummary>;
}

export interface ActionCore {
  readonly summary: ActionSummary;
  getInput(name: string, options?: { required?: boolean; trimWhitespace?: boolean }): string;
  getBooleanInput(name: string): boolean;
  setOutput(name: string, value: unknown): void;
  setFailed(message: string | Error): void;
  error(message: string | Error, properties?: AnnotationProperties): void;
  warning(message: string | Error, properties?: AnnotationProperties): void;
  notice(message: string | Error, properties?: AnnotationProperties): void;
}

export interface ActionEnvironment {
  readonly workspace: string;
}

function annotationProperties(finding: Finding): AnnotationProperties {
  return {
    file: finding.path,
    title: `${finding.code}: ${finding.title}`,
    ...(finding.line === undefined ? {} : { startLine: finding.line }),
  };
}

function emitFinding(core: ActionCore, finding: Finding): void {
  const message = `${finding.message} ${finding.remediation}`;
  const properties = annotationProperties(finding);

  switch (finding.severity) {
    case "error":
      core.error(message, properties);
      return;
    case "warning":
      core.warning(message, properties);
      return;
    case "info":
      core.notice(message, properties);
  }
}

function countFindings(result: ValidationResult): { errors: number; warnings: number } {
  return result.findings.reduce(
    (counts, finding) => ({
      errors: counts.errors + (finding.severity === "error" ? 1 : 0),
      warnings: counts.warnings + (finding.severity === "warning" ? 1 : 0),
    }),
    { errors: 0, warnings: 0 },
  );
}

async function writeSummary(
  core: ActionCore,
  result: ValidationResult,
  counts: { errors: number; warnings: number },
): Promise<void> {
  core.summary
    .addHeading("SetupStepsGuardian", 2)
    .addRaw(
      `Status: **${result.status.toUpperCase()}** · ${counts.errors} errors · ${counts.warnings} warnings`,
      true,
    );

  if (result.findings.length === 0) {
    core.summary.addRaw("The setup workflow satisfies the effective policy.", true);
  } else {
    core.summary.addTable([
      [
        { data: "Severity", header: true },
        { data: "Code", header: true },
        { data: "Finding", header: true },
      ],
      ...result.findings.map((finding) => [
        finding.severity,
        finding.code,
        `${finding.message} ${finding.remediation}`,
      ]),
    ]);
  }

  for (const patch of result.patches) {
    core.summary.addDetails(
      `${patch.operation === "create" ? "Create" : "Replace"} ${patch.path}`,
      `\`\`\`yaml\n${patch.content}\`\`\``,
    );
  }

  await core.summary.write();
}

export async function runAction(core: ActionCore, environment: ActionEnvironment): Promise<void> {
  const workflowPath =
    core.getInput("workflow-path") || ".github/workflows/copilot-setup-steps.yml";
  const policyPath = core.getInput("policy-path") || ".github/agent-setup-policy.yml";
  const failOnWarnings = core.getBooleanInput("fail-on-warnings");

  try {
    const [workflowContent, policyContent, files] = await Promise.all([
      readWorkspaceFile(environment.workspace, workflowPath),
      readWorkspaceFile(environment.workspace, policyPath),
      readRepositoryMetadata(environment.workspace),
    ]);

    const result = await validateSetupWorkflow({
      files,
      workflowPath,
      ...(workflowContent === undefined ? {} : { workflowContent }),
      ...(policyContent === undefined ? {} : { policyContent }),
    });
    const counts = countFindings(result);

    for (const finding of result.findings) {
      emitFinding(core, finding);
    }
    core.setOutput("status", result.status);
    core.setOutput("error-count", counts.errors);
    core.setOutput("warning-count", counts.warnings);
    core.setOutput("workflow-hash", result.workflowHash ?? "");
    core.setOutput("policy-hash", result.policyHash);
    core.setOutput("result-json", JSON.stringify(result));

    await writeSummary(core, result, counts);

    if (result.status === "invalid") {
      core.setFailed(`Setup workflow validation failed with ${counts.errors} error findings.`);
    } else if (failOnWarnings && counts.warnings > 0) {
      core.setFailed(`Setup workflow validation found ${counts.warnings} warning findings.`);
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error : new Error("Unexpected validation failure."));
  }
}
