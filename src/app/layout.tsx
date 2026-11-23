import type { Metadata } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';
import { brand } from '../config/brand';
import { readEnv } from '../lib/env';
import './globals.css';

export const metadata: Metadata = { title: 'Prospect Audit | Incodet', publisher: readEnv().AGENCY_NAME };

const brandVariables = Object.fromEntries(Object.entries(brand).map(([key, value]) =>
  ['--brand-' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()), value])) as CSSProperties;

const initializeTheme = `(() => {
  let saved;
  try { saved = localStorage.getItem('incodet-theme'); } catch {}
  const preference = matchMedia('(prefers-color-scheme: dark)');
  const update = () => {
    document.documentElement.dataset.theme = saved === 'dark' || saved === 'light'
      ? saved : preference.matches ? 'dark' : 'light';
  };
  preference.addEventListener('change', () => {
    try { saved = localStorage.getItem('incodet-theme') || saved; } catch {}
    update();
  });
  update();
})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" style={brandVariables} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: initializeTheme }} /></head>
      <body>{children}</body>
    </html>
  );
}
