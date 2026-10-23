import { DualScenarioPayout, PayoutBreakdown } from './types';

export const CORE_RULES = {
  REQUIRED_PLAYERS: 20,
  ENTRY_FEE: 10, // $10 per player
  RAKE_RATE: 0.10, // 10% of the losing team's pool
};

/**
 * Calculates payout for a winning player based on:
 * P = e + (1 - r) * e * L / W
 * Profit = P - e
 * 
 * @param entryFee e
 * @param winnerCount W
 * @param loserCount L
 * @param rake r (default 0.10)
 */
export function calculatePayout({
  entryFee = CORE_RULES.ENTRY_FEE,
  winnerCount,
  loserCount,
  rake = CORE_RULES.RAKE_RATE,
}: {
  entryFee?: number;
  winnerCount: number;
  loserCount: number;
  rake?: number;
}): PayoutBreakdown | null {
  if (winnerCount <= 0) {
    return null;
  }

  const totalPool = entryFee * (winnerCount + loserCount);
  const losingPool = entryFee * loserCount;
  const platformRake = losingPool * rake;
  const redistributedPool = losingPool - platformRake;
  const redistributionPerWinner = redistributedPool / winnerCount;
  const payoutPerWinner = entryFee + redistributionPerWinner;
  const netProfitPerWinner = payoutPerWinner - entryFee;
  const roiPercentage = (netProfitPerWinner / entryFee) * 100;

  return {
    winningPlayers: winnerCount,
    losingPlayers: loserCount,
    totalPool,
    losingPool,
    platformRake,
    redistributedPool,
    payoutPerWinner,
    netProfitPerWinner,
    roiPercentage,
  };
}

/**
 * Calculates both potential outcomes (Bulls Win vs Bears Win)
 * when a match is full (total players === 20).
 */
export function calculateScenarioPayouts({
  bullsCount,
  bearsCount,
  entryFee = CORE_RULES.ENTRY_FEE,
  rake = CORE_RULES.RAKE_RATE,
}: {
  bullsCount: number;
  bearsCount: number;
  entryFee?: number;
  rake?: number;
}): DualScenarioPayout {
  const bullsWin = calculatePayout({
    entryFee,
    winnerCount: bullsCount,
    loserCount: bearsCount,
    rake,
  });

  const bearsWin = calculatePayout({
    entryFee,
    winnerCount: bearsCount,
    loserCount: bullsCount,
    rake,
  });

  return {
    bullsWin,
    bearsWin,
  };
}
