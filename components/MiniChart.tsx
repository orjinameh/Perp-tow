'use client';

import React, { useEffect, useState } from 'react';
import { gql } from '@/lib/indexer';
import { Skeleton } from '@/components/Skeleton';

interface Raw {
  bucketStart: string;
  closePrice: string;
}

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : n < 100 ? 3 : 2 })}`;
const W = 640;
const H = 190;

/** Live 1-minute price line for the last few hours, for studying the market while a lobby is open. */
export const MiniChart: React.FC<{ ticker: string; startPrice?: number; hours?: number }> = ({ ticker, startPrice, hours = 3 }) => {
  const [pts, setPts] = useState<{ t: number; p: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    let pool: string | null = null;
    const load = async () => {
      try {
        if (!pool) {
          const m = await gql<{ Market: { id: string }[] }>(`{ Market(where: {baseSymbol: {_eq: "${ticker}"}, perpRegistered: {_eq: true}}, limit: 1) { id } }`);
          pool = m.Market[0]?.id ?? null;
          if (!pool) throw new Error(`No ${ticker} market found.`);
        }
        const since = Math.floor(Date.now() / 1000) - hours * 3600;
        const d = await gql<{ Candle: Raw[] }>(`{ Candle(limit: ${hours * 60 + 5}, where: {pool: {_eq: "${pool}"}, intervalSeconds: {_eq: 60}, bucketStart: {_gte: "${since}"}}, order_by: {bucketStart: asc}) { bucketStart closePrice } }`);
        if (!off) {
          setPts(d.Candle.map((c) => ({ t: Number(c.bucketStart), p: Number(c.closePrice) / 1e18 })));
          setError(null);
        }
      } catch (e) {
        if (!off) setError(e instanceof Error ? e.message : String(e));
      }
    };
    load();
    const id = setInterval(load, 20_000);
    return () => {
      off = true;
      clearInterval(id);
    };
  }, [ticker, hours]);

  if (error && !pts) return <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-400">Chart unavailable: {error}</div>;
  if (!pts) return <Skeleton className="h-44 w-full rounded-xl" />;
  if (pts.length < 2) return <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-400">No recent {ticker} candles to draw yet.</div>;

  const values = pts.map((x) => x.p).concat(startPrice ? [startPrice] : []);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * (W - 70) + 4;
  const y = (p: number) => 14 + (1 - (p - lo) / span) * (H - 34);
  const last = pts[pts.length - 1].p;
  const up = last >= pts[0].p;
  const col = up ? '#34d399' : '#fb7185';
  const line = pts.map((q) => `${x(q.t).toFixed(1)},${y(q.p).toFixed(1)}`).join(' ');

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-semibold text-zinc-200">{ticker}-PERP · last {hours}h</span>
        <span className="font-mono" style={{ color: col }}>
          {money(last)} ({((last / pts[0].p - 1) * 100).toFixed(2)}%)
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40" role="img" aria-label={`${ticker} price over the last ${hours} hours`}>
        {[0, 0.5, 1].map((g) => (
          <g key={g}>
            <line x1="4" x2={W - 66} y1={14 + g * (H - 34)} y2={14 + g * (H - 34)} stroke="#1e293b" strokeWidth="1" />
            <text x={W - 62} y={18 + g * (H - 34)} fill="#64748b" fontSize="11">
              {money(hi - g * span)}
            </text>
          </g>
        ))}
        {startPrice ? (
          <g>
            <line x1="4" x2={W - 66} y1={y(startPrice)} y2={y(startPrice)} stroke="#fbbf24" strokeWidth="1.5" strokeDasharray="5 4" />
            <text x={W - 62} y={y(startPrice) + 4} fill="#fbbf24" fontSize="11">
              start
            </text>
          </g>
        ) : null}
        <polyline points={line} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round" />
        <circle cx={x(t1)} cy={y(last)} r="3.5" fill={col} />
      </svg>
    </div>
  );
};
