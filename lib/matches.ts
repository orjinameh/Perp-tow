import { GameMatch, PlayerSlot } from './types';
import { MATCH_DURATION_SEC, MATCH_SIZE, NOMINAL_STAKE_USD } from './gameTag';
import { readMatches } from './registry';

interface Candle { t: number; open: number; close: number }

async function loadCandles(pool: string, since: number): Promise<Candle[]> {
  const d = await gql<{ Candle: { bucketStart: string; openPrice: string; closePrice: string }[] }>(`{ Candle(
    limit: 1000,
    where: {pool: {_eq: "${pool}"}, intervalSeconds: {_eq: 60}, bucketStart: {_gte: "${since}"}},
    order_by: {bucketStart: asc}
  ) { bucketStart openPrice closePrice } }`);
  return d.Candle.map((c) => ({ t: Number(c.bucketStart), open: Number(c.openPrice) / 1e18, close: Number(c.closePrice) / 1e18 }));
}

/** The market price at a moment: the open of the minute it falls in, or the last close before it if that minute had no trades. */
function priceAt(candles: Candle[], t: number): number | undefined {
  let prev: Candle | undefined;
  for (const c of candles) {
    if (c.t > t) break;
    prev = c;
  }
  if (!prev) return undefined;
  return t < prev.t + 60 ? prev.open : prev.close;
}

async function gql<T>(query: string): Promise<T> {
  const url = typeof window === 'undefined' ? process.env.INDEXER_URL ?? 'https://hideki-dev.smk.somnia.host/v1/graphql' : '/api/indexer';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data as T;
}

const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

/**
 * Rebuilds this market's matches from the seat registry's Entered events. Seats are enforced on
 * chain (a match refuses player N+1), so the roster here is exactly what the contract recorded.
 * Start and end prices come from the market's 1-minute candles. Nothing here is stored by us.
 */
export async function loadMatches(pool: string, ticker: string, me: string | null): Promise<GameMatch[]> {
  const chain = await readMatches(ticker);

  // A full match started when its last seat was taken; the registry stored that time.
  const starts = chain.filter((m) => m.startedAt > 0).map((m) => m.startedAt);
  const candles = starts.length ? await loadCandles(pool, Math.min(...starts) - 120).catch(() => [] as Candle[]) : [];
  const now = Math.floor(Date.now() / 1000);

  const matches: GameMatch[] = [];
  for (const m of chain) {
    const players: PlayerSlot[] = m.players.slice(0, MATCH_SIZE).map((p, i) => ({
      id: `${ticker}-${m.number}-${i + 1}`,
      address: short(p.player),
      side: p.side === 1 ? 'bulls' : 'bears',
      joinedAt: `seat ${i + 1}`,
      isUser: me ? p.player.toLowerCase() === me.toLowerCase() : false,
    }));
    const bulls = players.filter((p) => p.side === 'bulls').length;
    const bears = players.length - bulls;
    const full = players.length >= MATCH_SIZE;
    const extra: Partial<GameMatch> = {};
    let status: GameMatch['status'] = full ? 'full' : 'filling';
    if (full && m.startedAt > 0) {
      const startedAt = m.startedAt;
      const endsAt = startedAt + MATCH_DURATION_SEC;
      const startPrice = priceAt(candles, startedAt);
      Object.assign(extra, { startedAt, endsAt, startPrice });
      if (startPrice !== undefined) {
        if (now >= endsAt) {
          const endPrice = priceAt(candles, endsAt);
          if (endPrice !== undefined) {
            status = 'settled';
            Object.assign(extra, { endPrice, settledResult: endPrice > startPrice ? 'bulls' : endPrice < startPrice ? 'bears' : 'tie' });
          }
        } else {
          status = 'running';
          Object.assign(extra, { livePrice: candles.length ? candles[candles.length - 1].close : startPrice });
        }
      }
    }
    matches.push({
      ...extra,
      id: `${ticker} #${m.number}`,
      market: ticker,
      bulls,
      bears,
      total: players.length,
      requiredPlayers: MATCH_SIZE,
      slotsRemaining: MATCH_SIZE - players.length,
      entryFee: NOMINAL_STAKE_USD,
      status,
      playersList: players,
    });
  }
  return matches;
}

/** The next free match number on a market. */
export function nextMatchNumber(matches: GameMatch[]): number {
  return matches.reduce((max, m) => Math.max(max, Number(m.id.split('#')[1])), 0) + 1;
}

/** An empty draft match: nothing is on chain until the first player enters it. */
export function draftMatch(ticker: string, number: number): GameMatch {
  return {
    id: `${ticker} #${number}`,
    market: ticker,
    bulls: 0,
    bears: 0,
    total: 0,
    requiredPlayers: MATCH_SIZE,
    slotsRemaining: MATCH_SIZE,
    entryFee: NOMINAL_STAKE_USD,
    status: 'filling',
    playersList: [],
  };
}

/** How hard the rope is pulled by the price move: -1 (Bears) to +1 (Bulls), full pull at a 0.15% move. */
export function matchPull(m: GameMatch): { bias: number; label: string } | null {
  const end = m.endPrice ?? m.livePrice;
  if (m.status === 'filling' || !m.startPrice || !end) return null;
  const movePct = ((end - m.startPrice) / m.startPrice) * 100;
  return { bias: Math.max(-1, Math.min(1, movePct / 0.15)), label: `${movePct >= 0 ? '+' : ''}${movePct.toFixed(3)}%` };
}
