import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { createPublicClient, formatEther, formatUnits, http, parseAbi } from 'viem';
import { PositionSide } from './types';
import { encodeUserData, LEVERAGE } from './gameTag';

export const RPC_URL = 'https://api.hideki2.infra.testnet.somnia.network';
export const WS_URL = 'wss://api.hideki2.infra.testnet.somnia.network/ws';
export const EXPLORER_TX = 'https://explorer.testnet.somnia.network/tokyo/tx/';

type Hex = `0x${string}`;
const ORDER_TYPE_MARKET = 2; // the pool's order type 2: cross the book now, never rest
const SLIPPAGE_BPS = 50n; // a market order pays up to 0.5% past the last price

// Subset of a perp market row from the SDK that this file uses (all raw integers as strings).
interface PerpRow {
  baseSymbol: string;
  baseDecimals: number;
  poolAddress: Hex;
  marginBank: Hex;
  tickSize: string;
  lotSize: string;
  minQuantity: string;
  markPrice: string;
}

export interface EntryReceipt {
  txHash: string | null;
  orderId: string | null;
  quantity: number; // base units, e.g. 0.00013 BTC
  filledQuantity: number;
  price: number; // limit price sent, USD
  notionalUsd: number;
  raisedToMinimum: boolean; // the nominal stake was below the market's minimum order
  seatOnly?: boolean; // only a seat was taken: the real order is placed when the match locks
}

function baseConfig() {
  return {
    chain: hidekiTestnet,
    // Through our own server route so the browser never hits a CORS wall.
    indexerUrl: `${window.location.origin}/api/indexer`,
    wsRpcUrl: WS_URL,
    addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
  };
}

/** Trades the game wallet's own dreamDEX account. */
function makeExchange(key: Hex) {
  return new SomniaMarkets({ ...baseConfig(), privateKey: key });
}

export async function getSttBalance(address: Hex): Promise<string> {
  const client = createPublicClient({ chain: hidekiTestnet, transport: http(RPC_URL) });
  return formatEther(await client.getBalance({ address }));
}

// USDso, the perps collateral (18 decimals), from the dreamDEX docs' contract table.
const USDSO = '0xed7993A74dAe1e6656B704A424DcD8711aAf4F72' as const;

export async function getUsdsoBalance(address: Hex): Promise<string> {
  const client = createPublicClient({ chain: hidekiTestnet, transport: http(RPC_URL) });
  const raw = (await client.readContract({
    address: USDSO,
    abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
    functionName: 'balanceOf',
    args: [address],
  })) as bigint;
  return formatUnits(raw, 18);
}

/** Moves the game wallet's USDso into its perps margin bank, which is where perp orders lock their margin. */
export async function depositAllToMargin(key: Hex, address: Hex): Promise<string> {
  const ex = makeExchange(key);
  const rows = (await ex.client.listPerpMarkets()) as unknown as PerpRow[];
  const bank = (rows.find((r) => r.baseSymbol === 'BTC') ?? rows[0])?.marginBank;
  if (!bank) throw new Error('No perp market was returned, so there is no margin bank to deposit into.');
  const walletClient = createPublicClient({ chain: hidekiTestnet, transport: http(RPC_URL) });
  let raw = (await walletClient.readContract({
    address: USDSO,
    abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
    functionName: 'balanceOf',
    args: [address],
  })) as bigint;
  // With the escrow on, keep 20 USDso in the wallet for stakes; the rest goes to margin.
  if (process.env.NEXT_PUBLIC_ESCROW_ADDRESS) raw = raw > 20n * 10n ** 18n ? raw - 20n * 10n ** 18n : 0n;
  if (raw === 0n) throw new Error('Nothing to deposit (with the escrow on, 20 USDso stay in the wallet for stakes).');

  const deposit = (ex.trader as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>).depositMargin;
  const call = deposit.bind(ex.trader);
  try {
    await call({ marginBank: bank, amount: raw });
  } catch (first) {
    const msg = first instanceof Error ? first.message : String(first);
    // Argument-shape errors are thrown before anything is sent, so trying the positional form cannot double-send.
    if (/reverted|insufficient|allowance/i.test(msg) || !/marginBank|amount|argument|invalid|undefined|required|bigint|type/i.test(msg)) {
      throw first;
    }
    try {
      await call(bank, raw);
    } catch (second) {
      throw new Error(
        `depositMargin failed both as an object and as (bank, amount). First: ${msg.slice(0, 160)} | Second: ${
          second instanceof Error ? second.message.slice(0, 160) : String(second)
        } | function: ${String(deposit).slice(0, 300)}`,
      );
    }
  }
  return `Deposited ${formatUnits(raw, 18)} USDso into the margin bank.`;
}

/** Claims the one-time paper USDso credit for this wallet, if it is still eligible. */
export async function claimPaperCredit(key: Hex, address: Hex): Promise<string> {
  const ex = makeExchange(key);
  const rows = (await ex.client.listPerpMarkets()) as unknown as PerpRow[];
  // The docs claim on the BTC market's margin bank.
  const bank = (rows.find((r) => r.baseSymbol === 'BTC') ?? rows[0])?.marginBank;
  if (!bank) throw new Error('No perp market was returned, so there is no margin bank to claim on.');
  const elig = (await ex.client.getPerpVoucherEligibility(bank, address)) as unknown as { eligible: boolean; alreadyClaimed?: boolean };
  const eligText = JSON.stringify(elig, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  if (elig.alreadyClaimed) return 'This wallet already claimed its paper USDso credit.';
  if (!elig.eligible) return `This wallet is not eligible for the paper USDso credit. dreamDEX says: ${eligText}`;
  try {
    await ex.trader.claimPerpVoucher({ marginBank: bank });
  } catch (e) {
    const err = e as { message?: string; shortMessage?: string; details?: string; cause?: { shortMessage?: string; details?: string; reason?: string } };
    const why = [err.shortMessage, err.details, err.cause?.shortMessage, err.cause?.details, err.cause?.reason, err.message]
      .filter(Boolean)
      .join(' | ')
      .slice(0, 500);
    throw new Error(`${why} [margin bank ${bank}, eligibility ${eligText}]`);
  }
  return 'Claimed 1,000 paper USDso.';
}

/** Opens a real perp position on dreamDEX: a market order tagged with this match's number. */
export async function enterMatch(args: {
  key: Hex;
  address: Hex;
  ticker: string;
  side: PositionSide;
  matchNumber: number;
  stakeUsd: number;
  leverage?: number; // defaults to the game's default; never affects who wins
}): Promise<EntryReceipt> {
  const { key, address, ticker, side, matchNumber, stakeUsd } = args;
  const lev = args.leverage ?? LEVERAGE;
  const account = address; // the game wallet always trades its own account
  const ex = makeExchange(key);
  const rows = (await ex.client.listPerpMarkets()) as unknown as PerpRow[];
  const m = rows.find((r) => r.baseSymbol === ticker);
  if (!m) throw new Error(`${ticker} is not a dreamDEX perp market right now.`);

  const isBid = side === 'bulls';
  const dec = BigInt(m.baseDecimals);
  const tick = BigInt(m.tickSize);
  const lot = BigInt(m.lotSize);
  const min = BigInt(m.minQuantity);
  const mark = BigInt(m.markPrice);

  // Price: mark price plus/minus slippage, on the tick grid. Quantity: the stake in base units,
  // on the lot grid, raised to the market minimum if the stake is smaller than that.
  const slipped = isBid ? (mark * (10_000n + SLIPPAGE_BPS)) / 10_000n : (mark * (10_000n - SLIPPAGE_BPS)) / 10_000n;
  const price = tick > 0n ? (slipped / tick) * tick : slipped;
  // The stake is the margin; the position is the stake times the game's leverage.
  const stake18 = BigInt(Math.round(stakeUsd * lev * 1e6)) * 10n ** 12n;
  let quantity = (stake18 * 10n ** dec) / mark;
  quantity = lot > 0n ? (quantity / lot) * lot : quantity;
  let raisedToMinimum = false;
  if (quantity < min) {
    quantity = lot > 0n ? ((min + lot - 1n) / lot) * lot : min;
    raisedToMinimum = true;
  }

  // Same leverage for every player. Set once per wallet and market, then remembered in this browser.
  const levKey = `tow.lev.${m.poolAddress}.${account}`;
  let levDone = false;
  try {
    levDone = localStorage.getItem(levKey) === String(lev);
  } catch {
    /* storage unavailable: set it again */
  }
  if (!levDone) {
    try {
      await (ex.trader as unknown as { setPerpLeverage: (p: { pool: Hex; leverageX: number }) => Promise<unknown> }).setPerpLeverage({ pool: m.poolAddress, leverageX: lev });
      try {
        localStorage.setItem(levKey, String(lev));
      } catch {
        /* ignore */
      }
    } catch (e) {
      throw new Error(`Could not set ${lev}x leverage on ${ticker}-PERP: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    }
  }

  // The docs' own pre-flight: refuse before sending if the market cannot take this order.
  const max = (await ex.client.getMaxPerpOrderSize({
    pool: m.poolAddress,
    marginBank: m.marginBank,
    account,
    isBid,
    price,
  })) as unknown as { priceable: boolean; placeable: boolean; maxQuantity: bigint | string; limitedBy?: string };
  if (!max.priceable) throw new Error(`${ticker}-PERP has a stale mark price right now, so dreamDEX will not price an order. Try a busier market.`);
  if (!max.placeable) {
    // Say exactly where the money is, instead of guessing: margin bank, wallet USDso, and the SDK's deposit-like methods.
    const safe = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
    let margin = 'unreadable';
    try {
      const a = (await ex.client.getMarginAccount(m.marginBank, account)) as unknown as Record<string, unknown>;
      margin = safe({ unlocked: a.unlockedCollateralBalance, locked: a.lockedCollateral, equity: a.equity });
    } catch (e) {
      margin = `unreadable (${e instanceof Error ? e.message.slice(0, 80) : String(e)})`;
    }
    let walletUsdso = 'unreadable';
    try {
      walletUsdso = await getUsdsoBalance(address);
    } catch {
      /* keep unreadable */
    }
    const proto = Object.getPrototypeOf(ex.trader) as object;
    const methods = [...new Set([...Object.getOwnPropertyNames(proto), ...Object.getOwnPropertyNames(ex.trader)])]
      .filter((n) => /deposit|margin|approve|fund|collateral/i.test(n))
      .join(', ');
    throw new Error(
      `${ticker}-PERP cannot take this order (limited by ${max.limitedBy ?? 'a limit'}). ` +
        `Account ${account}: margin bank ${margin}; game wallet USDso ${walletUsdso}; ` +
        `SDK trader methods about margin: ${methods || 'none found'}.`,
    );
  }
  if (quantity > BigInt(max.maxQuantity)) throw new Error(`The largest order this wallet can place on ${ticker}-PERP is smaller than the stake size.`);

  const userData = encodeUserData(matchNumber);
  const res = (await ex.trader.placePerpOrder({
    pool: m.poolAddress,
    isBid,
    price,
    quantity,
    orderType: ORDER_TYPE_MARKET,
    userData,
  })) as unknown as { hash?: string; orderId?: bigint; receipt?: { status?: string }; fills?: { quantityFilled: bigint }[] };

  if (res.receipt?.status && res.receipt.status !== 'success') throw new Error('The order transaction reverted on chain.');
  const filled = (res.fills ?? []).reduce((s, f) => s + f.quantityFilled, 0n);
  const toNum = (q: bigint) => Number(q) / 10 ** m.baseDecimals;
  return {
    txHash: res.hash ?? null,
    orderId: res.orderId !== undefined ? res.orderId.toString() : null,
    quantity: toNum(quantity),
    filledQuantity: toNum(filled),
    price: Number(price) / 1e18,
    notionalUsd: (Number(quantity) / 10 ** m.baseDecimals) * (Number(mark) / 1e18),
    raisedToMinimum,
  };
}

/** Closes the game wallet's open position on a market with a reducing market order. */
export async function closeMyPosition(key: Hex, address: Hex, ticker: string): Promise<string> {
  const ex = makeExchange(key);
  const rows = (await ex.client.listPerpMarkets()) as unknown as PerpRow[];
  const m = rows.find((r) => r.baseSymbol === ticker);
  if (!m) throw new Error(`${ticker} is not a dreamDEX perp market right now.`);
  const preview = (await ex.client.previewPerpClosePnl({
    pool: m.poolAddress,
    marginBank: m.marginBank,
    account: address,
  })) as unknown as { priceable: boolean; closedQuantity: bigint; isLong?: boolean; side?: string };
  if (!preview.priceable) throw new Error(`${ticker}-PERP is not priceable right now, so the close cannot be sized. Try again shortly.`);
  if (preview.closedQuantity <= 0n) return `No open ${ticker} position to close.`;

  // Which way the position points: the exchange helper lists positions with a symbol and a side.
  const positions = (await (ex as unknown as { fetchPositions: () => Promise<{ symbol: string; side: string }[]> }).fetchPositions()) ?? [];
  const mine = positions.find((p) => p.symbol.toUpperCase().startsWith(ticker.toUpperCase()));
  if (!mine) {
    throw new Error(`Could not find a ${ticker} position to read the side from. Positions seen: ${positions.map((p) => `${p.symbol} ${p.side}`).join(', ') || 'none'}. Nothing was sent.`);
  }
  const wasLong = mine.side === 'long';

  const isBid = !wasLong; // closing a long means selling
  const mark = BigInt(m.markPrice);
  const tick = BigInt(m.tickSize);
  const slipped = isBid ? (mark * (10_000n + SLIPPAGE_BPS)) / 10_000n : (mark * (10_000n - SLIPPAGE_BPS)) / 10_000n;
  const price = tick > 0n ? (slipped / tick) * tick : slipped;
  const res = (await ex.trader.placePerpOrder({
    pool: m.poolAddress,
    isBid,
    price,
    quantity: preview.closedQuantity,
    orderType: ORDER_TYPE_MARKET,
  })) as unknown as { hash?: string; receipt?: { status?: string } };
  if (res.receipt?.status && res.receipt.status !== 'success') throw new Error('The close transaction reverted on chain.');
  return `Position closed.${res.hash ? ` Tx ${res.hash}` : ''}`;
}

/** Moves everything unlocked in the margin bank back to the game wallet's own USDso balance. */
export async function withdrawAllFromMargin(key: Hex, address: Hex): Promise<string> {
  const ex = makeExchange(key);
  const rows = (await ex.client.listPerpMarkets()) as unknown as PerpRow[];
  const bank = (rows.find((r) => r.baseSymbol === 'BTC') ?? rows[0])?.marginBank;
  if (!bank) throw new Error('No perp market was returned, so there is no margin bank to withdraw from.');
  const acct = (await ex.client.getMarginAccount(bank, address)) as unknown as { unlockedCollateralBalance?: bigint | string; lockedCollateral?: bigint | string };
  const unlocked = BigInt(acct.unlockedCollateralBalance ?? 0);
  if (unlocked === 0n) {
    return `Nothing to withdraw: unlocked margin is 0${acct.lockedCollateral && BigInt(acct.lockedCollateral) > 0n ? ' (the rest is locked by an open position: close it first)' : ''}.`;
  }
  const withdraw = (ex.trader as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>).withdrawMargin;
  const call = withdraw.bind(ex.trader);
  try {
    await call({ marginBank: bank, amount: unlocked });
  } catch (first) {
    const msg = first instanceof Error ? first.message : String(first);
    if (/reverted|insufficient/i.test(msg) || !/marginBank|amount|argument|invalid|undefined|required|bigint|type/i.test(msg)) throw first;
    await call(bank, unlocked);
  }
  return `Withdrew ${formatUnits(unlocked, 18)} USDso from margin to the wallet.`;
}

/** True only while this wallet really holds an open position on the market. */
export async function hasOpenPosition(key: Hex, address: Hex, ticker: string): Promise<boolean> {
  const ex = makeExchange(key);
  const rows = (await ex.client.listPerpMarkets()) as unknown as PerpRow[];
  const m = rows.find((r) => r.baseSymbol === ticker);
  if (!m) return false;
  const preview = (await ex.client.previewPerpClosePnl({ pool: m.poolAddress, marginBank: m.marginBank, account: address })) as unknown as { closedQuantity: bigint };
  return preview.closedQuantity > 0n;
}

/** Which way this wallet's position on a market points right now. */
export async function myDirection(key: Hex, address: Hex, ticker: string): Promise<'long' | 'short' | 'flat'> {
  if (!(await hasOpenPosition(key, address, ticker))) return 'flat';
  const ex = makeExchange(key);
  const positions = (await (ex as unknown as { fetchPositions: () => Promise<{ symbol: string; side: string }[]> }).fetchPositions()) ?? [];
  const mine = positions.find((p) => p.symbol.toUpperCase().startsWith(ticker.toUpperCase()));
  if (!mine) throw new Error(`Could not read the side of your ${ticker} position.`);
  return mine.side === 'long' ? 'long' : 'short';
}
