import type {
  FleetSummary,
  RepositoryDetail,
  RepositorySummary,
  SessionResponse,
} from "@setup-fleet/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App";

const webRepository = {
  repositoryId: "repo-web",
  owner: "octo-org",
  name: "web-app",
  isPrivate: false,
  defaultBranch: "main",
  status: "passing",
  lastEvidenceAt: "2026-08-09T18:30:00.000Z",
  errorCount: 0,
  warningCount: 0,
} satisfies RepositorySummary;

const fleetFixture = {
  accountId: "installation-42",
  repositories: [
    webRepository,
    {
      repositoryId: "repo-api",
      owner: "octo-org",
      name: "internal-api",
      isPrivate: true,
      defaultBranch: "trunk",
      status: "failing",
      lastEvidenceAt: "2026-08-08T12:15:00.000Z",
      errorCount: 2,
      warningCount: 1,
    },
  ],
  totals: {
    selected: 2,
    passing: 1,
    attention: 1,
  },
} satisfies FleetSummary;

const sessionFixture = {
  user: {
    id: "1",
    login: "octocat",
    avatarUrl: "https://avatars.githubusercontent.com/u/1",
  },
  accounts: [
    {
      accountId: "installation-42",
      login: "octo-org",
      accountType: "Organization",
      canManage: true,
    },
  ],
  csrfToken: "1234567890123456",
} satisfies SessionResponse;

const detailFixture = {
  repository: webRepository,
  findings: [],
  evidence: null,
} satisfies RepositoryDetail;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFleetResponse(
  body: unknown = fleetFixture,
  status = 200,
  session: SessionResponse = sessionFixture,
) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/session") {
      return Promise.resolve(jsonResponse(session));
    }
    if (url.includes("/repositories/")) {
      return Promise.resolve(jsonResponse(detailFixture));
    }
    return Promise.resolve(jsonResponse(body, status));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("dashboard shell", () => {
  it("announces the loading state while fleet data is pending", () => {
    const pendingResponse = new Promise<Response>(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => pendingResponse),
    );

    render(<App />);

    expect(screen.getByRole("status")).toHaveAccessibleName("Loading fleet data");
    expect(screen.getByText(/Checking selected repositories/)).toBeInTheDocument();
  });

  it("renders fleet summary metrics and repository status text", async () => {
    mockFleetResponse();

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Fleet overview" })).toBeInTheDocument();
    expect(screen.getByText("Selected repositories")).toBeInTheDocument();
    expect(screen.getByText("Need attention")).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Repository setup workflow status" }),
    ).toBeInTheDocument();
    expect(screen.getByText("web-app", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("internal-api", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getAllByText("Passing").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Failing").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Simple self-service plans" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Free" })).toBeInTheDocument();
    expect(screen.getByText("$0")).toBeInTheDocument();
    expect(
      screen.getByText(/checkout is available only to the installer admin/i),
    ).toBeInTheDocument();
  });

  it("hides billing and deletion controls from repository collaborators", async () => {
    mockFleetResponse(fleetFixture, 200, {
      ...sessionFixture,
      accounts: [
        {
          accountId: "installation-42",
          login: "octo-org",
          accountType: "Organization",
          canManage: false,
        },
      ],
    });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Fleet overview" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose Team" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete retained account data" }),
    ).not.toBeInTheDocument();
  });

  it("explains repository selection when the user has no installation", async () => {
    const fetchMock = mockFleetResponse(fleetFixture, 200, {
      ...sessionFixture,
      accounts: [],
    });

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Install the read-only GitHub App" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Metadata read, Contents read, and Actions read/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose repositories on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/apps/setupstepsguardian/installations/new",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("filters the repository table by explicit status", async () => {
    mockFleetResponse();
    render(<App />);
    await screen.findByRole("heading", { name: "Fleet overview" });

    fireEvent.click(screen.getByRole("button", { name: /Passing\s+1/ }));

    expect(screen.getByText("web-app", { selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByText("internal-api", { selector: "strong" })).not.toBeInTheDocument();
    expect(screen.getByText(/Showing 1 of 2 repositories for passing/)).toBeInTheDocument();
  });

  it("shows a recoverable API error state", async () => {
    mockFleetResponse({ message: "Unavailable" }, 503);

    render(<App />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAccessibleName("The fleet dashboard is temporarily unavailable");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View support guidance" })).toHaveAttribute(
      "href",
      "/support",
    );
  });

  it("exposes navigation, filters, table, and detail controls with accessible labels", async () => {
    mockFleetResponse();
    render(<App />);
    await screen.findByRole("heading", { name: "Fleet overview" });

    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Filter repositories by status" }),
    ).toBeInTheDocument();

    const detailsButton = screen.getByRole("button", {
      name: "View details for octo-org/web-app",
    });
    fireEvent.click(detailsButton);

    expect(
      await screen.findByRole("complementary", { name: "octo-org/web-app" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Close repository details for octo-org/web-app" }),
    ).toHaveFocus();
  });

  it("renders the sign-in landing state for an unauthorized session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse({ message: "Unauthorized" }, 401))),
    );

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Know which setup workflows need attention." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in with GitHub" })).toHaveAttribute(
      "href",
      "/api/auth/github?return_to=%2F",
    );
    expect(screen.getByText("Sign in to open your dashboard.")).toBeInTheDocument();
    expect(screen.getByText(/repository settings are unchanged/i)).toBeInTheDocument();
  });

  it("presents onboarding, honest trust boundaries, and pricing before sign-in", () => {
    window.history.replaceState({}, "", "/login#pricing");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(screen.getByRole("heading", { name: "Three explicit steps" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Product boundaries" })).toHaveTextContent(
      "No write path",
    );
    expect(
      screen.getByRole("heading", { name: "Pricing by private repository capacity" }),
    ).toBeInTheDocument();
    const freePlan = screen.getByRole("heading", { name: "Free" }).closest("article");
    const teamPlan = screen.getByRole("heading", { name: "Team" }).closest("article");
    const fleetPlan = screen.getByRole("heading", { name: "Fleet" }).closest("article");
    expect(freePlan).toHaveTextContent("$0");
    expect(freePlan).toHaveTextContent("5 selected private repositories");
    expect(teamPlan).toHaveTextContent("$29");
    expect(teamPlan).toHaveTextContent("25 selected private repositories");
    expect(fleetPlan).toHaveTextContent("$79");
    expect(fleetPlan).toHaveTextContent("100 selected private repositories");
    expect(screen.getByRole("link", { name: "Review Action setup on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/Chinmoy-Kulkarni/setup-steps-guardian#use-the-action",
    );
    expect(screen.getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "/login#pricing");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders an honest public preview without calling the hosted API", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<App publicPreview />);

    expect(
      screen.getByText("The GitHub Action is live; the hosted dashboard is pre-launch."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Install the GitHub Action" })).toHaveAttribute(
      "href",
      "https://github.com/Chinmoy-Kulkarni/setup-steps-guardian#use-the-action",
    );
    expect(screen.getByRole("link", { name: "Request early access" })).toHaveAttribute(
      "href",
      "https://github.com/Chinmoy-Kulkarni/setup-steps-guardian/discussions/4",
    );
    expect(screen.queryByRole("link", { name: "Sign in with GitHub" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
