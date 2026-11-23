'use client';

import { Moon, Sun } from 'lucide-react';

export default function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = theme;
    try { localStorage.setItem('incodet-theme', theme); } catch { /* The current theme still applies. */ }
  }

  return (
    <button type="button" className="icon-button theme-toggle" onClick={toggle} aria-label="Toggle color theme">
      <Moon className="theme-moon" size={17} aria-hidden="true" />
      <Sun className="theme-sun" size={18} aria-hidden="true" />
    </button>
  );
}
