interface PermissionNoticeProps {
  compact?: boolean;
  privacyHref?: string;
  publicAction?: boolean;
}

export function PermissionNotice({
  compact = false,
  privacyHref = "/privacy",
  publicAction = false,
}: PermissionNoticeProps) {
  return (
    <section
      className={`permission-card${compact ? " permission-card-compact" : ""}`}
      aria-labelledby="permission-heading"
    >
      <div className="permission-intro">
        <p className="eyebrow">
          {publicAction ? "Action privacy boundary" : "Permission and privacy boundary"}
        </p>
        <h2 id="permission-heading">
          {publicAction
            ? "Runs in your repository, sends nothing back"
            : "Read-only access, minimal retention"}
        </h2>
        <p>
          {publicAction
            ? "The public Action reads local workflow and policy inputs inside its GitHub Actions job. It does not call a SetupStepsGuardian service."
            : "SetupStepsGuardian reads only what it needs to assess selected Copilot setup workflows. It cannot push commits, edit settings, merge pull requests, or rerun workflows."}
        </p>
      </div>

      <dl className="permission-list">
        <div>
          <dt>{publicAction ? "Workspace inputs" : "Repository metadata"}</dt>
          <dd>
            {publicAction
              ? "Read the setup workflow, optional policy, and supported root manifest or lockfile names."
              : "Read names, visibility, and default branches for repositories you select."}
          </dd>
        </div>
        <div>
          <dt>{publicAction ? "Local outputs" : "Workflow contents"}</dt>
          <dd>
            {publicAction
              ? "Write annotations, a job summary, stable output values, and normalized JSON to the same job."
              : "Read the selected setup workflow long enough to validate its configuration."}
          </dd>
        </div>
        <div>
          <dt>{publicAction ? "Network transmission" : "Actions evidence"}</dt>
          <dd>
            {publicAction
              ? "Send no workflow content, findings, hashes, or run telemetry to SetupStepsGuardian."
              : "Read run conclusions and timing without retaining workflow logs."}
          </dd>
        </div>
      </dl>

      <p className="privacy-boundary">
        <span>
          {publicAction ? (
            <>
              <strong>Not collected:</strong> source files, workflow content, findings, tokens, or
              usage telemetry.
            </>
          ) : (
            <>
              <strong>Not retained:</strong> raw source files, workflow logs, GitHub access tokens,
              or payment information. Derived repository status and evidence metadata may be
              retained to operate the dashboard.
            </>
          )}
        </span>
        <a className="text-link" href={privacyHref}>
          Read the privacy notice
        </a>
      </p>
    </section>
  );
}
