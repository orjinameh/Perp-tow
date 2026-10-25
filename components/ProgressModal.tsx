'use client';

import React from 'react';

export interface ProgressStep {
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
}

export const Spinner: React.FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-20" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

const Icon: React.FC<{ status: ProgressStep['status'] }> = ({ status }) => {
  if (status === 'active') return <Spinner className="h-5 w-5 text-emerald-400" />;
  if (status === 'done')
    return (
      <svg className="h-5 w-5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    );
  if (status === 'error')
    return (
      <svg className="h-5 w-5 text-rose-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    );
  return <span className="block h-2.5 w-2.5 rounded-full bg-zinc-700 mx-1.5" />;
};

/** A blocking progress card for anything that sends a transaction: each step shows waiting, working, done or failed. */
export const ProgressModal: React.FC<{
  open: boolean;
  title: string;
  steps: ProgressStep[];
  error: string | null;
  onClose: () => void;
}> = ({ open, title, steps, error, onClose }) => {
  if (!open) return null;
  const running = !error && steps.some((s) => s.status === 'active' || s.status === 'pending');
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl space-y-4">
        <div className="text-sm font-bold text-white">{title}</div>
        <ul className="space-y-3">
          {steps.map((s) => (
            <li key={s.label} className="flex items-center gap-3 text-sm">
              <Icon status={s.status} />
              <span className={s.status === 'pending' ? 'text-zinc-500' : s.status === 'error' ? 'text-rose-300' : 'text-zinc-100'}>{s.label}</span>
            </li>
          ))}
        </ul>
        {running && <p className="text-[11px] text-zinc-500">Waiting for the chain to confirm. This usually takes a few seconds. Keep this page open.</p>}
        {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-2.5 text-xs text-rose-200 break-words">{error}</p>}
        {!running && (
          <button onClick={onClose} className="w-full rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white py-2 text-xs font-semibold transition-colors">
            {error ? 'Close' : 'Done'}
          </button>
        )}
      </div>
    </div>
  );
};
