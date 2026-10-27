import { gql } from './indexer';

const cache = new Map<string, `0x${string}`>();

/** The perp pool address of a market, from the dreamDEX indexer. dreamDEX's bot permission is granted per pool. */
export async function poolOf(ticker: string): Promise<`0x${string}`> {
  const hit = cache.get(ticker);
  if (hit) return hit;
  const d = await gql<{ Market: { id: string }[] }>(`{ Market(where: {baseSymbol: {_eq: "${ticker.replace(/[^A-Za-z0-9]/g, '')}"}, perpRegistered: {_eq: true}}) { id } }`);
  const id = d.Market[0]?.id;
  if (!id) throw new Error(`No perp market ${ticker} was found.`);
  cache.set(ticker, id as `0x${string}`);
  return id as `0x${string}`;
}
