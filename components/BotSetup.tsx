'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { BotStatus, botStatus } from '@/lib/botStatus';
import { readSquadParams, squadsEnabled } from '@/lib/squads';

/** A live checklist for letting the game wallet act for the player's main wallet. Folds into one line once everything is ready. */
export const BotSetup: React.FC<{ main: string; bot: string }> = ({ main, bot }) => {
  const [s, setS] = useState<BotStatus | null>(null);
  const [copied, setCopied] = useState(false);
  const [need, setNeed] = useState(10); // USDso the wallet paying for a seat must hold
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setS(await botStatus(main as `0x${string}`, bot as `0x${string}`));
    } catch {
      setS(null);
    }
  }, [main, bot]);

  useEffect(() => {
    if (!squadsEnabled) return;
    readSquadParams().then((p) => setNeed(p.stakeUsd + p.bankrollUsd)).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [load]);

  const copy = () => {
    navigator.clipboard?.writeText(bot);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const mark = (ok: boolean | null) => (ok === null ? '…' : ok ? '✓' : '○');
  const tone = (ok: boolean | null) => (ok ? 'text-emerald-300' : 'text-zinc-300');
  const gasOk = s ? s.gasStt >= 0.05 : null;
  const usdOk = s ? s.usdso >= need : null;

  const ready = !!s && s.added && gasOk === true && usdOk === true;
  if (ready && !open) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs">
        <span className="font-semibold text-emerald-300">✓ Game wallet ready</span>
        <button className="text-zinc-400 underline" onClick={() => setOpen(true)}>Details</button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-xs">
      <div className="font-semibold text-zinc-100">Game wallet setup: play from your main wallet</div>
      <p className="leading-relaxed text-zinc-400">
        Your main wallet stays the player. This game wallet signs for it, so there are no wallet pop-ups, and it can never send funds anywhere else. In a squads match each seat funds your own trading vault, which trades only for you. Keep this tab open while you play.
      </p>
      <ol className="space-y-2">
        <li className={tone(s?.added ?? null)}>
          {mark(s?.added ?? null)} <b>1. Allow this game wallet in the dreamDEX app.</b> Open &quot;Add bot&quot;, paste this address, keep Perps ticked, and confirm.
          <div>
            <button onClick={copy} className="mt-1 break-all rounded bg-zinc-800 px-2 py-1 font-mono text-zinc-100 hover:bg-zinc-700">
              {copied ? 'Copied!' : bot}
            </button>
          </div>
          {s?.added === null && <div className="text-amber-300">Could not read this from the chain right now.</div>}
        </li>
        <li className={tone(gasOk)}>
          {mark(gasOk)} <b>2. Give the game wallet gas.</b> Send it 5 STT from your main wallet. It has {s ? s.gasStt.toFixed(3) : '…'} STT now.
        </li>
        <li className={tone(usdOk)}>
          {mark(usdOk)} <b>3. Give the game wallet the seat money.</b> Send it at least {need} USDso per match (the stake plus the trading bankroll that comes back to you). It has {s ? s.usdso.toFixed(2) : '…'} USDso now. Winnings and refunds go back to your main wallet.
        </li>
      </ol>
      {ready && (
        <div className="flex items-center justify-between">
          <span className="font-semibold text-emerald-300">Ready. Join a match as usual.</span>
          <button className="text-zinc-400 underline" onClick={() => setOpen(false)}>Hide</button>
        </div>
      )}
    </div>
  );
};
