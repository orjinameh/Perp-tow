'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { BotStatus, botStatus } from '@/lib/botStatus';

/** A live checklist for letting the game wallet act as a bot for the player's main wallet. */
export const BotSetup: React.FC<{ main: string; bot: string }> = ({ main, bot }) => {
  const [s, setS] = useState<BotStatus | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setS(await botStatus(main as `0x${string}`, bot as `0x${string}`));
    } catch {
      setS(null);
    }
  }, [main, bot]);

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
  const usdOk = s ? s.usdso >= 10 : null;

  return (
    <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-xs">
      <div className="font-semibold text-zinc-100">Bot setup: play from your main wallet</div>
      <p className="leading-relaxed text-zinc-400">
        Your main wallet stays the player. This game wallet only acts as its bot, using the main wallet&apos;s trading margin, and can never send funds anywhere else. Keep this tab open while it plays.
      </p>
      <ol className="space-y-2">
        <li className={tone(s?.added ?? null)}>
          {mark(s?.added ?? null)} <b>1. Add the bot in the dreamDEX app.</b> Open &quot;Add bot&quot;, paste this address, keep Perps ticked, and confirm.
          <div>
            <button onClick={copy} className="mt-1 break-all rounded bg-zinc-800 px-2 py-1 font-mono text-zinc-100 hover:bg-zinc-700">
              {copied ? 'Copied!' : bot}
            </button>
          </div>
          {s?.added === null && <div className="text-amber-300">Could not read this from the chain right now.</div>}
        </li>
        <li className={tone(gasOk)}>
          {mark(gasOk)} <b>2. Give the bot gas.</b> Send it 5 STT from your main wallet. It has {s ? s.gasStt.toFixed(3) : '…'} STT now.
        </li>
        <li className={tone(usdOk)}>
          {mark(usdOk)} <b>3. Give the bot its stake money.</b> Send it at least 10 USDso per match. It has {s ? s.usdso.toFixed(2) : '…'} USDso now. Winnings and refunds go back to your main wallet.
        </li>
      </ol>
      {s && s.added && gasOk && usdOk && <div className="font-semibold text-emerald-300">Ready. Join a match as usual.</div>}
    </div>
  );
};
