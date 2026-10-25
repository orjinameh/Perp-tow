'use client';

import React, { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

type Mode = 'system' | 'light' | 'dark';
const ORDER: Mode[] = ['system', 'light', 'dark'];

/** Follows the device setting by default; one tap cycles system, light, dark. */
export const ThemeToggle: React.FC = () => {
  const [mode, setMode] = useState<Mode>('system');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('tow.theme');
      if (saved === 'light' || saved === 'dark') setMode(saved);
    } catch {
      /* storage unavailable: stay on system */
    }
  }, []);

  const next = () => {
    const m = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    setMode(m);
    const root = document.documentElement;
    if (m === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', m);
    try {
      if (m === 'system') localStorage.removeItem('tow.theme');
      else localStorage.setItem('tow.theme', m);
    } catch {
      /* ignore */
    }
  };

  const Icon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor;
  return (
    <button
      onClick={next}
      aria-label={`Theme: ${mode}. Tap to change.`}
      title={`Theme: ${mode} (tap to change)`}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/80 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-white"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
};
