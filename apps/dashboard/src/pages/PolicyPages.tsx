export function PrivacyPage() {
  return (
    <article className="content-shell narrow-shell policy-page">
      <title>Privacy | SetupStepsGuardian</title>
      <header className="policy-header">
        <p className="eyebrow">Public policy placeholder</p>
        <h1>Privacy</h1>
        <p>
          This plain-language notice describes the intended data boundary for the SetupStepsGuardian
          preview. A final legal notice and contact will be published before general availability.
        </p>
        <p className="policy-date">Last updated: August 10, 2026</p>
      </header>

      <section aria-labelledby="privacy-process-heading">
        <h2 id="privacy-process-heading">What the service processes</h2>
        <p>
          When an authorized GitHub user opens the dashboard, the service processes GitHub account
          and repository metadata, the selected Copilot setup workflow, and workflow run evidence
          needed to calculate repository status.
        </p>
      </section>

      <section aria-labelledby="privacy-retain-heading">
        <h2 id="privacy-retain-heading">What may be retained</h2>
        <p>
          The service may retain derived validation findings, workflow and policy hashes, run
          conclusions, timestamps, and repository identifiers so the fleet view can operate. This is
          status metadata rather than repository source or run output.
        </p>
      </section>

      <section aria-labelledby="privacy-never-heading">
        <h2 id="privacy-never-heading">What is not retained</h2>
        <ul>
          <li>Raw repository source files or raw setup workflow contents</li>
          <li>GitHub Actions workflow logs</li>
          <li>GitHub installation or user access tokens</li>
          <li>Payment card details or other payment information</li>
        </ul>
        <p>
          Workflow contents and access credentials may be handled transiently to fulfill an
          authorized request, then discarded. The preview does not use retained tokens or raw source
          as a product data store.
        </p>
      </section>

      <section aria-labelledby="privacy-control-heading">
        <h2 id="privacy-control-heading">Access and control</h2>
        <p>
          Repository access is limited by the repositories selected for the GitHub installation. An
          organization owner can change or revoke that access in GitHub App settings. A deletion and
          privacy contact will be listed on the support page before general availability.
        </p>
      </section>

      <section aria-labelledby="privacy-third-heading">
        <h2 id="privacy-third-heading">Service providers</h2>
        <p>
          GitHub supplies repository and Actions data under its own terms. Hosting infrastructure
          may process requests and derived metadata on behalf of the service. The final notice will
          identify applicable providers and retention periods.
        </p>
      </section>
    </article>
  );
}

export function TermsPage() {
  return (
    <article className="content-shell narrow-shell policy-page">
      <title>Terms | SetupStepsGuardian</title>
      <header className="policy-header">
        <p className="eyebrow">Public terms placeholder</p>
        <h1>Terms of use</h1>
        <p>
          These preview terms set clear operating expectations while final legal terms are being
          prepared. Using the preview means you accept these limitations.
        </p>
        <p className="policy-date">Last updated: August 10, 2026</p>
      </header>

      <section aria-labelledby="terms-purpose-heading">
        <h2 id="terms-purpose-heading">Informational, read-only service</h2>
        <p>
          SetupStepsGuardian reports deterministic policy findings and available run evidence. It
          does not modify repositories, approve changes, guarantee a development environment, or
          replace GitHub branch protection, CI, security review, or maintainer judgment.
        </p>
      </section>

      <section aria-labelledby="terms-access-heading">
        <h2 id="terms-access-heading">Authorized access</h2>
        <p>
          You must have authority to connect the selected GitHub account and repositories. Do not
          attempt to access data outside the installation scope, interfere with the service, or use
          it unlawfully.
        </p>
      </section>

      <section aria-labelledby="terms-availability-heading">
        <h2 id="terms-availability-heading">Availability and support</h2>
        <p>
          The preview is provided as available, without warranties or a service-level agreement.
          There is no uptime, response-time, data-recovery, or support SLA. Features may change or
          be suspended, and maintainers should keep their own authoritative repository records.
        </p>
      </section>

      <section aria-labelledby="terms-liability-heading">
        <h2 id="terms-liability-heading">Decisions remain yours</h2>
        <p>
          Findings can be incomplete when GitHub data is delayed, unavailable, or outside the
          configured policy. Review source configuration and GitHub Actions evidence before making
          operational decisions.
        </p>
      </section>
    </article>
  );
}

export function SupportPage() {
  return (
    <div className="content-shell narrow-shell policy-page support-page">
      <title>Support | SetupStepsGuardian</title>
      <header className="policy-header">
        <p className="eyebrow">Self-service support</p>
        <h1>Support</h1>
        <p>
          Use the public issue tracker for product support without including repository source,
          workflow logs, credentials, signatures, cookies, or payment details.
        </p>
      </header>

      <section className="support-card" aria-labelledby="support-now-heading">
        <h2 id="support-now-heading">What you can do now</h2>
        <ul>
          <li>
            Retry a failed fleet request. Temporary GitHub or service errors can resolve without a
            configuration change.
          </li>
          <li>
            Ask the GitHub App installer to confirm repository selection and organization policy.
          </li>
          <li>Revoke the installation from GitHub settings if access should stop immediately.</li>
          <li>
            Use the dashboard account control to delete retained metadata. An active Paddle
            subscription is canceled immediately before deletion.
          </li>
        </ul>
        <p>
          <a className="text-link" href="https://github.com/settings/installations">
            Open GitHub App settings
            <span className="visually-hidden"> on GitHub</span>
          </a>
        </p>
        <p>
          <a
            className="text-link"
            href="https://github.com/Chinmoy-Kulkarni/setup-steps-guardian/issues"
          >
            Open the public support issue tracker
          </a>
        </p>
      </section>

      <section aria-labelledby="support-expectations-heading">
        <h2 id="support-expectations-heading">Support expectations</h2>
        <p>
          The preview has no service-level agreement or guaranteed response time. Do not submit
          repository source, workflow logs, GitHub tokens, secrets, or payment details in a support
          request. SetupStepsGuardian does not retain those data categories as part of the
          dashboard.
        </p>
      </section>
    </div>
  );
}
