import type { ReactNode } from "react";

export type CurrentPage = "dashboard" | "privacy" | "terms" | "support" | "none";

interface AppFrameProps {
  children: ReactNode;
  currentPage: CurrentPage;
  publicPreview?: boolean;
}

const REPOSITORY_URL = "https://github.com/Chinmoy-Kulkarni/setup-steps-guardian";
const DISCUSSION_URL = `${REPOSITORY_URL}/discussions/4`;
const PUBLIC_HOME_URL = import.meta.env.BASE_URL;

interface PrimaryLink {
  href: string;
  label: string;
  page?: CurrentPage;
}

const primaryLinks: ReadonlyArray<PrimaryLink> = [
  { href: "/", label: "Dashboard", page: "dashboard" },
  { href: "/login#pricing", label: "Pricing" },
  { href: "/support", label: "Support", page: "support" },
];

const previewLinks: ReadonlyArray<PrimaryLink> = [
  { href: PUBLIC_HOME_URL, label: "Overview", page: "dashboard" },
  { href: `${PUBLIC_HOME_URL}#pricing`, label: "Pricing" },
  { href: DISCUSSION_URL, label: "Feedback" },
];

export function AppFrame({ children, currentPage, publicPreview = false }: AppFrameProps) {
  const navigationLinks = publicPreview ? previewLinks : primaryLinks;
  const homeUrl = publicPreview ? PUBLIC_HOME_URL : "/";
  const privacyUrl = publicPreview ? `${REPOSITORY_URL}/blob/main/PRIVACY.md` : "/privacy";
  const termsUrl = publicPreview ? `${REPOSITORY_URL}/blob/main/TERMS.md` : "/terms";
  const supportUrl = publicPreview ? `${REPOSITORY_URL}/blob/main/SUPPORT.md` : "/support";

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href={homeUrl} aria-label="SetupStepsGuardian home">
            <span className="brand-mark" aria-hidden="true">
              SG
            </span>
            <span>SetupStepsGuardian</span>
          </a>

          <nav aria-label="Primary navigation">
            <ul className="primary-nav">
              {navigationLinks.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    aria-current={
                      link.page !== undefined && currentPage === link.page ? "page" : undefined
                    }
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
        {children}
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <p>
            <strong>SetupStepsGuardian</strong>
            <span>Read-only assurance for Copilot setup workflows.</span>
          </p>
          <nav aria-label="Footer navigation">
            <ul>
              <li>
                <a href={privacyUrl}>Privacy</a>
              </li>
              <li>
                <a href={termsUrl}>Terms</a>
              </li>
              <li>
                <a href={supportUrl}>Support</a>
              </li>
              <li>
                <a href={`${REPOSITORY_URL}#use-the-action`}>GitHub Action</a>
              </li>
            </ul>
          </nav>
        </div>
      </footer>
    </div>
  );
}
