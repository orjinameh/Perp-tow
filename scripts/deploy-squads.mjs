// Deploys TugSquads (seats, stakes, teams and payouts in one contract) to the Hideki testnet and saves its address.
//   DEPLOYER_KEY=0x... npm run deploy:squads
// Settings come from .env.local: NEXT_PUBLIC_MATCH_SIZE, NEXT_PUBLIC_MIN_PLAYERS, NEXT_PUBLIC_LOBBY_SECONDS,
// NEXT_PUBLIC_CONFIRM_SECONDS, NEXT_PUBLIC_MATCH_SECONDS (the match length from the lock).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createPublicClient, createWalletClient, http, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { setEnv } from './envfile.mjs';

const require = createRequire(import.meta.url);
const solc = require('solc');
const key = process.env.DEPLOYER_KEY;
if (!key) throw new Error('Set DEPLOYER_KEY to a testnet wallet private key that holds some STT for gas.');

const src = readFileSync(new URL('../contracts/TugSquads.sol', import.meta.url), 'utf8');
const out = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity',
  sources: { 'TugSquads.sol': { content: src } },
  settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
})));
const errs = (out.errors ?? []).filter((e) => e.severity === 'error');
if (errs.length) throw new Error(errs.map((e) => e.formattedMessage).join('\n'));
const c = out.contracts['TugSquads.sol'].TugSquads;

const num = (name, dflt) => (Number(process.env[name]) > 0 ? Number(process.env[name]) : dflt);
const size = num('NEXT_PUBLIC_MATCH_SIZE', 20); // the MOST seats a match may have: each host picks 2..size when opening a room
const minPlayers = num('NEXT_PUBLIC_MIN_PLAYERS', 2);
const lobby = num('NEXT_PUBLIC_LOBBY_SECONDS', 300);
const confirmSecs = num('NEXT_PUBLIC_CONFIRM_SECONDS', 60);
const duration = num('NEXT_PUBLIC_MATCH_SECONDS', 300);
const USDSO = '0xed7993A74dAe1e6656B704A424DcD8711aAf4F72';
const BANK = process.env.DREAMDEX_MARGIN_BANK ?? '0x478769E1177C0773c43A593DCCc4Ad15F15F1394';
// Most one player's equity change can count for, in USDso: stake x 10 by default (set SCORE_CAP to change).
const SCORE_CAP = process.env.SCORE_CAP ?? '100';
const PERMS = process.env.DREAMDEX_PERMISSIONS_REGISTRY ?? '0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a';
const RPC = 'https://api.hideki2.infra.testnet.somnia.network';

const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, chain: hidekiTestnet, transport: http(RPC) });
const pub = createPublicClient({ chain: hidekiTestnet, transport: http(RPC) });

const hash = await wallet.deployContract({
  abi: c.abi,
  bytecode: `0x${c.evm.bytecode.object}`,
  args: [{ token: USDSO, stake: parseUnits('10', 18), size, minPlayers, lobbySeconds: BigInt(lobby), confirmSeconds: BigInt(confirmSecs), duration: BigInt(duration), graceAfter: 3600n, rakeBps: 2000, perms: PERMS, bank: BANK, scoreCap: parseUnits(SCORE_CAP, 18) }],
});
const rc = await pub.waitForTransactionReceipt({ hash });
console.log(`Squads deployed: ${size} seats (min ${minPlayers}), lobby ${lobby}s, confirm ${confirmSecs}s, match ${duration}s from the lock, stake 10 USDso, rake 20%.`);
console.log(`Tx: https://explorer.testnet.somnia.network/tokyo/tx/${hash}`);
console.log(`Operator (the only wallet that can post results): ${account.address}`);
setEnv('NEXT_PUBLIC_SQUADS_ADDRESS', rc.contractAddress);
console.log('Restart the dev server so the app picks it up.');
