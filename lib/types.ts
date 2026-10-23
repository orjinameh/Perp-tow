export type CryptoAsset = 'BTC' | 'ETH' | 'SOL' | 'XRP' | 'DOGE' | 'BNB';

export type PositionSide = 'bulls' | 'bears'; // bulls = Long, bears = Short

export interface MarketQueueData {
  ticker: CryptoAsset;
  name: string;
  price: number;
  priceChange24h: number; // percentage, e.g. +3.4% or -1.8%
  waitingBulls: number; // global queue count
  waitingBears: number; // global queue count
  high24h: number;
  low24h: number;
  volume24h: string;
  chartData: { time: string; price: number }[];
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
