import type { ReactNode } from "react";
import { AppFrame, type CurrentPage } from "./components/AppFrame";
import { DashboardPage } from "./pages/DashboardPage";
import { LandingPage } from "./pages/LandingPage";
import { PrivacyPage, SupportPage, TermsPage } from "./pages/PolicyPages";

type Route = "dashboard" | "login" | "privacy" | "terms" | "support" | "not-found";

interface AppProps {
  publicPreview?: boolean;
}

const DEFAULT_PUBLIC_PREVIEW = import.meta.env.VITE_PUBLIC_PREVIEW === "true";

function resolveRoute(pathname: string): Route {
  const normalizedPath = pathname.replace(/\/+$/, "") || "/";

  switch (normalizedPath) {
    case "/":
    case "/dashboard":
    case "/index.html":
      return "dashboard";
    case "/login":
      return "login";
    case "/privacy":
      return "privacy";
    case "/terms":
      return "terms";
    case "/support":
      return "support";
    default:
      return "not-found";
  }
}

function currentPageForRoute(route: Route): CurrentPage {
  switch (route) {
    case "dashboard":
    case "login":
      return "dashboard";
    case "privacy":
      return "privacy";
    case "terms":
      return "terms";
    case "support":
      return "support";
    case "not-found":
      return "none";
  }
}

function NotFoundPage() {
  return (
    <div className="content-shell narrow-shell policy-page">
      <title>Page not found | SetupStepsGuardian</title>
      <p className="eyebrow">404</p>
      <h1>Page not found</h1>
      <p>The requested SetupStepsGuardian page does not exist.</p>
      <a className="button button-primary" href="/">
        Return to the dashboard
      </a>
    </div>
  );
}

export function App({ publicPreview = DEFAULT_PUBLIC_PREVIEW }: AppProps) {
  const route = publicPreview ? "login" : resolveRoute(window.location.pathname);
  let content: ReactNode;

  switch (route) {
    case "dashboard":
      content = <DashboardPage />;
      break;
    case "login":
      content = <LandingPage publicPreview={publicPreview} />;
      break;
    case "privacy":
      content = <PrivacyPage />;
      break;
    case "terms":
      content = <TermsPage />;
      break;
    case "support":
      content = <SupportPage />;
      break;
    case "not-found":
      content = <NotFoundPage />;
      break;
  }

  return (
    <AppFrame currentPage={currentPageForRoute(route)} publicPreview={publicPreview}>
      {content}
    </AppFrame>
  );
}
