/**
 * The application shell (Checkpoint 7, UI plan §1 and §4).
 *
 * The landmarks and the skip link live here rather than per page, because they only work if they are on
 * EVERY page: a banner/nav/main structure that appears on some screens and not others is worse than none,
 * since a keyboard operator cannot rely on it. `<html lang="en">` is set because the UI is English (ADR-0026);
 * manuscript text carries its own `lang` where it differs.
 */
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppStateProvider } from '../components/app-state';
import './globals.css';

export const metadata: Metadata = {
  title: 'Yeonjae Studio — operator',
  description: 'Operator surface for Yeonjae Studio: planning, production, review and canon.',
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en">
      <body>
        {/* The first focusable element on every page: a keyboard operator can jump past the nav. */}
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        <AppStateProvider>
          <header>
            <p className="brand">Yeonjae Studio</p>
          </header>
          <main id="main" tabIndex={-1}>
            {children}
          </main>
        </AppStateProvider>
      </body>
    </html>
  );
}
