import type {
  AuthorizedAccount,
  FleetSummary,
  RepositoryDetail as RepositoryDetailContract,
  RepositorySetupStatus,
  RepositorySummary,
  SessionResponse,
} from "@setup-fleet/contracts";
import { type RefObject, useEffect, useRef, useState } from "react";
import {
  ApiError,
  createCheckout,
  deleteAccount,
  getFleet,
  getRepositoryDetail,
  getSession,
  isAbortError,
  logout,
  requestRepositoryScan,
} from "../api";
import { PermissionNotice } from "../components/PermissionNotice";
import { PricingPlanCards } from "../components/PricingPlanCards";
import { SETUP_STATUSES, STATUS_METADATA } from "../status";
import { LandingPage } from "./LandingPage";

type FleetLoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; fleet: FleetSummary }
  | { kind: "error"; error: ApiError };

type SessionLoadState =
  | { kind: "loading" }
  | { kind: "loaded"; session: SessionResponse }
  | { kind: "error"; error: ApiError };

type StatusFilter = "all" | RepositorySetupStatus;

type AccountAction =
  | { kind: "idle" }
  | { kind: "checkout"; plan: "team" | "fleet" }
  | { kind: "logout" }
  | { kind: "delete" }
  | { kind: "error"; message: string };

const evidenceDateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function DashboardPage() {
  const [requestVersion, setRequestVersion] = useState(0);
  const [sessionState, setSessionState] = useState<SessionLoadState>({
    kind: "loading",
  });
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<FleetLoadState>({ kind: "idle" });

  useEffect(() => {
    const controller = new AbortController();
    setSessionState({ kind: "loading" });

    void getSession({ signal: controller.signal })
      .then((session) => {
        setSessionState({ kind: "loaded", session });
        setSelectedAccountId((current) =>
          session.accounts.some((account) => account.accountId === current)
            ? current
            : (session.accounts[0]?.accountId ?? null),
        );
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) {
          return;
        }
        setSessionState({
          kind: "error",
          error:
            error instanceof ApiError
              ? error
              : new ApiError("An unexpected session error occurred.", {
                  kind: "network",
                  cause: error,
                }),
        });
      });

    return () => controller.abort();
  }, []);

  // requestVersion is an explicit refresh trigger for this request lifecycle.
  // biome-ignore lint/correctness/useExhaustiveDependencies: The refresh token intentionally reruns the effect.
  useEffect(() => {
    if (selectedAccountId === null) {
      setLoadState({ kind: "idle" });
      return;
    }

    const controller = new AbortController();
    setLoadState({ kind: "loading" });

    void getFleet(selectedAccountId, { signal: controller.signal })
      .then((fleet) => {
        setLoadState({ kind: "loaded", fleet });
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) {
          return;
        }

        setLoadState({
          kind: "error",
          error:
            error instanceof ApiError
              ? error
              : new ApiError("An unexpected dashboard error occurred.", {
                  kind: "network",
                  cause: error,
                }),
        });
      });

    return () => {
      controller.abort();
    };
  }, [requestVersion, selectedAccountId]);

  if (sessionState.kind === "loading") {
    return <FleetLoadingState />;
  }

  if (
    sessionState.kind === "error" &&
    sessionState.error.kind === "http" &&
    sessionState.error.status === 401
  ) {
    return <LandingPage sessionState="required" />;
  }

  if (sessionState.kind === "error") {
    return <FleetErrorState error={sessionState.error} onRetry={() => window.location.reload()} />;
  }

  if (sessionState.session.accounts.length === 0) {
    return <NoInstalledAccountsState />;
  }

  const selectedAccount =
    sessionState.session.accounts.find((account) => account.accountId === selectedAccountId) ??
    sessionState.session.accounts[0];
  if (selectedAccount === undefined || loadState.kind === "idle" || loadState.kind === "loading") {
    return <FleetLoadingState />;
  }

  if (
    loadState.kind === "error" &&
    loadState.error.kind === "http" &&
    loadState.error.status === 401
  ) {
    return <LandingPage sessionState="required" />;
  }

  if (loadState.kind === "error") {
    return (
      <FleetErrorState
        error={loadState.error}
        onRetry={() => setRequestVersion((version) => version + 1)}
      />
    );
  }

  return (
    <FleetOverview
      fleet={loadState.fleet}
      session={sessionState.session}
      account={selectedAccount}
      onAccountChange={setSelectedAccountId}
      onRefresh={() => setRequestVersion((version) => version + 1)}
    />
  );
}

function NoInstalledAccountsState() {
  return (
    <div className="content-shell state-shell">
      <title>Install the GitHub App | SetupStepsGuardian</title>
      <section className="state-card install-state" aria-labelledby="install-app-heading">
        <p className="eyebrow">One setup step remains</p>
        <h1 id="install-app-heading">Install the read-only GitHub App</h1>
        <p>Choose the repository scope before SetupStepsGuardian can build a decision queue.</p>
        <ul className="install-facts">
          <li>GitHub lets the installer select all repositories or specific repositories.</li>
          <li>App access is limited to Metadata read, Contents read, and Actions read.</li>
          <li>The dashboard cannot push, edit settings, merge, or rerun workflows.</li>
        </ul>
        <div className="state-actions">
          <a
            className="button button-primary"
            href="https://github.com/apps/setup-steps-guardian/installations/new"
          >
            Choose repositories on GitHub
          </a>
          <a className="button button-secondary" href="/privacy">
            Review data boundaries
          </a>
        </div>
        <p className="state-note">
          After installation, return to the dashboard to review the selected account.
        </p>
      </section>
    </div>
  );
}

function FleetLoadingState() {
  return (
    <div className="content-shell state-shell">
      <title>Loading fleet | SetupStepsGuardian</title>
      <section
        className="state-card loading-state"
        aria-labelledby="fleet-loading-heading"
        aria-live="polite"
        aria-busy="true"
        role="status"
      >
        <span className="loading-mark" aria-hidden="true" />
        <p className="eyebrow">Fleet dashboard</p>
        <h1 id="fleet-loading-heading">Loading fleet data</h1>
        <p>Checking selected repositories and their latest setup evidence.</p>
      </section>
    </div>
  );
}

interface FleetErrorStateProps {
  error: ApiError;
  onRetry: () => void;
}

function FleetErrorState({ error, onRetry }: FleetErrorStateProps) {
  const copy = getErrorCopy(error);

  return (
    <div className="content-shell state-shell">
      <title>Dashboard unavailable | SetupStepsGuardian</title>
      <section
        className="state-card error-state"
        aria-labelledby="fleet-error-heading"
        role="alert"
      >
        <p className="eyebrow">Fleet dashboard</p>
        <h1 id="fleet-error-heading">{copy.heading}</h1>
        <p>{copy.message}</p>
        <div className="state-actions">
          <button className="button button-primary" type="button" onClick={onRetry}>
            Try again
          </button>
          <a className="button button-secondary" href="/support">
            View support guidance
          </a>
        </div>
      </section>
    </div>
  );
}

function getErrorCopy(error: ApiError): { heading: string; message: string } {
  if (error.kind === "http" && error.status === 403) {
    return {
      heading: "Repository access is not available",
      message:
        "Ask the GitHub App installer to confirm your access and repository selection, then try again.",
    };
  }

  if (error.kind === "invalid-response") {
    return {
      heading: "The fleet response could not be verified",
      message:
        "The service returned data outside the expected contract. No repository status is shown until a valid response is available.",
    };
  }

  if (error.kind === "network") {
    return {
      heading: "The fleet service could not be reached",
      message: "Check your connection and try again. Your repository settings were not changed.",
    };
  }

  return {
    heading: "The fleet dashboard is temporarily unavailable",
    message: `The service returned status ${error.status ?? "unknown"}. Try again in a moment.`,
  };
}

interface FleetOverviewProps {
  fleet: FleetSummary;
  session: SessionResponse;
  account: AuthorizedAccount;
  onAccountChange: (accountId: string) => void;
  onRefresh: () => void;
}

function FleetOverview({
  fleet,
  session,
  account,
  onAccountChange,
  onRefresh,
}: FleetOverviewProps) {
  const [accountAction, setAccountAction] = useState<AccountAction>({ kind: "idle" });

  async function startCheckout(plan: "team" | "fleet") {
    setAccountAction({ kind: "checkout", plan });
    try {
      const checkout = await createCheckout(account.accountId, plan, session.csrfToken);
      window.location.assign(checkout.checkoutUrl);
    } catch {
      setAccountAction({
        kind: "error",
        message: "Checkout could not be started. Try again from this account.",
      });
    }
  }

  async function signOut() {
    setAccountAction({ kind: "logout" });
    try {
      await logout(session.csrfToken);
      window.location.assign("/login");
    } catch {
      setAccountAction({
        kind: "error",
        message: "Sign out could not be completed. Refresh the page and try again.",
      });
    }
  }

  async function deleteRetainedData() {
    const confirmed = window.confirm(
      `Delete retained SetupStepsGuardian data for ${account.login}? Any active Paddle subscription will be canceled immediately. This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }

    setAccountAction({ kind: "delete" });
    try {
      await deleteAccount(account.accountId, session.csrfToken);
      window.location.reload();
    } catch {
      setAccountAction({
        kind: "error",
        message: "Account deletion could not be completed. No success was recorded.",
      });
    }
  }

  return (
    <div className="content-shell dashboard-page">
      <title>Fleet overview | SetupStepsGuardian</title>

      <header className="page-heading dashboard-heading">
        <div>
          <p className="eyebrow">GitHub Copilot setup fleet</p>
          <h1>Fleet overview</h1>
          <p>
            Prioritize repositories using validated workflow configuration and matching run
            evidence.
          </p>
        </div>
        <div className="dashboard-actions">
          <label className="account-picker">
            <span>GitHub account</span>
            <select
              id="github-account"
              name="github-account"
              value={account.accountId}
              onChange={(event) => onAccountChange(event.currentTarget.value)}
            >
              {session.accounts.map((candidate) => (
                <option value={candidate.accountId} key={candidate.accountId}>
                  {candidate.login}
                </option>
              ))}
            </select>
          </label>
          <button className="button button-secondary" type="button" onClick={onRefresh}>
            Refresh data
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={
              accountAction.kind === "logout" ||
              accountAction.kind === "checkout" ||
              accountAction.kind === "delete"
            }
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      </header>

      {accountAction.kind === "error" ? (
        <p className="account-action-error" role="alert">
          {accountAction.message}
        </p>
      ) : null}

      <SummaryMetrics fleet={fleet} />

      {fleet.repositories.length === 0 ? (
        <EmptyFleetState />
      ) : (
        <RepositoryWorkspace
          accountId={account.accountId}
          csrfToken={session.csrfToken}
          repositories={fleet.repositories}
        />
      )}

      {account.canManage ? (
        <PricingPanel
          action={accountAction}
          onCheckout={(plan) => void startCheckout(plan)}
          onDelete={() => void deleteRetainedData()}
        />
      ) : null}
      <PermissionNotice compact />
    </div>
  );
}

function PricingPanel({
  action,
  onCheckout,
  onDelete,
}: {
  action: AccountAction;
  onCheckout: (plan: "team" | "fleet") => void;
  onDelete: () => void;
}) {
  const actionPending =
    action.kind === "checkout" || action.kind === "logout" || action.kind === "delete";

  return (
    <>
      <section className="pricing-section" aria-labelledby="pricing-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Private repository capacity</p>
            <h2 id="pricing-heading">Simple self-service plans</h2>
          </div>
          <p>
            Every plan includes selected public repositories and the same deterministic status and
            run-evidence view.
          </p>
        </div>
        <PricingPlanCards
          actions={{
            team: (
              <button
                className="button button-primary"
                type="button"
                disabled={actionPending}
                aria-describedby="billing-note"
                onClick={() => onCheckout("team")}
              >
                {action.kind === "checkout" && action.plan === "team"
                  ? "Opening checkout..."
                  : "Choose Team"}
              </button>
            ),
            fleet: (
              <button
                className="button button-primary"
                type="button"
                disabled={actionPending}
                aria-describedby="billing-note"
                onClick={() => onCheckout("fleet")}
              >
                {action.kind === "checkout" && action.plan === "fleet"
                  ? "Opening checkout..."
                  : "Choose Fleet"}
              </button>
            ),
          }}
        />
        <p className="pricing-note" id="billing-note">
          Listed prices are monthly per GitHub account. Paid checkout is available only to the
          installer admin and is handled by Paddle.
        </p>
      </section>

      <section className="account-control" aria-labelledby="account-control-heading">
        <div>
          <h2 id="account-control-heading">Account data</h2>
          <p id="delete-account-note">
            Delete retained data for this GitHub account. Any active Paddle subscription is canceled
            immediately, and deletion cannot be undone.
          </p>
        </div>
        <button
          className="button button-secondary button-danger"
          type="button"
          disabled={actionPending}
          aria-describedby="delete-account-note"
          onClick={onDelete}
        >
          {action.kind === "delete" ? "Deleting account data..." : "Delete retained account data"}
        </button>
      </section>
    </>
  );
}

function SummaryMetrics({ fleet }: { fleet: FleetSummary }) {
  return (
    <section className="summary-section" aria-labelledby="summary-heading">
      <h2 className="visually-hidden" id="summary-heading">
        Fleet summary metrics
      </h2>
      <dl className="summary-grid">
        <div>
          <dt>Selected repositories</dt>
          <dd>{fleet.totals.selected}</dd>
          <p>In the GitHub installation scope</p>
        </div>
        <div className="summary-positive">
          <dt>Passing</dt>
          <dd>{fleet.totals.passing}</dd>
          <p>Validated with current passing evidence</p>
        </div>
        <div className="summary-attention">
          <dt>Need attention</dt>
          <dd>{fleet.totals.attention}</dd>
          <p>Any status other than passing</p>
        </div>
      </dl>
    </section>
  );
}

function EmptyFleetState() {
  return (
    <section className="empty-state" aria-labelledby="empty-fleet-heading">
      <p className="eyebrow">No repository data</p>
      <h2 id="empty-fleet-heading">No repositories are selected</h2>
      <p>
        Ask the GitHub App installer to select repositories for SetupStepsGuardian. The dashboard
        will remain read-only when access is added.
      </p>
      <a className="text-link" href="https://github.com/settings/installations">
        Review GitHub App settings
        <span className="visually-hidden"> on GitHub</span>
      </a>
    </section>
  );
}

function RepositoryWorkspace({
  accountId,
  csrfToken,
  repositories,
}: {
  accountId: string;
  csrfToken: string;
  repositories: RepositorySummary[];
}) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);

  const visibleRepositories =
    statusFilter === "all"
      ? repositories
      : repositories.filter((repository) => repository.status === statusFilter);
  const selectedRepository =
    repositories.find((repository) => repository.repositoryId === selectedRepositoryId) ?? null;

  useEffect(() => {
    if (selectedRepositoryId !== null) {
      closeButtonRef.current?.focus();
    }
  }, [selectedRepositoryId]);

  function selectFilter(filter: StatusFilter) {
    setStatusFilter(filter);
    setSelectedRepositoryId(null);
    returnFocusRef.current = null;
  }

  function openDetails(repositoryId: string, trigger: HTMLButtonElement) {
    returnFocusRef.current = trigger;
    setSelectedRepositoryId(repositoryId);
  }

  function closeDetails() {
    const returnTarget = returnFocusRef.current;
    setSelectedRepositoryId(null);
    returnFocusRef.current = null;
    returnTarget?.focus();
  }

  const activeFilterLabel =
    statusFilter === "all" ? "all statuses" : STATUS_METADATA[statusFilter].label.toLowerCase();

  return (
    <section className="repository-section" aria-labelledby="repositories-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Decision queue</p>
          <h2 id="repositories-heading">Repositories</h2>
        </div>
        <p className="result-count" aria-live="polite">
          Showing {visibleRepositories.length} of {repositories.length} repositories for{" "}
          {activeFilterLabel}
        </p>
      </div>

      <fieldset className="status-filters">
        <legend>Filter repositories by status</legend>
        <div className="filter-list">
          <button
            className={`filter-button${statusFilter === "all" ? " is-active" : ""}`}
            type="button"
            aria-pressed={statusFilter === "all"}
            onClick={() => selectFilter("all")}
          >
            <span>All statuses</span>
            <span className="filter-count">{repositories.length}</span>
          </button>
          {SETUP_STATUSES.map((status) => {
            const count = repositories.filter((repository) => repository.status === status).length;
            return (
              <button
                className={`filter-button${statusFilter === status ? " is-active" : ""}`}
                type="button"
                aria-pressed={statusFilter === status}
                onClick={() => selectFilter(status)}
                key={status}
              >
                <span>{STATUS_METADATA[status].label}</span>
                <span className="filter-count">{count}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {visibleRepositories.length === 0 ? (
        <section className="empty-state compact-empty" aria-labelledby="empty-filter-heading">
          <h3 id="empty-filter-heading">No repositories match this filter</h3>
          <p>Choose another status or return to the full repository list.</p>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => selectFilter("all")}
          >
            Clear status filter
          </button>
        </section>
      ) : (
        <div className={`repository-layout${selectedRepository === null ? "" : " has-detail"}`}>
          <div className="table-card">
            <div className="table-scroll">
              <table>
                <caption>Repository setup workflow status</caption>
                <thead>
                  <tr>
                    <th scope="col">Repository</th>
                    <th scope="col">Visibility</th>
                    <th scope="col">Setup status</th>
                    <th scope="col">Last evidence</th>
                    <th scope="col">Findings</th>
                    <th scope="col">
                      <span className="visually-hidden">Repository actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRepositories.map((repository) => {
                    const fullName = `${repository.owner}/${repository.name}`;
                    const detailsOpen = repository.repositoryId === selectedRepositoryId;
                    return (
                      <tr key={repository.repositoryId}>
                        <th scope="row">
                          <span className="repository-name">
                            <span>{repository.owner}/</span>
                            <strong>{repository.name}</strong>
                          </span>
                          <span className="branch-name">Default: {repository.defaultBranch}</span>
                        </th>
                        <td>{repository.isPrivate ? "Private" : "Public"}</td>
                        <td>
                          <StatusBadge status={repository.status} />
                        </td>
                        <td>
                          <EvidenceDate value={repository.lastEvidenceAt} />
                        </td>
                        <td>
                          <FindingCount repository={repository} />
                        </td>
                        <td className="action-cell">
                          <button
                            className="detail-button"
                            type="button"
                            aria-expanded={detailsOpen}
                            aria-controls="repository-detail"
                            onClick={(event) =>
                              openDetails(repository.repositoryId, event.currentTarget)
                            }
                          >
                            View details
                            <span className="visually-hidden"> for {fullName}</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {selectedRepository === null ? null : (
            <RepositoryDetailPanel
              accountId={accountId}
              csrfToken={csrfToken}
              repository={selectedRepository}
              closeButtonRef={closeButtonRef}
              onClose={closeDetails}
            />
          )}
        </div>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: RepositorySetupStatus }) {
  const metadata = STATUS_METADATA[status];

  return (
    <span className={`status-badge status-${metadata.tone}`}>
      <span className="status-dot" aria-hidden="true" />
      {metadata.label}
    </span>
  );
}

function EvidenceDate({ value }: { value: string | null }) {
  if (value === null) {
    return <span className="muted-value">No evidence reported</span>;
  }

  return <time dateTime={value}>{evidenceDateFormatter.format(new Date(value))}</time>;
}

function FindingCount({ repository }: { repository: RepositorySummary }) {
  const errorLabel = repository.errorCount === 1 ? "error" : "errors";
  const warningLabel = repository.warningCount === 1 ? "warning" : "warnings";

  return (
    <span>
      {repository.errorCount} {errorLabel}, {repository.warningCount} {warningLabel}
    </span>
  );
}

interface RepositoryDetailPanelProps {
  accountId: string;
  csrfToken: string;
  repository: RepositorySummary;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

type RepositoryDetailLoadState =
  | { kind: "loading" }
  | { kind: "loaded"; detail: RepositoryDetailContract }
  | { kind: "error" };

function RepositoryDetailPanel({
  accountId,
  csrfToken,
  repository,
  closeButtonRef,
  onClose,
}: RepositoryDetailPanelProps) {
  const fullName = `${repository.owner}/${repository.name}`;
  const metadata = STATUS_METADATA[repository.status];
  const [detailState, setDetailState] = useState<RepositoryDetailLoadState>({
    kind: "loading",
  });
  const [scanState, setScanState] = useState<"idle" | "requesting" | "queued" | "error">("idle");

  useEffect(() => {
    const controller = new AbortController();
    setDetailState({ kind: "loading" });
    setScanState("idle");
    void getRepositoryDetail(accountId, repository.repositoryId, {
      signal: controller.signal,
    })
      .then((detail) => setDetailState({ kind: "loaded", detail }))
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setDetailState({ kind: "error" });
        }
      });
    return () => controller.abort();
  }, [accountId, repository.repositoryId]);

  async function requestScan() {
    setScanState("requesting");
    try {
      await requestRepositoryScan(accountId, repository.repositoryId, csrfToken);
      setScanState("queued");
    } catch {
      setScanState("error");
    }
  }

  return (
    <aside className="detail-panel" id="repository-detail" aria-labelledby="detail-heading">
      <header className="detail-header">
        <div>
          <p className="eyebrow">Repository detail</p>
          <h3 id="detail-heading">{fullName}</h3>
        </div>
        <button
          className="close-button"
          type="button"
          ref={closeButtonRef}
          onClick={onClose}
          aria-label={`Close repository details for ${fullName}`}
        >
          Close
        </button>
      </header>

      <div className="decision-callout">
        <span>Recommended next step</span>
        <p>{metadata.nextStep}</p>
      </div>

      <div className="detail-actions">
        <button
          className="button button-secondary"
          type="button"
          disabled={scanState === "requesting"}
          onClick={() => void requestScan()}
        >
          {scanState === "requesting" ? "Queueing scan..." : "Scan repository"}
        </button>
        {scanState === "queued" ? (
          <span role="status">Scan queued. Refresh after the next processing cycle.</span>
        ) : null}
        {scanState === "error" ? <span role="alert">The scan could not be queued.</span> : null}
      </div>

      <dl className="detail-list">
        <div>
          <dt>Setup status</dt>
          <dd>
            <StatusBadge status={repository.status} />
            <p>{metadata.description}</p>
          </dd>
        </div>
        <div>
          <dt>Visibility</dt>
          <dd>{repository.isPrivate ? "Private repository" : "Public repository"}</dd>
        </div>
        <div>
          <dt>Default branch</dt>
          <dd>
            <code>{repository.defaultBranch}</code>
          </dd>
        </div>
        <div>
          <dt>Last evidence</dt>
          <dd>
            <EvidenceDate value={repository.lastEvidenceAt} />
          </dd>
        </div>
        <div>
          <dt>Validation findings</dt>
          <dd>
            <FindingCount repository={repository} />
          </dd>
        </div>
      </dl>

      {detailState.kind === "loading" ? (
        <p role="status">Loading findings and workflow evidence...</p>
      ) : null}
      {detailState.kind === "error" ? (
        <p role="alert">Repository findings could not be loaded.</p>
      ) : null}
      {detailState.kind === "loaded" ? (
        <>
          <section className="finding-section" aria-labelledby="finding-heading">
            <h4 id="finding-heading">Deterministic findings</h4>
            {detailState.detail.findings.length === 0 ? (
              <p>No current validation findings.</p>
            ) : (
              <ol className="finding-list">
                {detailState.detail.findings.map((finding) => (
                  <li key={`${finding.code}:${finding.path}:${finding.line ?? 0}`}>
                    <div>
                      <strong>{finding.title}</strong>
                      <code>{finding.code}</code>
                    </div>
                    <p>{finding.message}</p>
                    <p>
                      <strong>Remediation:</strong> {finding.remediation}
                    </p>
                    <span>
                      {finding.path}
                      {finding.line === undefined ? "" : `:${finding.line}`}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="evidence-section" aria-labelledby="evidence-heading">
            <h4 id="evidence-heading">Latest qualifying run evidence</h4>
            {detailState.detail.evidence === null ? (
              <p>No completed default-branch setup run has been recorded.</p>
            ) : (
              <dl className="evidence-grid">
                <div>
                  <dt>Conclusion</dt>
                  <dd>{detailState.detail.evidence.conclusion}</dd>
                </div>
                <div>
                  <dt>Runner</dt>
                  <dd>{detailState.detail.evidence.runnerLabel}</dd>
                </div>
                <div>
                  <dt>Completed</dt>
                  <dd>
                    <EvidenceDate value={detailState.detail.evidence.completedAt} />
                  </dd>
                </div>
                <div>
                  <dt>Failed step</dt>
                  <dd>{detailState.detail.evidence.failedStep ?? "None reported"}</dd>
                </div>
              </dl>
            )}
          </section>
        </>
      ) : null}

      <p className="detail-note">
        This view reports available evidence only. SetupStepsGuardian does not change the repository
        or trigger workflows.
      </p>
    </aside>
  );
}
