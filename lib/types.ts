export type CryptoAsset = string; // base symbol of a dreamDEX perp market, e.g. 'BTC'

export type PositionSide = 'bulls' | 'bears'; // bulls = Long, bears = Short

export interface MarketCandle {
  t: number; // unix seconds, start of the 1-minute bucket
  open: number;
  close: number;
  high: number;
  low: number;
  volumeUsd: number;
}

export interface LiveTrade {
  id: string;
  timestamp: number; // unix seconds
  price: number; // USD
  size: number; // base units, e.g. BTC
  takerIsBuy: boolean;
  txHash: string;
}

export interface MarketQueueData {
  ticker: CryptoAsset;
  name: string;
  pool: string; // dreamDEX perp pool address
  baseDecimals: number;
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
  confirmed?: boolean;
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
  status: 'filling' | 'confirming' | 'opening' | 'running' | 'settled' | 'cancelled' | 'full';
  playersList?: PlayerSlot[];
  settledResult?: 'bulls' | 'bears' | 'tie';
  lobbyEndsAt?: number; // unix seconds: the lobby closes (if not full)
  confirmEndsAt?: number; // unix seconds: last moment to say "continue"
  lockAt?: number; // unix seconds: the roster is fixed
  tradeEndsAt?: number; // unix seconds: players should have opened their trade; the price clock starts
  startedAt?: number; // unix seconds: the price clock started (start price taken here)
  endsAt?: number;
  startPrice?: number; // USD, from the market's 1-minute candles at startedAt
  endPrice?: number; // USD at endsAt (only once the match is over)
  livePrice?: number; // USD, latest candle close while the match runs
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
