import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { createPublicClient, formatEther, formatUnits, http, parseAbi } from 'viem';
import { PositionSide } from './types';
import { encodeUserData } from './gameTag';

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

/** Read-only view of someone's account (used when the game wallet trades for a linked account). */
function makeReadOnly(account: Hex) {
  return new SomniaMarkets({ ...baseConfig(), account });
}

/** Whether the game wallet has been linked as a bot on this dreamDEX account (checked on the BTC pool). */
export async function checkLink(key: Hex, owner: Hex): Promise<string> {
  const { createTradingKey, canPlaceFor, LINK_HELP } = await import('./operator');
  const tk = createTradingKey(owner, key);
  const rows = (await makeReadOnly(owner).client.listPerpMarkets()) as unknown as PerpRow[];
  const pool = (rows.find((r) => r.baseSymbol === 'BTC') ?? rows[0])?.poolAddress;
  if (!pool) throw new Error('No perp market was returned.');
  return (await canPlaceFor(tk, pool))
    ? `Linked: the game wallet can place orders for ${owner}.`
    : LINK_HELP(tk.operator, owner);
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
  owner: Hex | null; // set: trade for this linked dreamDEX account; null: trade the game wallet's own account
  ticker: string;
  side: PositionSide;
  matchNumber: number;
  stakeUsd: number;
}): Promise<EntryReceipt> {
  const { key, address, owner, ticker, side, matchNumber, stakeUsd } = args;
  const account = owner ?? address;
  const ex = owner ? makeReadOnly(owner) : makeExchange(key);
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
  const stake18 = BigInt(Math.round(stakeUsd * 1e6)) * 10n ** 12n;
  let quantity = (stake18 * 10n ** dec) / mark;
  quantity = lot > 0n ? (quantity / lot) * lot : quantity;
  let raisedToMinimum = false;
  if (quantity < min) {
    quantity = lot > 0n ? ((min + lot - 1n) / lot) * lot : min;
    raisedToMinimum = true;
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
  if (!max.placeable) throw new Error(`${ticker}-PERP cannot take this order (${max.limitedBy ?? 'limit reached'}). Check the wallet has margin: claim the paper credit first.`);
  if (quantity > BigInt(max.maxQuantity)) throw new Error(`The largest order this wallet can place on ${ticker}-PERP is smaller than the stake size.`);

  const userData = encodeUserData(matchNumber);
  let res: { hash?: string; orderId?: bigint; receipt?: { status?: string }; fills?: { quantityFilled: bigint }[] };
  if (owner) {
    const { createTradingKey, canPlaceFor, placeFor, LINK_HELP } = await import('./operator');
    const tk = createTradingKey(owner, key);
    if (!(await canPlaceFor(tk, m.poolAddress))) throw new Error(LINK_HELP(tk.operator, owner));
    res = await placeFor(tk, { pool: m.poolAddress, isBid, price, quantity, orderType: ORDER_TYPE_MARKET, userData });
  } else {
    res = (await ex.trader.placePerpOrder({
      pool: m.poolAddress,
      isBid,
      price,
      quantity,
      orderType: ORDER_TYPE_MARKET,
      userData,
    })) as unknown as typeof res;
  }

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
