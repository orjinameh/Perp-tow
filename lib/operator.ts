// Trading-key ("linked bot") mode, ported from the dreamDEX bot kit (MIT, Copyright DreamDEX S.A.,
// https://github.com/somnia-chain/dreamdex-bot-kit/blob/main/packages/perp-core/src/operator.ts).
//
// In the dreamDEX app a user links a key's address as a bot (wallet > Link a bot > Perps). That key can then
// call `placeOrderFor(owner, ...)` on a perp pool: the order, its margin and its fills belong to the user's
// own dreamDEX account. The key only signs and pays gas, and it cannot withdraw.
import { contractErrorsAbi, decodePlaceOrder } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import type { PublicClient, WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { RPC_URL } from './trading';

type Hex = `0x${string}`;

const PLACE_ORDER_FOR_SELECTOR = '0x80054449' as const;

const OPERATOR_ABI = [
  ...parseAbi([
    'function placeOrderFor(address owner, bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k) payable returns (bool success, uint128 orderId)',
    'function isOperatorAuthorized(address owner, address operator, bytes4 selector) view returns (bool)',
  ]),
  // Named pool errors, so a revert arrives with its name.
  ...contractErrorsAbi,
] as const;

/** The same gas the SDK sends a perp order with. Somnia bills gas used, not the limit. */
const ORDER_GAS = 10_000_000n;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

/** The SDK's resting-order expiry: fifty years out, in nanoseconds. */
function farFutureNs(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 50 * 365 * 24 * 3600) * 1_000_000_000n;
}

export interface TradingKey {
  owner: Hex;
  operator: Hex;
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: ReturnType<typeof privateKeyToAccount>;
}

export function createTradingKey(owner: Hex, privateKey: Hex): TradingKey {
  const account = privateKeyToAccount(privateKey);
  if (account.address.toLowerCase() === owner.toLowerCase()) {
    throw new Error('The game wallet is the same address as the dreamDEX account. Clear the account to trade the wallet itself.');
  }
  const transport = http(RPC_URL);
  return {
    owner,
    operator: account.address,
    account,
    publicClient: createPublicClient({ chain: hidekiTestnet, transport }) as PublicClient,
    walletClient: createWalletClient({ account, chain: hidekiTestnet, transport }),
  };
}

/** Whether the account has granted this key `placeOrderFor` on this pool (the pool's own answer is the one it enforces). */
export async function canPlaceFor(key: TradingKey, pool: Hex): Promise<boolean> {
  return (await key.publicClient.readContract({
    address: pool,
    abi: OPERATOR_ABI,
    functionName: 'isOperatorAuthorized',
    args: [key.owner, key.operator, PLACE_ORDER_FOR_SELECTOR],
  })) as boolean;
}

export const LINK_HELP = (operator: string, owner: string) =>
  `The game wallet ${operator} is not linked to ${owner}. In the dreamDEX app open the wallet, choose Link a bot, tick Perps and paste the game wallet address. A market listed after you linked needs the address added again.`;

export async function placeFor(
  key: TradingKey,
  p: { pool: Hex; isBid: boolean; price: bigint; quantity: bigint; orderType: number; userData: bigint },
) {
  const { request } = await key.publicClient.simulateContract({
    address: p.pool,
    abi: OPERATOR_ABI,
    functionName: 'placeOrderFor',
    args: [key.owner, p.isBid, p.userData, p.price, p.quantity, farFutureNs(), p.orderType, 0, ZERO_ADDRESS, 0n],
    account: key.account,
    gas: ORDER_GAS,
  });
  const hash = await key.walletClient.writeContract(request as never);
  const receipt = await key.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`placeOrderFor reverted on chain (tx ${hash}).`);
  const { orderId, fills } = decodePlaceOrder(receipt, p.pool);
  return { hash, orderId, fills };
}
