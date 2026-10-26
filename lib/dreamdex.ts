import { CryptoAsset, LiveTrade, MarketCandle, MarketQueueData } from './types';
import { MARKET_NAMES } from './constants';

// Real market data from the dreamDEX Hideki testnet indexer (via our /api/indexer pass-through).
// Prices on dreamDEX are always 18-decimal fixed point, whatever the market's base decimals are.
const PRICE_SCALE = 1e18;

async function gql<T>(query: string): Promise<T> {
  const res = await fetch('/api/indexer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  let json: { data?: T; errors?: { message: string }[] };
  try {
    json = await res.json();
  } catch {
    throw new Error(`indexer returned a non-JSON response (HTTP ${res.status})`);
  }
  if (json.errors?.length) throw new Error(json.errors[0].message);
  if (!json.data) throw new Error('indexer returned no data');
  return json.data;
}

interface RawMarket {
  id: string;
  baseSymbol: string;
  baseDecimals: number;
  lastPrice: string | null;
  indexPrice: string | null;
  openInterest: string | null;
}

interface RawCandle {
  bucketStart: string;
  openPrice: string;
  closePrice: string;
  high: string;
  low: string;
  quoteVolume: string;
}

async function fetchCandles(pool: string, sinceUnix: number): Promise<MarketCandle[]> {
  const rows: RawCandle[] = [];
  const PAGE = 500;
  for (let offset = 0; offset < 1500; offset += PAGE) {
    const d = await gql<{ Candle: RawCandle[] }>(`{ Candle(
      limit: ${PAGE}, offset: ${offset},
      where: {pool: {_eq: "${pool}"}, intervalSeconds: {_eq: 60}, bucketStart: {_gte: "${sinceUnix}"}},
      order_by: {bucketStart: asc}
    ) { bucketStart openPrice closePrice high low quoteVolume } }`);
    rows.push(...d.Candle);
    if (d.Candle.length < PAGE) break;
  }
  return rows.map((c) => ({
    t: Number(c.bucketStart),
    open: Number(c.openPrice) / PRICE_SCALE,
    close: Number(c.closePrice) / PRICE_SCALE,
    high: Number(c.high) / PRICE_SCALE,
    low: Number(c.low) / PRICE_SCALE,
    volumeUsd: Number(c.quoteVolume) / PRICE_SCALE,
  }));
}

/** Loads live data for every registered dreamDEX perp market. Markets that fail to load are listed in `failed`. */
export async function loadMarkets(): Promise<{ markets: MarketQueueData[]; failed: CryptoAsset[] }> {
  const d = await gql<{ Market: RawMarket[] }>(`{ Market(
    where: {perpRegistered: {_eq: true}}, limit: 100
  ) { id baseSymbol baseDecimals lastPrice indexPrice openInterest } }`);

  // Each market's own limit: max leverage = 10000 / initial margin (in basis points).
  const maxLev = new Map<string, number>();
  try {
    const m = await gql<{ Market: { id: string; initialMarginBps: number | string | null }[] }>(`{ Market(where: {perpRegistered: {_eq: true}}, limit: 100) { id initialMarginBps } }`);
    for (const r of m.Market) {
      const bps = Number(r.initialMarginBps);
      if (bps > 0) maxLev.set(r.id, Math.floor(10_000 / bps));
    }
  } catch {
    /* unknown limits: the screens fall back to the default choices */
  }

  const since = Math.floor(Date.now() / 1000) - 24 * 3600;
  const failed: CryptoAsset[] = [];
  const markets: MarketQueueData[] = [];

  const build = async (raw: RawMarket) => {
    try {
      const candles = await fetchCandles(raw.id, since);
      const priceRaw = raw.lastPrice ?? raw.indexPrice;
      const price = priceRaw ? Number(priceRaw) / PRICE_SCALE : candles.length ? candles[candles.length - 1].close : NaN;
      if (!Number.isFinite(price)) throw new Error('no price');
      const first = candles[0];
      const priceChange24h = first && first.open > 0 ? ((price - first.open) / first.open) * 100 : 0;
      const oi = raw.openInterest ? Number(raw.openInterest) / 10 ** raw.baseDecimals : 0;
      markets.push({
        ticker: raw.baseSymbol,
        name: MARKET_NAMES[raw.baseSymbol] ?? raw.baseSymbol,
        pool: raw.id,
        baseDecimals: raw.baseDecimals,
        maxLeverage: maxLev.get(raw.id),
        price,
        priceChange24h: Math.round(priceChange24h * 100) / 100,
        high24h: candles.length ? Math.max(...candles.map((c) => c.high)) : price,
        low24h: candles.length ? Math.min(...candles.map((c) => c.low)) : price,
        volume24hUsd: candles.reduce((s, c) => s + c.volumeUsd, 0),
        openInterestUsd: oi * price,
        candles,
        // No game contract exists yet, so there is genuinely nobody waiting.
        waitingBulls: 0,
        waitingBears: 0,
      });
    } catch {
      failed.push(raw.baseSymbol);
    }
  };

  // Load a few markets at a time so we do not hammer the public indexer.
  const queue = [...d.Market];
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      for (let raw = queue.shift(); raw; raw = queue.shift()) await build(raw);
    }),
  );

  markets.sort((a, b) => b.volume24hUsd - a.volume24hUsd); // busiest market first
  return { markets, failed };
}

interface RawFill {
  id: string;
  timestamp: string;
  fillPrice: string;
  quantity: string;
  takerIsBid: boolean;
  txHash: string;
}

/** The most recent fills (real trades) on one perp pool, newest first. */
export async function loadRecentTrades(pool: string, baseDecimals: number, limit = 15): Promise<LiveTrade[]> {
  const d = await gql<{ Fill: RawFill[] }>(`{ Fill(
    limit: ${limit}, where: {pool: {_eq: "${pool}"}}, order_by: {blockNumber: desc, logIndex: desc}
  ) { id timestamp fillPrice quantity takerIsBid txHash } }`);
  return d.Fill.map((f) => ({
    id: f.id,
    timestamp: Number(f.timestamp),
    price: Number(f.fillPrice) / PRICE_SCALE,
    size: Number(f.quantity) / 10 ** baseDecimals,
    takerIsBuy: f.takerIsBid,
    txHash: f.txHash,
  }));
}

export function formatUsdCompact(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(n);
}
