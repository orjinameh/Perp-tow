import { GameMatch, PlayerSlot } from './types';
import { CONFIRM_SECONDS, LOBBY_SECONDS, MATCH_DURATION_SEC, MATCH_SIZE, MIN_PLAYERS, NOMINAL_STAKE_USD, TRADE_SECONDS } from './gameTag';
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
  const now = Math.floor(Date.now() / 1000);

  // Work out each match's phase from the registry's timestamps.
  interface Phase {
    m: (typeof chain)[number];
    roster: (typeof chain)[number]['players'];
    status: GameMatch['status'];
    lobbyEndsAt: number;
    confirmEndsAt: number;
    lockAt?: number;
    tradeEndsAt?: number;
  }
  const phases: Phase[] = chain.map((m) => {
    const lobbyEndsAt = m.firstAt + LOBBY_SECONDS;
    const confirmEndsAt = lobbyEndsAt + CONFIRM_SECONDS;
    let roster = m.players;
    let status: GameMatch['status'] = 'filling';
    let lockAt: number | undefined;
    if (m.fullAt > 0) {
      lockAt = m.fullAt; // full: locks at once
    } else if (now < lobbyEndsAt) {
      status = 'filling';
    } else if (now < confirmEndsAt) {
      status = 'confirming';
    } else {
      roster = m.players.filter((p) => p.confirmed);
      const bulls = roster.filter((p) => p.side === 1).length;
      const ok = roster.length >= MIN_PLAYERS && bulls > 0 && bulls < roster.length;
      if (ok) lockAt = confirmEndsAt;
      else status = 'cancelled'; // everyone is refunded
    }
    let tradeEndsAt: number | undefined;
    if (lockAt !== undefined) {
      tradeEndsAt = lockAt + TRADE_SECONDS;
      status = now < tradeEndsAt ? 'opening' : 'running';
    }
    return { m, roster, status, lobbyEndsAt, confirmEndsAt, lockAt, tradeEndsAt };
  });

  const starts = phases.filter((p) => p.tradeEndsAt !== undefined && now >= p.tradeEndsAt).map((p) => p.tradeEndsAt as number);
  const candles = starts.length ? await loadCandles(pool, Math.min(...starts) - 120).catch(() => [] as Candle[]) : [];

  const matches: GameMatch[] = [];
  for (const ph of phases) {
    const players: PlayerSlot[] = ph.roster.slice(0, MATCH_SIZE).map((p, i) => ({
      id: `${ticker}-${ph.m.number}-${i + 1}`,
      address: short(p.player),
      side: p.side === 1 ? 'bulls' : 'bears',
      joinedAt: `seat ${i + 1}`,
      isUser: me ? p.player.toLowerCase() === me.toLowerCase() : false,
      confirmed: p.confirmed,
    }));
    const bulls = players.filter((p) => p.side === 'bulls').length;
    const bears = players.length - bulls;
    const extra: Partial<GameMatch> = { lobbyEndsAt: ph.lobbyEndsAt, confirmEndsAt: ph.confirmEndsAt, lockAt: ph.lockAt, tradeEndsAt: ph.tradeEndsAt };
    let status = ph.status;
    if (ph.tradeEndsAt !== undefined && now >= ph.tradeEndsAt) {
      const startedAt = ph.tradeEndsAt; // the price clock starts once everyone's trade is open
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
          Object.assign(extra, { livePrice: candles.length ? candles[candles.length - 1].close : startPrice });
        }
      }
    }
    matches.push({
      ...extra,
      id: `${ticker} #${ph.m.number}`,
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
