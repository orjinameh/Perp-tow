import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { createPublicClient, encodeFunctionData, createWalletClient, formatEther, formatUnits, http, parseAbi, zeroAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { gql } from './indexer';
import { logActivity, updateActivity } from './activity';
import { nowSec } from './clock';
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
  initialMarginBps?: number | string;
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

/** True when the key signs for a different account: the game wallet acting as a bot for a main wallet. */
export const isBotFor = (key: Hex, account: Hex) => privateKeyToAccount(key).address.toLowerCase() !== account.toLowerCase();

const PERP_FOR_ABI = parseAbi([
  'function placeOrderFor(address owner, bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k)',
]);
// 0 = no expiry on a market order. scripts/bot-check.mts simulates the call to confirm this on the live pool.
// The pool rejects expiry 0 for delegated orders (bot-check: reverted 0x3154078e) and accepts a future time. Use chain time + 1 hour, in nanoseconds.
const botExpireNs = () => BigInt(Math.floor(nowSec()) + 3600) * 1_000_000_000n;

/** The bot places an order on a perp pool for the account that granted it (it uses the account's margin). */
async function botPlaceOrder(key: Hex, pool: Hex, owner: Hex, o: { isBid: boolean; userData: bigint; price: bigint; quantity: bigint }) {
  const wallet = createWalletClient({ chain: hidekiTestnet, transport: http(RPC_URL), account: privateKeyToAccount(key) });
  const pub = createPublicClient({ chain: hidekiTestnet, transport: http(RPC_URL) });
  let hash: Hex;
  try {
    hash = await wallet.writeContract({
      address: pool,
      abi: PERP_FOR_ABI,
      functionName: 'placeOrderFor',
      args: [owner, o.isBid, o.userData, o.price, o.quantity, botExpireNs(), ORDER_TYPE_MARKET, 0, zeroAddress, 0n],
    });
  } catch (e) {
    const text = e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : String(e);
    throw new Error(`The bot could not place the order for your main wallet: ${text.replace(/\s+/g, ' ').slice(0, 240)}. Check that the bot was added for this market (grant step or the dreamDEX "Add bot" screen).`);
  }
  const receipt = await pub.waitForTransactionReceipt({ hash });
  return { hash, receipt: { status: receipt.status } };
}

/** The direction of an account's position from the indexer, for when the bot signs but the account holds the position. */
async function accountDirection(pool: string, account: string): Promise<'long' | 'short' | 'flat'> {
  const d = await gql<{ PerpPosition: { isLong: boolean; size: string }[] }>(
    `{ PerpPosition(limit: 1, where: {pool: {_ilike: "${pool}"}, account: {_ilike: "${account}"}}) { isLong size } }`,
  );
  const p = d.PerpPosition[0];
  if (!p || BigInt(p.size) === 0n) return 'flat';
  return p.isLong ? 'long' : 'short';
}

function baseConfig() {
  return {
    chain: hidekiTestnet,
    // Through our own server route so the browser never hits a CORS wall.
    indexerUrl: typeof window === 'undefined' ? process.env.INDEXER_URL ?? 'https://hideki-dev.smk.somnia.host/v1/graphql' : `${window.location.origin}/api/indexer`,
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
export async function depositAllToMargin(key: Hex, address: Hex, amountUsd?: number): Promise<string> {
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
  if (amountUsd !== undefined) {
    const want = BigInt(Math.round(amountUsd * 1e6)) * 10n ** 12n;
    if (want <= 0n) throw new Error('Enter an amount above 0.');
    if (want > raw) throw new Error(`Only ${formatUnits(raw, 18)} USDso is available to deposit.`);
    raw = want;
  }
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
  logActivity({ signer: privateKeyToAccount(key).address, kind: 'deposit', title: `Deposited ${formatUnits(raw, 18)} USDso into your dreamDEX margin`, status: 'confirmed' });
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
  logActivity({ signer: privateKeyToAccount(key).address, kind: 'faucet', title: 'Claimed the paper USDso credit', status: 'confirmed' });
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

  const bps = Number(m.initialMarginBps);
  if (bps > 0 && lev > Math.floor(10_000 / bps)) throw new Error(`${ticker}-PERP allows at most ${Math.floor(10_000 / bps)}x leverage, and you chose ${lev}x.`);

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
  // Only the owner can change an account's leverage, so a bot trades with the leverage already set on the account.
  if (!levDone && !isBotFor(key, account)) {
    try {
      await (ex.trader as unknown as { setPerpLeverage: (p: { pool: Hex; leverageX: number }) => Promise<unknown> }).setPerpLeverage({ pool: m.poolAddress, leverageX: lev });
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      // NoStateChange means the wallet is already at this leverage, which is fine.
      if (!/NoStateChange/.test(text)) throw new Error(`Could not set ${lev}x leverage on ${ticker}-PERP: ${text.split('\n')[0]}`);
    }
    try {
      localStorage.setItem(levKey, String(lev));
    } catch {
      /* ignore */
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
  const res = (await (isBotFor(key, account)
    ? botPlaceOrder(key, m.poolAddress, account, { isBid, userData: BigInt(userData), price, quantity })
    : ex.trader.placePerpOrder({
        pool: m.poolAddress,
        isBid,
        price,
        quantity,
        orderType: ORDER_TYPE_MARKET,
        userData,
      } as never))) as unknown as { hash?: string; orderId?: bigint; receipt?: { status?: string }; fills?: { quantityFilled: bigint }[] };

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
  let wasLong: boolean;
  if (isBotFor(key, address)) {
    const dir = await accountDirection(m.poolAddress, address);
    if (dir === 'flat') return `No open ${ticker} position to close.`;
    wasLong = dir === 'long';
  } else {
    const positions = (await (ex as unknown as { fetchPositions: () => Promise<{ symbol: string; side: string }[]> }).fetchPositions()) ?? [];
    const mine = positions.find((p) => p.symbol.toUpperCase().startsWith(ticker.toUpperCase()));
    if (!mine) {
      throw new Error(`Could not find a ${ticker} position to read the side from. Positions seen: ${positions.map((p) => `${p.symbol} ${p.side}`).join(', ') || 'none'}. Nothing was sent.`);
    }
    wasLong = mine.side === 'long';
  }

  const isBid = !wasLong; // closing a long means selling
  const mark = BigInt(m.markPrice);
  const tick = BigInt(m.tickSize);
  const slipped = isBid ? (mark * (10_000n + SLIPPAGE_BPS)) / 10_000n : (mark * (10_000n - SLIPPAGE_BPS)) / 10_000n;
  const price = tick > 0n ? (slipped / tick) * tick : slipped;
  const res = (await (isBotFor(key, address)
    ? botPlaceOrder(key, m.poolAddress, address, { isBid, userData: 0n, price, quantity: preview.closedQuantity })
    : ex.trader.placePerpOrder({
        pool: m.poolAddress,
        isBid,
        price,
        quantity: preview.closedQuantity,
        orderType: ORDER_TYPE_MARKET,
      }))) as unknown as { hash?: string; receipt?: { status?: string } };
  if (res.receipt?.status && res.receipt.status !== 'success') throw new Error('The close transaction reverted on chain.');
  logActivity({ signer: privateKeyToAccount(key).address, kind: 'close', title: `Closed your ${ticker} margin position`, hash: res.hash, status: 'confirmed' });
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
  logActivity({ signer: privateKeyToAccount(key).address, kind: 'withdraw', title: `Withdrew ${formatUnits(unlocked, 18)} USDso from your margin to the wallet`, status: 'confirmed' });
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
  if (isBotFor(key, address)) {
    const rows = (await makeExchange(key).client.listPerpMarkets()) as unknown as PerpRow[];
    const m = rows.find((r) => r.baseSymbol === ticker);
    return m ? accountDirection(m.poolAddress, address) : 'flat';
  }
  const ex = makeExchange(key);
  const positions = (await (ex as unknown as { fetchPositions: () => Promise<{ symbol: string; side: string }[]> }).fetchPositions()) ?? [];
  const mine = positions.find((p) => p.symbol.toUpperCase().startsWith(ticker.toUpperCase()));
  if (!mine) throw new Error(`Could not read the side of your ${ticker} position.`);
  return mine.side === 'long' ? 'long' : 'short';
}


// ---------------------------------------------------------------- vault trading (squads)

const VAULT_ABI = parseAbi([
  'function trade(address pool, bool isBid, uint64 userData, uint256 price, uint256 quantity)',
  'function close(address pool, uint256 price)',
]);
const BANK_COLLATERAL_ABI = parseAbi(['function getWithdrawableCollateral(address account) view returns (uint256)']);
const BANK_POSITION_ABI = parseAbi(['function getPosition(address account, address perpPool) view returns ((int128 size, uint128 avgEntryPrice, int256 entryFundingIndex, uint64 lastUpdatedTimestampNs))']);

async function perpRow(key: Hex, ticker: string): Promise<PerpRow> {
  const rows = (await makeExchange(key).client.listPerpMarkets()) as unknown as PerpRow[];
  const m = rows.find((r) => r.baseSymbol === ticker);
  if (!m) throw new Error(`${ticker} is not a dreamDEX perp market right now.`);
  return m;
}

function vaultError(e: unknown): Error {
  const text = (e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : String(e)).replace(/\s+/g, ' ');
  if (/match is not live/i.test(text)) return new Error('This match is not live right now, so the vault cannot trade.');
  if (/not allowed/i.test(text)) return new Error('This game wallet is not allowed to trade for that vault. Add it as a bot for your main wallet in the dreamDEX app.');
  if (/no position/i.test(text)) return new Error('This vault has no open position to close.');
  return new Error(text.slice(0, 300));
}

/** What a vault can do right now: free margin, open position, and the margin an order of this size needs. */
async function vaultSnapshot(vault: Hex, m: PerpRow, orderUsd: number) {
  const pub = createPublicClient({ chain: hidekiTestnet, transport: http(RPC_URL) });
  const [free, pos] = await Promise.all([
    pub.readContract({ address: m.marginBank, abi: BANK_COLLATERAL_ABI, functionName: 'getWithdrawableCollateral', args: [vault] }) as Promise<bigint>,
    pub.readContract({ address: m.marginBank, abi: BANK_POSITION_ABI, functionName: 'getPosition', args: [vault, m.poolAddress] }) as Promise<{ size: bigint }>,
  ]);
  const bps = Number(m.initialMarginBps);
  const need = Number.isFinite(bps) && bps > 0 ? (orderUsd * bps) / 10_000 : null;
  return { freeUsd: Number(free) / 1e18, size: pos.size, needUsd: need };
}

/** A real market order from the player's own vault. `positionUsd` is the size of the position in dollars. */
export async function vaultOrder(key: Hex, vault: Hex, ticker: string, side: 'buy' | 'sell', positionUsd: number, matchNumber: number): Promise<string> {
  const m = await perpRow(key, ticker);
  const isBid = side === 'buy';
  const dec = BigInt(m.baseDecimals);
  const tick = BigInt(m.tickSize);
  const lot = BigInt(m.lotSize);
  const min = BigInt(m.minQuantity);
  const mark = BigInt(m.markPrice);
  const slipped = isBid ? (mark * (10_000n + SLIPPAGE_BPS)) / 10_000n : (mark * (10_000n - SLIPPAGE_BPS)) / 10_000n;
  const price = tick > 0n ? (slipped / tick) * tick : slipped;
  const usd18 = BigInt(Math.round(positionUsd * 1e6)) * 10n ** 12n;
  let quantity = (usd18 * 10n ** dec) / mark;
  quantity = lot > 0n ? (quantity / lot) * lot : quantity;
  if (quantity < min) quantity = lot > 0n ? ((min + lot - 1n) / lot) * lot : min;
  const wallet = createWalletClient({ chain: hidekiTestnet, transport: http(RPC_URL), account: privateKeyToAccount(key) });
  const pub = createPublicClient({ chain: hidekiTestnet, transport: http(RPC_URL) });
  const args = [m.poolAddress, isBid, BigInt(encodeUserData(matchNumber)), price, quantity] as const;
  const snap = await vaultSnapshot(vault, m, positionUsd).catch(() => null);
  const adds = !!snap && (snap.size === 0n || (snap.size > 0n) === isBid); // a trade the other way only reduces risk
  if (snap && adds && snap.needUsd !== null && snap.freeUsd < snap.needUsd) {
    const msg = `Your vault has about $${snap.freeUsd.toFixed(2)} of free margin and this $${positionUsd} order needs about $${snap.needUsd.toFixed(2)}. Try a smaller position, or close a trade to free margin.`;
    logActivity({ signer: wallet.account.address, kind: 'trade', title: `${isBid ? 'Buy' : 'Sell'} $${positionUsd} ${ticker} from your vault`, detail: msg, status: 'not sent', match: { ticker, number: matchNumber } });
    throw new Error(msg);
  }
  try {
    await pub.simulateContract({ address: vault, abi: VAULT_ABI, functionName: 'trade', args, account: wallet.account });
    const hash = await wallet.writeContract({ address: vault, abi: VAULT_ABI, functionName: 'trade', args });
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== 'success') {
      logActivity({ signer: wallet.account.address, kind: 'trade', title: `${isBid ? 'Buy' : 'Sell'} $${positionUsd} ${ticker} from your vault`, detail: 'The order reverted on the chain.', hash, status: 'failed', match: { ticker, number: matchNumber } });
      throw new Error('The order reverted on chain.');
    }
    logActivity({ signer: wallet.account.address, kind: 'trade', title: `${isBid ? 'Bought' : 'Sold'} about $${positionUsd} of ${ticker} from your vault`, hash, status: 'confirmed', match: { ticker, number: matchNumber }, trade: { side, qty: quantity.toString(), usd: positionUsd } });
    return hash;
  } catch (e) {
    const err = vaultError(e);
    if (snap && /0x[0-9a-f]{8}/i.test(err.message)) err.message += ` (Your vault had about $${snap.freeUsd.toFixed(2)} free margin and an open position of ${snap.size} units; this order needs about $${snap.needUsd?.toFixed(2) ?? '?'} of margin.)`;
    if (!/reverted on chain/.test(err.message)) logActivity({ signer: wallet.account.address, kind: 'trade', title: `${isBid ? 'Buy' : 'Sell'} $${positionUsd} ${ticker} from your vault`, detail: err.message, status: 'not sent', match: { ticker, number: matchNumber } });
    throw err;
  }
}

/** Closes the vault's whole position on the market with a market order the other way. */
export async function vaultClose(key: Hex, vault: Hex, ticker: string): Promise<string> {
  const m = await perpRow(key, ticker);
  const pub = createPublicClient({ chain: hidekiTestnet, transport: http(RPC_URL) });
  const pos = (await pub.readContract({ address: m.marginBank, abi: BANK_POSITION_ABI, functionName: 'getPosition', args: [vault, m.poolAddress] })) as { size: bigint };
  if (pos.size === 0n) throw new Error('This vault has no open position to close.');
  const isBid = pos.size < 0n; // closing a short means buying
  const mark = BigInt(m.markPrice);
  const tick = BigInt(m.tickSize);
  const slipped = isBid ? (mark * (10_000n + SLIPPAGE_BPS)) / 10_000n : (mark * (10_000n - SLIPPAGE_BPS)) / 10_000n;
  const price = tick > 0n ? (slipped / tick) * tick : slipped;
  const wallet = createWalletClient({ chain: hidekiTestnet, transport: http(RPC_URL), account: privateKeyToAccount(key) });
  try {
    await pub.simulateContract({ address: vault, abi: VAULT_ABI, functionName: 'close', args: [m.poolAddress, price], account: wallet.account });
    const hash = await wallet.writeContract({ address: vault, abi: VAULT_ABI, functionName: 'close', args: [m.poolAddress, price] });
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== 'success') {
      logActivity({ signer: wallet.account.address, kind: 'close', title: `Close your ${ticker} position`, detail: 'The close reverted on the chain.', hash, status: 'failed' });
      throw new Error('The close reverted on chain.');
    }
    logActivity({ signer: wallet.account.address, kind: 'close', title: `Closed your ${ticker} vault position`, hash, status: 'confirmed' });
    return hash;
  } catch (e) {
    const err = vaultError(e);
    if (!/reverted on chain/.test(err.message)) logActivity({ signer: wallet.account.address, kind: 'close', title: `Close your ${ticker} position`, detail: err.message, status: 'not sent' });
    throw err;
  }
}

/** The vault's open position on a market, read from the margin bank. size > 0 long, < 0 short. */
export async function vaultPosition(vault: Hex, ticker: string): Promise<{ size: number; entry: number } | null> {
  const rows = (await new SomniaMarkets({ ...baseConfig(), privateKey: generatePrivateKey() }).client.listPerpMarkets()) as unknown as PerpRow[];
  const m = rows.find((r) => r.baseSymbol === ticker);
  if (!m) return null;
  const pub = createPublicClient({ chain: hidekiTestnet, transport: http(RPC_URL) });
  const p = (await pub.readContract({ address: m.marginBank, abi: BANK_POSITION_ABI, functionName: 'getPosition', args: [vault, m.poolAddress] })) as { size: bigint; avgEntryPrice: bigint };
  if (p.size === 0n) return null;
  return { size: Number(p.size) / 10 ** m.baseDecimals, entry: Number(p.avgEntryPrice) / 1e18 };
}

/** What is left in a vault's margin account that can be paid out right now (USDso). */
export async function vaultWithdrawable(vault: Hex, ticker: string): Promise<number> {
  const rows = (await new SomniaMarkets({ ...baseConfig(), privateKey: generatePrivateKey() }).client.listPerpMarkets()) as unknown as PerpRow[];
  const m = rows.find((r) => r.baseSymbol === ticker);
  if (!m) return 0;
  const pub = createPublicClient({ chain: hidekiTestnet, transport: http(RPC_URL) });
  const w = (await pub.readContract({ address: m.marginBank, abi: BANK_COLLATERAL_ABI, functionName: 'getWithdrawableCollateral', args: [vault] })) as bigint;
  return Number(w) / 1e18;
}

/** Closes ONE earlier trade: an order the other way for just that trade's quantity, never more than the open position. */
export async function vaultCloseTrade(key: Hex, vault: Hex, ticker: string, matchNumber: number, tradeId: string, side: 'buy' | 'sell', qtyText: string): Promise<string> {
  const m = await perpRow(key, ticker);
  const pub = createPublicClient({ chain: hidekiTestnet, transport: http(RPC_URL) });
  const wallet = createWalletClient({ chain: hidekiTestnet, transport: http(RPC_URL), account: privateKeyToAccount(key) });
  const pos = (await pub.readContract({ address: m.marginBank, abi: BANK_POSITION_ABI, functionName: 'getPosition', args: [vault, m.poolAddress] })) as { size: bigint };
  const longNow = pos.size > 0n;
  if (pos.size === 0n || (side === 'buy') !== longNow) {
    updateActivity(tradeId, { trade: undefined });
    throw new Error('That trade is no longer open (your position already changed). Nothing was sent.');
  }
  const open = pos.size < 0n ? -pos.size : pos.size;
  let qty = BigInt(qtyText);
  if (qty > open) qty = open;
  const isBid = side === 'sell'; // closing a sale means buying back
  const mark = BigInt(m.markPrice);
  const tick = BigInt(m.tickSize);
  const slipped = isBid ? (mark * (10_000n + SLIPPAGE_BPS)) / 10_000n : (mark * (10_000n - SLIPPAGE_BPS)) / 10_000n;
  const price = tick > 0n ? (slipped / tick) * tick : slipped;
  const args = [m.poolAddress, isBid, BigInt(encodeUserData(matchNumber)), price, qty] as const;
  try {
    await pub.simulateContract({ address: vault, abi: VAULT_ABI, functionName: 'trade', args, account: wallet.account });
    const hash = await wallet.writeContract({ address: vault, abi: VAULT_ABI, functionName: 'trade', args });
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== 'success') throw new Error('The close reverted on the chain.');
    updateActivity(tradeId, { trade: undefined });
    logActivity({ signer: wallet.account.address, kind: 'close', title: `Closed one ${ticker} trade`, hash, status: 'confirmed', match: { ticker, number: matchNumber } });
    return hash;
  } catch (e) {
    const err = vaultError(e);
    logActivity({ signer: wallet.account.address, kind: 'close', title: `Close one ${ticker} trade`, detail: err.message, status: 'failed', match: { ticker, number: matchNumber } });
    throw err;
  }
}

/** When a release fails, asks the margin bank directly (as the vault) what it would say, so the real reason is visible. */
export async function vaultReleaseDiagnosis(vault: Hex, ticker: string): Promise<string> {
  try {
    const rows = (await new SomniaMarkets({ ...baseConfig(), privateKey: generatePrivateKey() }).client.listPerpMarkets()) as unknown as PerpRow[];
    const m = rows.find((r) => r.baseSymbol === ticker);
    if (!m) return '';
    const pub = createPublicClient({ chain: hidekiTestnet, transport: http(RPC_URL) });
    const w = (await pub.readContract({ address: m.marginBank, abi: BANK_COLLATERAL_ABI, functionName: 'getWithdrawableCollateral', args: [vault] })) as bigint;
    const pos = (await pub.readContract({ address: m.marginBank, abi: BANK_POSITION_ABI, functionName: 'getPosition', args: [vault, m.poolAddress] })) as { size: bigint };
    const ex = new SomniaMarkets({ ...baseConfig(), privateKey: generatePrivateKey() });
    let acct = '';
    try {
      const a = (await ex.client.getMarginAccount(m.marginBank, vault)) as unknown as { unlockedCollateralBalance?: bigint; lockedCollateral?: bigint };
      acct = ` unlocked ${Number(a.unlockedCollateralBalance ?? 0n) / 1e18}, locked ${Number(a.lockedCollateral ?? 0n) / 1e18}.`;
    } catch { /* optional */ }
    let bankSays = 'accepts a withdrawal';
    if (w > 0n) {
      try {
        await pub.call({ account: vault, to: m.marginBank, data: encodeFunctionData({ abi: parseAbi(['function withdraw(uint256 amount)']), functionName: 'withdraw', args: [w] }) });
      } catch (e) {
        const raw = JSON.stringify((e as { cause?: unknown })?.cause ?? '') + String((e as Error).message);
        const sel = raw.match(/0x[0-9a-fA-F]{8}/)?.[0];
        bankSays = `refuses a withdrawal of ${Number(w) / 1e18}${sel ? ` (error ${sel})` : ''}`;
      }
    }
    return ` Vault check: withdrawable ${Number(w) / 1e18}, open position size ${pos.size}.${acct} The margin bank ${bankSays}.`;
  } catch {
    return '';
  }
}
