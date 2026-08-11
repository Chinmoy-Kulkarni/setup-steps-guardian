import type { ReactNode } from "react";

export type CurrentPage = "dashboard" | "privacy" | "terms" | "support" | "none";

interface AppFrameProps {
  children: ReactNode;
  currentPage: CurrentPage;
}

const primaryLinks: ReadonlyArray<{
  href: string;
  label: string;
  page?: CurrentPage;
}> = [
  { href: "/", label: "Dashboard", page: "dashboard" },
  { href: "/login#pricing", label: "Pricing" },
  { href: "/support", label: "Support", page: "support" },
];

export function AppFrame({ children, currentPage }: AppFrameProps) {
  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="/" aria-label="SetupStepsGuardian home">
            <span className="brand-mark" aria-hidden="true">
              SG
            </span>
            <span>SetupStepsGuardian</span>
          </a>

          <nav aria-label="Primary navigation">
            <ul className="primary-nav">
              {primaryLinks.map((link) => (
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
                <a href="/privacy">Privacy</a>
              </li>
              <li>
                <a href="/terms">Terms</a>
              </li>
              <li>
                <a href="/support">Support</a>
              </li>
              <li>
                <a href="https://github.com/Chinmoy-Kulkarni/setup-steps-guardian#use-the-action">
                  GitHub Action
                </a>
              </li>
            </ul>
          </nav>
        </div>
      </footer>
    </div>
  );
}
