import { PermissionNotice } from "../components/PermissionNotice";
import { PricingPlanCards } from "../components/PricingPlanCards";

interface LandingPageProps {
  sessionState?: "new" | "required";
  publicPreview?: boolean;
}

const GITHUB_SIGN_IN_URL = "/api/auth/github?return_to=%2F";
const ACTION_SETUP_URL = "https://github.com/Chinmoy-Kulkarni/setup-steps-guardian#use-the-action";
const DISCUSSION_URL = "https://github.com/Chinmoy-Kulkarni/setup-steps-guardian/discussions/4";
const PRIVACY_URL = "https://github.com/Chinmoy-Kulkarni/setup-steps-guardian/blob/main/PRIVACY.md";

export function LandingPage({ sessionState = "new", publicPreview = false }: LandingPageProps) {
  const sessionRequired = sessionState === "required";

  return (
    <div className="content-shell landing-page">
      <title>
        {sessionRequired
          ? "Sign in | SetupStepsGuardian"
          : "SetupStepsGuardian | Copilot setup fleet assurance"}
      </title>
      <meta
        name="description"
        content="Prioritize GitHub Copilot setup workflow fixes with deterministic status and run evidence across selected repositories."
      />

      <section className="hero" aria-labelledby="landing-heading">
        <div className="hero-copy">
          <p className="eyebrow">Read-only fleet assurance</p>
          <h1 id="landing-heading">Know which setup workflows need attention.</h1>
          <p className="hero-summary">
            SetupStepsGuardian combines deterministic Copilot setup workflow checks with GitHub
            Actions evidence, then turns selected repositories into a focused fix-first queue.
          </p>

          {publicPreview ? (
            <div className="session-notice" role="status">
              <strong>The GitHub Action is live; the hosted dashboard is pre-launch.</strong>
              <span>
                Install the free repository check now or join the public launch discussion to
                request fleet-dashboard access.
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
              href={publicPreview ? DISCUSSION_URL : "#how-it-works"}
            >
              {publicPreview ? "Request dashboard access" : "See the 3-step setup"}
            </a>
          </div>
          <p className="hero-footnote" id="sign-in-boundary">
            {publicPreview
              ? "The public Action is ready today. Hosted sign-in and paid checkout remain disabled until production account setup is complete."
              : "Signing in does not change repository access. A GitHub App installer chooses the repositories, and app permissions remain read-only."}
          </p>
        </div>

        <aside className="decision-preview" aria-labelledby="preview-heading">
          <p className="preview-label">A decision queue, not another chart</p>
          <h2 id="preview-heading">Answer three questions quickly</h2>
          <ol>
            <li>
              <span aria-hidden="true">01</span>
              Which repositories are passing now?
            </li>
            <li>
              <span aria-hidden="true">02</span>
              Which workflows are missing, invalid, or drifting?
            </li>
            <li>
              <span aria-hidden="true">03</span>
              Where is run evidence failing, stale, or not yet proven?
            </li>
          </ol>
        </aside>
      </section>

      <ul className="trust-strip" aria-label="Product boundaries">
        <li>
          <strong>Deterministic</strong>
          <span>Stable finding codes and remediation, with no LLM involved.</span>
        </li>
        <li>
          <strong>GitHub-scoped</strong>
          <span>Only repositories selected for the installation are assessed.</span>
        </li>
        <li>
          <strong>No write path</strong>
          <span>No commits, settings changes, merges, or workflow reruns.</span>
        </li>
      </ul>

      <section
        className="onboarding-section"
        id="how-it-works"
        aria-labelledby="onboarding-heading"
      >
        <div className="section-intro">
          <p className="eyebrow">From sign-in to first decision</p>
          <h2 id="onboarding-heading">Three explicit steps</h2>
          <p>GitHub remains the source of truth for identity, installation scope, and run data.</p>
        </div>

        <ol className="setup-steps">
          <li>
            <span className="step-number" aria-hidden="true">
              1
            </span>
            <div>
              <h3>Sign in with GitHub</h3>
              <p>Identify your user and the GitHub App installations you can access.</p>
            </div>
          </li>
          <li>
            <span className="step-number" aria-hidden="true">
              2
            </span>
            <div>
              <h3>Choose repository scope</h3>
              <p>
                Install the read-only app if needed, then select only the repositories to assess.
              </p>
            </div>
          </li>
          <li>
            <span className="step-number" aria-hidden="true">
              3
            </span>
            <div>
              <h3>Work the queue</h3>
              <p>
                Filter by status, inspect the evidence, and follow the repository-level next step.
              </p>
            </div>
          </li>
        </ol>

        <aside className="action-bridge" aria-labelledby="action-bridge-heading">
          <div>
            <p className="eyebrow">Action + dashboard</p>
            <h3 id="action-bridge-heading">Keep validation in CI; add a fleet-wide view.</h3>
            <p>
              The GitHub Action validates a repository during CI. The dashboard adds selected-fleet
              inventory and qualifying run evidence without replacing that repository check.
            </p>
          </div>
          <a className="button button-secondary" href={ACTION_SETUP_URL}>
            Review Action setup on GitHub
          </a>
        </aside>
      </section>

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
              {publicPreview
                ? "Hosted checkout is not open yet. Join the launch discussion to request early access without sharing private repository data."
                : "Paid checkout is available to the GitHub App installer after sign-in and is handled by Paddle."}
            </span>
          </div>
          <a
            className="button button-primary"
            href={publicPreview ? DISCUSSION_URL : GITHUB_SIGN_IN_URL}
          >
            {publicPreview ? "Request early access" : "Start with Free"}
          </a>
        </div>
      </section>

      <PermissionNotice privacyHref={publicPreview ? PRIVACY_URL : "/privacy"} />
    </div>
  );
}
