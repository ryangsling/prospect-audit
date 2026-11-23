import type { ReactNode } from 'react';
import Link from 'next/link';
import { Files, LogOut, ScanLine } from 'lucide-react';
import { signOut } from '../session-actions';
import ThemeToggle from './theme-toggle';
import Wordmark from './wordmark';

export default function AppShell({ page, children }: { page: 'audit' | 'batch'; children: ReactNode }) {
  return (
    <>
      <header className="topbar">
        <div className="frame topbar-inner">
          <Link href="/" className="brand-link" aria-label="Incodet home"><Wordmark /></Link>
          <span className="product-label">Prospect Audit</span>
          <nav className="app-nav" aria-label="Main navigation">
            <Link href="/" aria-current={page === 'audit' ? 'page' : undefined}><ScanLine size={17} />New audit</Link>
            <Link href="/batch" aria-current={page === 'batch' ? 'page' : undefined}><Files size={16} />Batch</Link>
          </nav>
          <div className="session">
            <ThemeToggle />
            <form action={signOut}>
              <button type="submit" className="signout" aria-label="Sign out"><LogOut size={16} /><span>Sign out</span></button>
            </form>
          </div>
        </div>
      </header>
      <main className="frame main-content">{children}</main>
    </>
  );
}
