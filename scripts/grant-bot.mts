// One-time setup from your MAIN wallet: lets the game wallet in your browser act as its bot.
//   OWNER_KEY=0x<main wallet key> npm run grant -- <game wallet address> BTC ETH
// What it does (all from the main wallet, on the testnet):
//   1. tells the seat registry and the escrow that the game wallet may act for you
//   2. approves the escrow to pull stakes from your main wallet, up to GRANT_BUDGET_USD (default 100)
//   3. grants the game wallet the right to place and cancel perp orders for you on each listed market
// The game wallet can then take seats, stake, trade and claim for you. Stakes are pulled from your main wallet
// and refunds and payouts always go back to it. Run it again to top up the budget. The key is only read from
// the environment for this one command; it is never saved.
import { createPublicClient, createWalletClient, http, isAddress, parseAbi, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CANCEL_ORDER_FOR_SELECTOR, PLACE_ORDER_FOR_SELECTOR, SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';

const [botAddr, ...tickerArgs] = process.argv.slice(2);
const ownerKey = process.env.OWNER_KEY as `0x${string}` | undefined;
const registry = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS as `0x${string}` | undefined;
const escrow = process.env.NEXT_PUBLIC_ESCROW_ADDRESS as `0x${string}` | undefined;
if (!botAddr || !isAddress(botAddr)) throw new Error('Usage: OWNER_KEY=0x.. npm run grant -- <game wallet address> BTC ETH');
if (!ownerKey || !/^0x[0-9a-fA-F]{64}$/.test(ownerKey)) throw new Error('Set OWNER_KEY to your MAIN wallet private key (0x + 64 hex characters), only for this command.');
if (!registry || !escrow) throw new Error('NEXT_PUBLIC_REGISTRY_ADDRESS and NEXT_PUBLIC_ESCROW_ADDRESS must be set in .env.local.');
const tickers = tickerArgs.length ? tickerArgs : ['BTC'];
const budget = parseUnits(process.env.GRANT_BUDGET_USD ?? '100', 18);

const RPC = 'https://api.hideki2.infra.testnet.somnia.network';
const USDSO = '0xed7993A74dAe1e6656B704A424DcD8711aAf4F72' as const;
const account = privateKeyToAccount(ownerKey);
const pub = createPublicClient({ chain: hidekiTestnet, transport: http(RPC) });
const wallet = createWalletClient({ chain: hidekiTestnet, transport: http(RPC), account });
const log = (s: string) => console.log(s);
const bot = botAddr as `0x${string}`;

const setBotAbi = parseAbi(['function setBot(address bot, bool allowed)']);
const erc20 = parseAbi(['function approve(address,uint256) returns (bool)']);
async function tx(label: string, p: Promise<`0x${string}`>) {
  const hash = await p;
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error(`${label} reverted (${hash}).`);
  log(`done: ${label}`);
}

log(`Main wallet ${account.address} lets bot ${bot} act for it.`);
await tx('registry: bot approved', wallet.writeContract({ address: registry, abi: setBotAbi, functionName: 'setBot', args: [bot, true] }));
await tx('escrow: bot approved', wallet.writeContract({ address: escrow, abi: setBotAbi, functionName: 'setBot', args: [bot, true] }));
await tx(`USDso: escrow may pull up to ${process.env.GRANT_BUDGET_USD ?? '100'} USDso`, wallet.writeContract({ address: USDSO, abi: erc20, functionName: 'approve', args: [escrow, budget] }));

const sdk = new SomniaMarkets({ chain: hidekiTestnet, indexerUrl: process.env.INDEXER_URL ?? 'https://hideki-dev.smk.somnia.host/v1/graphql', addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, privateKey: ownerKey });
const rows = (await sdk.client.listPerpMarkets()) as unknown as { baseSymbol: string; poolAddress: `0x${string}` }[];
for (const t of tickers) {
  const m = rows.find((r) => r.baseSymbol === t);
  if (!m) {
    log(`skipped ${t}: not a perp market.`);
    continue;
  }
  try {
    await sdk.trader.setOperatorApprovalForPool({ pool: m.poolAddress, operator: bot, selectors: [PLACE_ORDER_FOR_SELECTOR, CANCEL_ORDER_FOR_SELECTOR], approved: true });
    log(`done: ${t}-PERP: bot may place and cancel orders`);
  } catch (e) {
    log(`FAILED ${t}-PERP grant: ${(e instanceof Error ? e.message : String(e)).split('\n')[0]}\n  You can add the game wallet as a bot for this market in the dreamDEX app instead ("Add bot", Perps ticked).`);
  }
}
log('\nNext: npm run bot-check -- <your main wallet address> <game wallet address> BTC');
