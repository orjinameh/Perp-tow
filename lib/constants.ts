// Display names for markets we know well. Every other perp market falls back to its symbol.
// Prices, charts, volume and open interest are all loaded live (see lib/dreamdex.ts).
export const MARKET_NAMES: Record<string, string> = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  SOL: 'Solana',
  XRP: 'Ripple',
  DOGE: 'Dogecoin',
  BNB: 'BNB Chain',
  ADA: 'Cardano',
  AVAX: 'Avalanche',
  LINK: 'Chainlink',
  NEAR: 'NEAR Protocol',
  SUI: 'Sui',
  XLM: 'Stellar',
  HYPE: 'Hyperliquid',
  ZEC: 'Zcash',
  TAO: 'Bittensor',
  WLD: 'Worldcoin',
};
