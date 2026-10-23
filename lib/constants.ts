import { CryptoAsset } from './types';

// Static labels only. All prices, charts, volume and open interest are loaded live from the
// dreamDEX indexer (see lib/dreamdex.ts). All six are registered dreamDEX perp markets.
export const MARKET_META: { ticker: CryptoAsset; name: string }[] = [
  { ticker: 'BTC', name: 'Bitcoin' },
  { ticker: 'ETH', name: 'Ethereum' },
  { ticker: 'SOL', name: 'Solana' },
  { ticker: 'XRP', name: 'Ripple' },
  { ticker: 'DOGE', name: 'Dogecoin' },
  { ticker: 'BNB', name: 'BNB Chain' },
];
