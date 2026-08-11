interface PermissionNoticeProps {
  compact?: boolean;
  privacyHref?: string;
}

export function PermissionNotice({
  compact = false,
  privacyHref = "/privacy",
}: PermissionNoticeProps) {
  return (
    <section
      className={`permission-card${compact ? " permission-card-compact" : ""}`}
      aria-labelledby="permission-heading"
    >
      <div className="permission-intro">
        <p className="eyebrow">Permission and privacy boundary</p>
        <h2 id="permission-heading">Read-only access, minimal retention</h2>
        <p>
          SetupStepsGuardian reads only what it needs to assess selected Copilot setup workflows. It
          cannot push commits, edit settings, merge pull requests, or rerun workflows.
        </p>
      </div>

      <dl className="permission-list">
        <div>
          <dt>Repository metadata</dt>
          <dd>Read names, visibility, and default branches for repositories you select.</dd>
        </div>
        <div>
          <dt>Workflow contents</dt>
          <dd>Read the selected setup workflow long enough to validate its configuration.</dd>
        </div>
        <div>
          <dt>Actions evidence</dt>
          <dd>Read run conclusions and timing without retaining workflow logs.</dd>
        </div>
      </dl>

      <p className="privacy-boundary">
        <span>
          <strong>Not retained:</strong> raw source files, workflow logs, GitHub access tokens, or
          payment information. Derived repository status and evidence metadata may be retained to
          operate the dashboard.
        </span>
        <a className="text-link" href={privacyHref}>
          Read the privacy notice
        </a>
      </p>
    </section>
  );
}
