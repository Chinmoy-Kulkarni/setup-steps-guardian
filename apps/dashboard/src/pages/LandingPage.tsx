import { PermissionNotice } from "../components/PermissionNotice";
import { PricingPlanCards } from "../components/PricingPlanCards";

interface LandingPageProps {
  sessionState?: "new" | "required";
  publicPreview?: boolean;
}

const GITHUB_SIGN_IN_URL = "/api/auth/github?return_to=%2F";
const ACTION_SETUP_URL = "https://github.com/Chinmoy-Kulkarni/setup-steps-guardian#use-the-action";
const EVIDENCE_URL =
  "https://github.com/Chinmoy-Kulkarni/setup-steps-guardian/blob/main/docs/evidence.md";
const USEFULNESS_URL = "https://github.com/Chinmoy-Kulkarni/setup-steps-guardian/discussions/5";
const CONTRIBUTING_URL =
  "https://github.com/Chinmoy-Kulkarni/setup-steps-guardian/blob/main/CONTRIBUTING.md";
const PRIVACY_URL = "https://github.com/Chinmoy-Kulkarni/setup-steps-guardian/blob/main/PRIVACY.md";

export function LandingPage({ sessionState = "new", publicPreview = false }: LandingPageProps) {
  const sessionRequired = sessionState === "required";

  return (
    <div className="content-shell landing-page">
      <title>
        {publicPreview
          ? "SetupStepsGuardian | Open-source Copilot setup validation"
          : sessionRequired
            ? "Sign in | SetupStepsGuardian"
            : "SetupStepsGuardian | Copilot setup fleet assurance"}
      </title>
      <meta
        name="description"
        content={
          publicPreview
            ? "Open-source deterministic validation for GitHub Copilot setup workflows, with published evidence and no Action telemetry."
            : "Prioritize GitHub Copilot setup workflow fixes with deterministic status and run evidence across selected repositories."
        }
      />

      <section className="hero" aria-labelledby="landing-heading">
        <div className="hero-copy">
          <p className="eyebrow">
            {publicPreview ? "Open-source GitHub Action" : "Read-only fleet assurance"}
          </p>
          <h1 id="landing-heading">
            {publicPreview
              ? "Catch Copilot setup mistakes before the agent does."
              : "Know which setup workflows need attention."}
          </h1>
          <p className="hero-summary">
            {publicPreview
              ? "Validate GitHub's special setup-workflow contract, dependency readiness, and security hardening with stable findings and no telemetry."
              : "SetupStepsGuardian combines deterministic Copilot setup workflow checks with GitHub Actions evidence, then turns selected repositories into a focused fix-first queue."}
          </p>

          {publicPreview ? (
            <div className="session-notice" role="status">
              <strong>The Action and its evidence are public.</strong>
              <span>
                The 100-workflow study found five human-confirmed contract errors. The bounded
                baseline observed no public adoption evidence, and this site says so plainly.
              </span>
            </div>
          ) : sessionRequired ? (
            <div className="session-notice" role="status">
              <strong>Sign in to open your dashboard.</strong>
              <span>
                No active dashboard session was found. Your GitHub repository settings are
                unchanged.
              </span>
            </div>
          ) : null}

          <div className="hero-actions">
            <a
              className="button button-primary"
              href={publicPreview ? ACTION_SETUP_URL : GITHUB_SIGN_IN_URL}
            >
              {publicPreview ? "Install the GitHub Action" : "Sign in with GitHub"}
            </a>
            <a
              className="button button-secondary"
              href={publicPreview ? EVIDENCE_URL : "#how-it-works"}
            >
              {publicPreview ? "Review the public evidence" : "See the 3-step setup"}
            </a>
          </div>
          <p className="hero-footnote" id="sign-in-boundary">
            {publicPreview
              ? "No workflow content or Action-run telemetry is sent to SetupStepsGuardian. Hosted sign-in and checkout are deferred."
              : "Signing in does not change repository access. A GitHub App installer chooses the repositories, and app permissions remain read-only."}
          </p>
        </div>

        <aside className="decision-preview" aria-labelledby="preview-heading">
          <p className="preview-label">
            {publicPreview ? "Measured, not marketed" : "A decision queue, not another chart"}
          </p>
          <h2 id="preview-heading">
            {publicPreview ? "What the evidence says today" : "Answer three questions quickly"}
          </h2>
          <ol>
            <li>
              <span aria-hidden="true">01</span>
              {publicPreview
                ? "873 public exact-path workflows directly observed"
                : "Which repositories are passing now?"}
            </li>
            <li>
              <span aria-hidden="true">02</span>
              {publicPreview
                ? "100 exact paths validated reproducibly"
                : "Which workflows are missing, invalid, or drifting?"}
            </li>
            <li>
              <span aria-hidden="true">03</span>
              {publicPreview
                ? "5 contract errors confirmed by human review"
                : "Where is run evidence failing, stale, or not yet proven?"}
            </li>
          </ol>
        </aside>
      </section>

      <ul className="trust-strip" aria-label="Product boundaries">
        <li>
          <strong>{publicPreview ? "MIT licensed" : "Deterministic"}</strong>
          <span>
            {publicPreview
              ? "Inspect, fork, and improve the validator in public."
              : "Stable finding codes and remediation, with no LLM involved."}
          </span>
        </li>
        <li>
          <strong>{publicPreview ? "No telemetry" : "GitHub-scoped"}</strong>
          <span>
            {publicPreview
              ? "The Action does not send workflow content or findings to a service."
              : "Only repositories selected for the installation are assessed."}
          </span>
        </li>
        <li>
          <strong>{publicPreview ? "Evidence first" : "No write path"}</strong>
          <span>
            {publicPreview
              ? "Corpus results, limitations, and the bounded adoption baseline are published."
              : "No commits, settings changes, merges, or workflow reruns."}
          </span>
        </li>
      </ul>

      <section
        className="onboarding-section"
        id="how-it-works"
        aria-labelledby="onboarding-heading"
      >
        <div className="section-intro">
          <p className="eyebrow">
            {publicPreview ? "From install to evidence" : "From sign-in to first decision"}
          </p>
          <h2 id="onboarding-heading">
            {publicPreview ? "Use it without giving up repository data" : "Three explicit steps"}
          </h2>
          <p>
            {publicPreview
              ? "Validation runs inside your GitHub Actions job and emits stable local findings."
              : "GitHub remains the source of truth for identity, installation scope, and run data."}
          </p>
        </div>

        <ol className="setup-steps">
          <li>
            <span className="step-number" aria-hidden="true">
              1
            </span>
            <div>
              <h3>{publicPreview ? "Add the Action" : "Sign in with GitHub"}</h3>
              <p>
                {publicPreview
                  ? "Pin the reviewed Action commit in a workflow that watches setup and lockfile changes."
                  : "Identify your user and the GitHub App installations you can access."}
              </p>
            </div>
          </li>
          <li>
            <span className="step-number" aria-hidden="true">
              2
            </span>
            <div>
              <h3>{publicPreview ? "Review deterministic findings" : "Choose repository scope"}</h3>
              <p>
                {publicPreview
                  ? "Separate contract errors from policy and hardening warnings using stable codes."
                  : "Install the read-only app if needed, then select only the repositories to assess."}
              </p>
            </div>
          </li>
          <li>
            <span className="step-number" aria-hidden="true">
              3
            </span>
            <div>
              <h3>{publicPreview ? "Report the outcome" : "Work the queue"}</h3>
              <p>
                {publicPreview
                  ? "Share only finding codes and a redacted result so usefulness can be measured honestly."
                  : "Filter by status, inspect the evidence, and follow the repository-level next step."}
              </p>
            </div>
          </li>
        </ol>

        <aside className="action-bridge" aria-labelledby="action-bridge-heading">
          <div>
            <p className="eyebrow">{publicPreview ? "Open research" : "Action + dashboard"}</p>
            <h3 id="action-bridge-heading">
              {publicPreview
                ? "Reproduce the study or challenge a finding."
                : "Keep validation in CI; add a fleet-wide view."}
            </h3>
            <p>
              {publicPreview
                ? "The census script, normalized records, immutable source links, and limitations are committed. Raw third-party workflows are not."
                : "The GitHub Action validates a repository during CI. The dashboard adds selected-fleet inventory and qualifying run evidence without replacing that repository check."}
            </p>
          </div>
          <a
            className="button button-secondary"
            href={publicPreview ? CONTRIBUTING_URL : ACTION_SETUP_URL}
          >
            {publicPreview ? "Read the contribution guide" : "Review Action setup on GitHub"}
          </a>
        </aside>
      </section>

      {publicPreview ? (
        <section
          className="pricing-section landing-pricing"
          id="evidence"
          aria-labelledby="evidence-heading"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Published baseline</p>
              <h2 id="evidence-heading">Three numbers, three different claims</h2>
            </div>
            <p>Problem size, validator usefulness, and product adoption are measured separately.</p>
          </div>

          <div className="pricing-grid">
            <article className="pricing-card">
              <p className="preview-label">Problem surface</p>
              <h3>873+ public workflows</h3>
              <p>Directly observed across ten result pages; still a lower bound.</p>
            </article>
            <article className="pricing-card featured-plan">
              <p className="preview-label">Human-reviewed study</p>
              <h3>5 of 100 invalid</h3>
              <p>All five error-level results were confirmed against immutable source.</p>
            </article>
            <article className="pricing-card">
              <p className="preview-label">Public adoption</p>
              <h3>0 confirmed reports</h3>
              <p>
                No indexed direct-workflow references in the first 100 search items or voluntary
                usefulness reports were observed at baseline.
              </p>
            </article>
          </div>

          <div className="pricing-cta">
            <div>
              <strong>Used it? Add evidence, not marketing.</strong>
              <span>Report finding codes, accuracy, and the redacted outcome.</span>
            </div>
            <a className="button button-primary" href={USEFULNESS_URL}>
              Report a validation outcome
            </a>
          </div>
        </section>
      ) : (
        <section
          className="pricing-section landing-pricing"
          id="pricing"
          aria-labelledby="pricing-heading"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Plans</p>
              <h2 id="pricing-heading">Pricing by private repository capacity</h2>
            </div>
            <p>
              Every plan includes selected public repositories and the same deterministic status and
              run-evidence view.
            </p>
          </div>

          <PricingPlanCards />

          <div className="pricing-cta">
            <div>
              <strong>Start with five selected private repositories.</strong>
              <span>
                Paid checkout is available to the GitHub App installer after sign-in and is handled
                by Paddle.
              </span>
            </div>
            <a className="button button-primary" href={GITHUB_SIGN_IN_URL}>
              Start with Free
            </a>
          </div>
        </section>
      )}

      <PermissionNotice
        privacyHref={publicPreview ? PRIVACY_URL : "/privacy"}
        publicAction={publicPreview}
      />
    </div>
  );
}
