export type CryptoAsset = 'BTC' | 'ETH' | 'SOL' | 'XRP' | 'DOGE' | 'BNB';

export type PositionSide = 'bulls' | 'bears'; // bulls = Long, bears = Short

export interface MarketCandle {
  t: number; // unix seconds, start of the 1-minute bucket
  open: number;
  close: number;
  high: number;
  low: number;
  volumeUsd: number;
}

export interface MarketQueueData {
  ticker: CryptoAsset;
  name: string;
  pool: string; // dreamDEX perp pool address
  price: number; // last traded price, USD
  priceChange24h: number; // percentage over the last 24h of candles
  waitingBulls: number; // players waiting in the game queue (0 until the game contract exists)
  waitingBears: number;
  high24h: number;
  low24h: number;
  volume24hUsd: number;
  openInterestUsd: number;
  candles: MarketCandle[]; // 1-minute candles, last 24h, oldest first
}

export interface PlayerSlot {
  id: string;
  address: string;
  side: PositionSide;
  joinedAt: string;
  isUser?: boolean;
}

export interface GameMatch {
  id: string; // e.g. "BTC #1"
  market: CryptoAsset;
  bulls: number;
  bears: number;
  total: number;
  requiredPlayers: number; // always 20
  slotsRemaining: number;
  entryFee: number; // $10
  status: 'filling' | 'full' | 'settled';
  playersList?: PlayerSlot[];
  settledResult?: 'bulls' | 'bears';
}

export interface PayoutBreakdown {
  winningPlayers: number;
  losingPlayers: number;
  totalPool: number;
  losingPool: number;
  platformRake: number;
  redistributedPool: number;
  payoutPerWinner: number;
  netProfitPerWinner: number;
  roiPercentage: number;
}

export interface DualScenarioPayout {
  bullsWin: PayoutBreakdown | null;
  bearsWin: PayoutBreakdown | null;
}

export type PrototypeScreen = 'lobby' | 'chart' | 'matches' | 'inspect' | 'entry' | 'done';
