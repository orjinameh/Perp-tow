'use client';

import React, { useCallback, useRef, useState } from 'react';
import { ProgressModal, ProgressStep } from '@/components/ProgressModal';

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Wraps a multi-step action in a progress card. `fn` calls `advance(i)` when step i starts;
 * everything before it is marked done. On success the card closes by itself; on failure it stays
 * with the reason until the player closes it.
 */
export function useProgress() {
  const [view, setView] = useState<{ title: string; steps: ProgressStep[]; error: string | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async <T,>(title: string, labels: string[], fn: (advance: (i: number) => void) => Promise<T>): Promise<Outcome<T>> => {
    if (timer.current) clearTimeout(timer.current);
    const mark = (active: number, failed = false): ProgressStep[] =>
      labels.map((label, i) => ({
        label,
        status: failed && i === active ? 'error' : i < active ? 'done' : i === active ? 'active' : 'pending',
      }));
    let current = 0;
    setView({ title, steps: mark(0), error: null });
    try {
      const value = await fn((i) => {
        current = i;
        setView({ title, steps: mark(i), error: null });
      });
      setView({ title, steps: labels.map((label) => ({ label, status: 'done' as const })), error: null });
      timer.current = setTimeout(() => setView(null), 900);
      return { ok: true, value };
    } catch (e) {
      const error = e instanceof Error ? e.message.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3).join(' ') : String(e);
      setView({ title, steps: mark(current, true), error });
      return { ok: false, error };
    }
  }, []);

  const modal = (
    <ProgressModal open={view !== null} title={view?.title ?? ''} steps={view?.steps ?? []} error={view?.error ?? null} onClose={() => setView(null)} />
  );
  return { run, modal };
}
