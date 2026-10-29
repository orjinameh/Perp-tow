'use client';

import React, { useEffect } from 'react';

/** A centered popup in the app's dark style. Click the backdrop or press Escape to close. */
export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[96] overflow-y-auto overscroll-contain bg-black/70 backdrop-blur-sm" data-world-ui style={{ touchAction: 'pan-y' }} onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
     <div className="flex min-h-full items-start justify-center p-4 sm:items-center">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 text-zinc-100 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="text-base font-bold tracking-tight">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-white">✕</button>
        </div>
        <div className="space-y-3 px-5 py-4 text-sm">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-zinc-800 bg-zinc-950/50 px-5 py-3">{footer}</div>}
      </div>
     </div>
    </div>
  );
}

export const btnPrimary = 'rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-zinc-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40';
export const btnGhost = 'rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800';
