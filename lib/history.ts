import { gql } from './indexer';
import { escrowEnabled, escrowStatus } from './escrow';
import { loadMatches } from './matches';
import { readMatches } from './registry';
import { CORE_RULES } from './payout';
import { MarketQueueData } from './types';

export interface MatchRecord {
  id: string;
  ticker: string;
  number: number;
  side: 'bulls' | 'bears';
  status: string; // lobby phase of the match
  outcome: 'won' | 'lost' | 'refund' | 'in progress' | 'waiting for result' | 'not staked' | 'cancelled';
  stakedUsd: number; // what went into the escrow
  netUsd: number | null; // profit (+) or loss (-) from the escrow once the result is known
  claimed: boolean;
  startedAt: number;
}

export interface TradeRecord {
  id: string;
  at: number;
  ticker: string;
  action: string;
  direction: 'long' | 'short';
  size: number;
  priceUsd: number | null;
  pnlUsd: number | null;
  txHash: string;
}

const usd18 = (raw: string | null | undefined) => (raw ? Number(BigInt(raw) / 10n ** 12n) / 1e6 : 0);

/** Every match this wallet took a seat in, with what the escrow did with its stake. Read from the chain. */
export async function loadMatchHistory(me: string, markets: MarketQueueData[]): Promise<MatchRecord[]> {
  const mine: { m: MarketQueueData; numbers: Map<number, 'bulls' | 'bears'> }[] = [];
  const queue = [...markets];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let m = queue.shift(); m; m = queue.shift()) {
        try {
          const rows = await readMatches(m.ticker);
          const numbers = new Map<number, 'bulls' | 'bears'>();
          for (const r of rows) {
            const p = r.players.find((x) => x.player.toLowerCase() === me.toLowerCase());
            if (p) numbers.set(r.number, p.side === 1 ? 'bulls' : 'bears');
          }
          if (numbers.size) mine.push({ m, numbers });
        } catch {
          /* a market with no registry data is skipped */
        }
      }
    }),
  );

  const out: MatchRecord[] = [];
  for (const { m, numbers } of mine) {
    const all = await loadMatches(m.pool, m.ticker, me).catch(() => []);
    for (const [number, side] of numbers) {
      const g = all.find((x) => x.id === `${m.ticker} #${number}`);
      const esc = escrowEnabled ? await escrowStatus(m.ticker, number, me as `0x${string}`).catch(() => null) : null;
      const stake = CORE_RULES.ENTRY_FEE;
      let outcome: MatchRecord['outcome'] = 'in progress';
      let net: number | null = null;
      if (g?.status === 'cancelled') outcome = 'cancelled';
      else if (esc && !esc.joined) outcome = g && ['running', 'settled'].includes(g.status) ? 'not staked' : 'in progress';
      else if (esc && esc.joined) {
        if (esc.result === 0) outcome = g?.status === 'settled' ? 'waiting for result' : 'in progress';
        else if (esc.result === 3) {
          outcome = 'refund';
          net = 0;
        } else {
          const winner = esc.result === 1 ? 'bulls' : 'bears';
          const w = winner === 'bulls' ? esc.bulls : esc.bears;
          const l = winner === 'bulls' ? esc.bears : esc.bulls;
          if (side === winner) {
            outcome = 'won';
            net = (stake * l * (1 - CORE_RULES.RAKE_RATE)) / Math.max(1, w);
          } else {
            outcome = 'lost';
            net = -stake;
          }
        }
      } else if (g?.status === 'settled') {
        outcome = g.settledResult === 'tie' ? 'refund' : g.settledResult === side ? 'won' : 'lost';
      }
      out.push({
        id: `${m.ticker} #${number}`,
        ticker: m.ticker,
        number,
        side,
        status: g?.status ?? 'unknown',
        outcome,
        stakedUsd: esc?.joined ? stake : 0,
        netUsd: net,
        claimed: esc?.claimed ?? false,
        startedAt: g?.tradeEndsAt ?? g?.lobbyEndsAt ?? 0,
      });
    }
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

interface ChangeRow {
  id: string;
  kind: string;
  pool: string;
  closedSize: string;
  sizeBefore: string;
  sizeAfter: string;
  entryPriceAfter: string | null;
  exitPrice: string | null;
  realizedPnl: string | null;
  timestamp: string;
  txHash: string;
}

/** This wallet's real position changes on dreamDEX: opens, adds, reductions and closes. */
export async function loadTradeHistory(me: string, markets: MarketQueueData[], limit = 60): Promise<TradeRecord[]> {
  const d = await gql<{ PerpPositionChange: ChangeRow[] }>(`{ PerpPositionChange(
    limit: ${limit}, where: {account: {_eq: "${me.toLowerCase()}"}}, order_by: {timestamp: desc}
  ) { id kind pool closedSize sizeBefore sizeAfter entryPriceAfter exitPrice realizedPnl timestamp txHash } }`);
  const byPool = new Map(markets.map((m) => [m.pool.toLowerCase(), m]));
  return d.PerpPositionChange.map((r) => {
    const m = byPool.get(r.pool.toLowerCase());
    const dec = m?.baseDecimals ?? 18;
    const before = BigInt(r.sizeBefore);
    const after = BigInt(r.sizeAfter);
    const abs = (x: bigint) => (x < 0n ? -x : x);
    const closing = r.kind === 'REDUCE' || r.kind === 'CLOSE';
    const sizeRaw = closing ? BigInt(r.closedSize) : r.kind === 'FLIP' ? abs(after) : abs(after) - abs(before);
    const dirRaw = closing ? before : after;
    const action = { OPEN: 'Opened', INCREASE: 'Added to', REDUCE: 'Reduced', CLOSE: 'Closed', FLIP: 'Flipped to' }[r.kind] ?? r.kind;
    const price = closing ? r.exitPrice : r.entryPriceAfter;
    return {
      id: r.id,
      at: Number(r.timestamp),
      ticker: m?.ticker ?? `${r.pool.slice(0, 6)}…`,
      action,
      direction: dirRaw < 0n ? 'short' : 'long',
      size: Number(sizeRaw) / 10 ** dec,
      priceUsd: price ? Number(price) / 1e18 : null,
      pnlUsd: closing ? usd18(r.realizedPnl) : null,
      txHash: r.txHash,
    };
  });
}
