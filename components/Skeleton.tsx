import React from 'react';

export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse rounded-lg bg-zinc-800/70 ${className}`} aria-hidden="true" />
);

/** Placeholder cards shown while the live markets load. */
export const LobbySkeleton: React.FC = () => (
  <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 space-y-6" aria-busy="true" aria-label="Loading live markets">
    <Skeleton className="h-40 w-full rounded-3xl" />
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="h-11 w-11 rounded-xl" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
            <Skeleton className="h-6 w-20" />
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-9 w-full rounded-xl" />
        </div>
      ))}
    </div>
    <p className="text-center text-xs text-zinc-500">Loading live markets from dreamDEX…</p>
  </div>
);

export const MatchListSkeleton: React.FC = () => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-5" aria-busy="true" aria-label="Reading matches">
    {Array.from({ length: 2 }).map((_, i) => (
      <div key={i} className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-9 w-full rounded-xl" />
      </div>
    ))}
  </div>
);
