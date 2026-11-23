import { ArrowRight, LockKeyhole } from 'lucide-react';
import { configuredPassword } from '../../lib/auth';
import ThemeToggle from '../components/theme-toggle';
import Wordmark from '../components/wordmark';

export const dynamic = 'force-dynamic';

export default async function Login({ searchParams }: { searchParams: Promise<{ invalid?: string }> }) {
  const { invalid } = await searchParams;
  const enabled = Boolean(configuredPassword());
  return (
    <main className="login-page">
      <div className="frame login-top"><Wordmark /><ThemeToggle /></div>
      <section className="panel login-card" aria-labelledby="login-heading">
        <span className="feature-icon"><LockKeyhole size={22} strokeWidth={1.7} /></span>
        <h1 id="login-heading">Sign in.</h1>
        <p className="hint">Access your Incodet audit workspace.</p>
        {enabled ? (
          <form className="login-form" action="/api/login" method="post">
            <label className="field">App password
              <input name="password" type="password" required autoComplete="current-password" maxLength={1024}
                placeholder="Enter your password" aria-invalid={Boolean(invalid)} aria-describedby={invalid ? 'login-error' : undefined} />
            </label>
            {invalid && <p className="error" role="alert" id="login-error">That password didn’t match. Try again.</p>}
            <button className="primary" type="submit">Sign in <ArrowRight size={17} /></button>
          </form>
        ) : <p className="error">Set APP_PASSWORD in the server environment to enable sign-in.</p>}
      </section>
    </main>
  );
}
