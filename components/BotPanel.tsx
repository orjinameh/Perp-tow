'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Your own trading bot, written by you, running inside the app.
 *
 * You paste a script that defines `onTick(ctx)`. Every few seconds while the match is trading, the app gives it the
 * live market and your vault, and if it returns an order the app sends that REAL order from your vault. The script
 * runs in a sandboxed Web Worker: it cannot see your game wallet key, the page or your storage, it can only answer
 * with an order. The vault, the match phase and the size cap are enforced by the app and the contract, not by the script.
 */

export interface BotCtx {
  price: number;
  prices: number[];
  position: { size: number; entry: number } | null;
  secondsLeft: number;
  team: 'bulls' | 'bears' | null;
  bankroll: number;
  tick: number;
}

type Order = { action: 'buy' | 'sell'; usd: number } | { action: 'close' };

const STORE = 'tow.botScript';

export const EXAMPLE_SCRIPT = `// Your bot. Define onTick(ctx); it is called every few seconds while the match is trading.
// ctx: { price, prices (recent prices, oldest first), position ({size, entry} or null; size > 0 is long),
//        secondsLeft, team ('bulls' | 'bears'), bankroll (USD), tick }
// Return { action: 'buy', usd: 20 }, { action: 'sell', usd: 20 }, { action: 'close' } or nothing.
// Orders are REAL and are sent from your vault. This is only an example: replace it with your own idea.
function onTick(ctx) {
  const p = ctx.prices;
  if (p.length < 6) return;                       // wait for a few readings
  const recent = p.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const long = ctx.position && ctx.position.size > 0;
  const short = ctx.position && ctx.position.size < 0;
  if (ctx.price > recent && !long) return { action: 'buy', usd: Math.min(20, ctx.bankroll) };
  if (ctx.price < recent && !short) return { action: 'sell', usd: Math.min(20, ctx.bankroll) };
}
`;

const WORKER_SRC = `
let fn = null;
const msg = (e) => String((e && e.message) || e);
onmessage = (ev) => {
  const d = ev.data;
  if (d.type === 'load') {
    try {
      fn = new Function(d.code + '\\n;return typeof onTick === "function" ? onTick : null;')();
      if (!fn) throw new Error('Your script must define a function onTick(ctx).');
      postMessage({ type: 'ready' });
    } catch (e) { postMessage({ type: 'error', message: msg(e) }); }
  } else if (d.type === 'tick') {
    try {
      Promise.resolve(fn(d.ctx)).then(
        (r) => postMessage({ type: 'result', id: d.id, result: r === undefined ? null : r }),
        (e) => postMessage({ type: 'error', message: msg(e) }),
      );
    } catch (e) { postMessage({ type: 'error', message: msg(e) }); }
  }
};
`;

interface Props {
  active: boolean; // the match is trading
  price: number | null;
  position: { size: number; entry: number } | null;
  secondsLeft: number;
  team: 'bulls' | 'bears' | null;
  bankroll: number;
  canTrade: boolean; // vault found
  onOrder: (side: 'buy' | 'sell', usd: number) => Promise<unknown>;
  onClose: () => Promise<unknown>;
}

const INTERVALS = [5, 10, 30, 60];
const MAX_FAILS = 3;
const MAX_PER_MIN = 6;

export function BotPanel(p: Props) {
  const [code, setCode] = useState(EXAMPLE_SCRIPT);
  const [running, setRunning] = useState(false);
  const [every, setEvery] = useState(10);
  const [log, setLog] = useState<string[]>([]);
  const live = useRef(p);
  live.current = p;
  const worker = useRef<Worker | null>(null);
  const prices = useRef<number[]>([]);
  const tickNo = useRef(0);
  const busy = useRef(false);
  const fails = useRef(0);
  const sent = useRef<number[]>([]);

  useEffect(() => {
    try { const s = localStorage.getItem(STORE); if (s) setCode(s); } catch { /* storage may be unavailable */ }
  }, []);
  const say = useCallback((t: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${t}`, ...l].slice(0, 30)), []);

  const stop = useCallback((why?: string) => {
    worker.current?.terminate();
    worker.current = null;
    busy.current = false;
    setRunning(false);
    if (why) say(why);
  }, [say]);

  // stop when the match is no longer trading
  useEffect(() => { if (!p.active && running) stop('Match is not trading: bot stopped.'); }, [p.active, running, stop]);
  useEffect(() => () => { worker.current?.terminate(); }, []);

  const start = () => {
    try { localStorage.setItem(STORE, code); } catch { /* ignore */ }
    if (!p.active || !p.canTrade) { say('The bot can only run while the match is trading and your vault is ready.'); return; }
    let w: Worker;
    try {
      w = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })));
    } catch (e) { say(`This browser cannot run the bot sandbox: ${e instanceof Error ? e.message : String(e)}`); return; }
    worker.current = w;
    fails.current = 0;
    tickNo.current = 0;
    prices.current = [];
    sent.current = [];
    busy.current = false;
    let pending: { id: number; timer: ReturnType<typeof setTimeout> } | null = null;

    w.onmessage = async (ev: MessageEvent) => {
      const d = ev.data as { type: string; message?: string; id?: number; result?: unknown };
      if (d.type === 'ready') { setRunning(true); say(`Bot started: it looks at the market every ${every}s. Orders are real.`); return; }
      if (d.type === 'error') { stop(`Script error: ${d.message}`); return; }
      if (d.type !== 'result' || !pending || d.id !== pending.id) return;
      clearTimeout(pending.timer);
      pending = null;
      const r = d.result as Order | null;
      try {
        if (!r) { say('No order this time.'); return; }
        const cur = live.current;
        if (!cur.active) return;
        const now = Date.now();
        sent.current = sent.current.filter((t) => now - t < 60_000);
        if (r.action !== 'close' && sent.current.length >= MAX_PER_MIN) { say(`Skipped: more than ${MAX_PER_MIN} orders a minute.`); return; }
        if (r.action === 'close') {
          if (!cur.position) { say('Nothing to close.'); return; }
          sent.current.push(now);
          say('Closing your position…');
          await cur.onClose();
          say('Position closed.');
        } else if (r.action === 'buy' || r.action === 'sell') {
          const usd = Number((r as { usd: number }).usd);
          if (!Number.isFinite(usd) || usd < 1) { say('Ignored: the order needs usd of at least 1.'); return; }
          const capped = Math.min(usd, cur.bankroll);
          sent.current.push(now);
          say(`${r.action === 'buy' ? 'Buying' : 'Selling'} $${capped.toFixed(2)}${capped < usd ? ` (capped to your $${cur.bankroll} bankroll)` : ''}…`);
          await cur.onOrder(r.action, capped);
          say('Order sent.');
        } else {
          say('Ignored: unknown action. Use buy, sell or close.');
          return;
        }
        fails.current = 0;
      } catch (e) {
        fails.current += 1;
        say(`Order failed: ${e instanceof Error ? e.message : String(e)}`);
        if (fails.current >= MAX_FAILS) stop(`Stopped after ${MAX_FAILS} failed orders in a row.`);
      } finally {
        busy.current = false;
      }
    };
    w.postMessage({ type: 'load', code });

    const timer = setInterval(() => {
      const cur = live.current;
      if (!worker.current || busy.current) return;
      if (!cur.active || cur.price === null) return;
      prices.current = [...prices.current, cur.price].slice(-60);
      tickNo.current += 1;
      const ctx: BotCtx = { price: cur.price, prices: prices.current, position: cur.position, secondsLeft: cur.secondsLeft, team: cur.team, bankroll: cur.bankroll, tick: tickNo.current };
      busy.current = true;
      const id = tickNo.current;
      pending = { id, timer: setTimeout(() => { stop('Your script took longer than 4 seconds and was stopped.'); }, 4000) };
      worker.current.postMessage({ type: 'tick', id, ctx });
    }, every * 1000);
    const orig = w.terminate.bind(w);
    w.terminate = () => { clearInterval(timer); if (pending) clearTimeout(pending.timer); orig(); };
  };

  return (
    <div className="mt-4 border-t pt-3">
      <h3 className="font-medium mb-1">Your bot (your own script)</h3>
      <p className="text-xs opacity-70 mb-2">
        Paste your own strategy as <code>onTick(ctx)</code>. While the match is trading, the app runs it in a sandbox every few seconds and, if it returns an order, sends that
        real order from your vault. Keep this tab open. The script never sees your key; it can only return an order. Max {MAX_PER_MIN} orders a minute, each capped to your bankroll,
        and the bot stops after {MAX_FAILS} failed orders in a row.
      </p>
      <textarea
        className="w-full h-56 border rounded p-2 font-mono text-xs bg-transparent"
        spellCheck={false}
        value={code}
        disabled={running}
        onChange={(e) => setCode(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2 text-sm mt-2">
        <label>Run every
          <select className="border rounded px-1 ml-1 bg-transparent" value={every} disabled={running} onChange={(e) => setEvery(Number(e.target.value))}>
            {INTERVALS.map((s) => <option key={s} value={s}>{s}s</option>)}
          </select>
        </label>
        {!running
          ? <button className="border rounded px-3 py-1" onClick={start} disabled={!p.active || !p.canTrade}>Start bot</button>
          : <button className="border rounded px-3 py-1" onClick={() => stop('Bot stopped.')}>Stop bot</button>}
        <button className="border rounded px-3 py-1" disabled={running} onClick={() => setCode(EXAMPLE_SCRIPT)}>Reset to example</button>
        {running && <span className="text-xs text-emerald-400">Running</span>}
      </div>
      {log.length > 0 && <pre className="mt-2 max-h-40 overflow-auto text-xs opacity-80 whitespace-pre-wrap">{log.join('\n')}</pre>}
    </div>
  );
}
