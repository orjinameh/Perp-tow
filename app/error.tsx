'use client';

import React, { useEffect } from 'react';

/** Last-resort screen for a crash anywhere in the app, so players see a reason and a way back instead of a blank page. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-zinc-950 text-zinc-100">
      <div className="max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-sm">
        <h1 className="text-lg font-semibold mb-2">Something went wrong</h1>
        <p className="opacity-80 mb-3">The page hit an unexpected error. Your seat, stake and vault are on the chain and are not affected. Reload to carry on.</p>
        <p className="mb-4 rounded bg-zinc-950 p-2 font-mono text-xs text-rose-300 break-words">{String(error.message || error).slice(0, 240)}</p>
        <div className="flex gap-2">
          <button className="rounded border border-zinc-600 px-3 py-1" onClick={reset}>Try again</button>
          <button className="rounded border border-zinc-600 px-3 py-1" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    </div>
  );
}
