// Deploys TugRegistry (the seat registry; it holds no money) to the Hideki testnet.
//   NEXT_PUBLIC_MATCH_SIZE=3 DEPLOYER_KEY=0x... npm run deploy:registry
// Prints the address to put in .env.local.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { setEnv } from './envfile.mjs';

const require = createRequire(import.meta.url);
const solc = require('solc');
const key = process.env.DEPLOYER_KEY;
if (!key) throw new Error('Set DEPLOYER_KEY to a testnet wallet private key that holds some STT for gas.');

const src = readFileSync(new URL('../contracts/TugRegistry.sol', import.meta.url), 'utf8');
const out = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity',
  sources: { 'TugRegistry.sol': { content: src } },
  settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
})));
const errs = (out.errors ?? []).filter((e) => e.severity === 'error');
if (errs.length) throw new Error(errs.map((e) => e.formattedMessage).join('\n'));
const c = out.contracts['TugRegistry.sol'].TugRegistry;

const size = Number(process.env.NEXT_PUBLIC_MATCH_SIZE) > 1 ? Number(process.env.NEXT_PUBLIC_MATCH_SIZE) : 20;
const lobby = Number(process.env.NEXT_PUBLIC_LOBBY_SECONDS) > 0 ? Number(process.env.NEXT_PUBLIC_LOBBY_SECONDS) : 300;
const confirmSecs = Number(process.env.NEXT_PUBLIC_CONFIRM_SECONDS) > 0 ? Number(process.env.NEXT_PUBLIC_CONFIRM_SECONDS) : 60;
const RPC = 'https://api.hideki2.infra.testnet.somnia.network';
const wallet = createWalletClient({ account: privateKeyToAccount(key), chain: hidekiTestnet, transport: http(RPC) });
const pub = createPublicClient({ chain: hidekiTestnet, transport: http(RPC) });

const hash = await wallet.deployContract({ abi: c.abi, bytecode: `0x${c.evm.bytecode.object}`, args: [size, BigInt(lobby), BigInt(confirmSecs), process.env.DREAMDEX_PERMISSIONS_REGISTRY ?? '0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a'] });
const rc = await pub.waitForTransactionReceipt({ hash });
console.log(`Registry deployed: ${size} players per match, lobby ${lobby}s, confirm window ${confirmSecs}s.`);
console.log(`Tx: https://explorer.testnet.somnia.network/tokyo/tx/${hash}`);
setEnv('NEXT_PUBLIC_REGISTRY_ADDRESS', rc.contractAddress);
console.log('Restart the dev server so the app picks it up.');
