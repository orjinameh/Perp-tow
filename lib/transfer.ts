import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { createPublicClient, createWalletClient, getAddress, http, isAddress, parseAbi, parseEther, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { logActivity } from './activity';

type Hex = `0x${string}`;
const RPC = 'https://api.hideki2.infra.testnet.somnia.network';
const USDSO = '0xed7993A74dAe1e6656B704A424DcD8711aAf4F72' as const;
const ERC20 = parseAbi(['function transfer(address to, uint256 amount) returns (bool)', 'function balanceOf(address) view returns (uint256)']);

function reason(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string };
  return (err.shortMessage ?? err.message ?? String(e)).replace(/\s+/g, ' ').slice(0, 240);
}

/** Checks the form fields and returns the clean address and amount text, or throws a sentence for the player. */
export function checkSend(to: string, amount: string): { to: Hex; amount: string } {
  const t = to.trim();
  if (!isAddress(t)) throw new Error('Enter a full wallet address that starts with 0x (42 characters).');
  const a = amount.trim();
  if (!/^\d*\.?\d+$/.test(a) || Number(a) <= 0) throw new Error('Enter an amount greater than zero, for example 5 or 0.25.');
  return { to: getAddress(t), amount: a };
}

/** Sends STT (gas token) or USDso from the game wallet to any address. Returns the transaction hash. */
export async function sendFunds(key: Hex, token: 'STT' | 'USDso', toRaw: string, amountRaw: string): Promise<string> {
  const { to, amount } = checkSend(toRaw, amountRaw);
  const account = privateKeyToAccount(key);
  if (to.toLowerCase() === account.address.toLowerCase()) throw new Error('That is this same wallet. Enter a different address.');
  const pub = createPublicClient({ chain: hidekiTestnet, transport: http(RPC) });
  const wallet = createWalletClient({ chain: hidekiTestnet, transport: http(RPC), account });
  try {
    let hash: Hex;
    if (token === 'STT') {
      const value = parseEther(amount);
      const have = await pub.getBalance({ address: account.address });
      if (have < value) throw new Error('Not enough STT in this wallet for that amount (keep a little for gas).');
      hash = await wallet.sendTransaction({ to, value });
    } else {
      const value = parseUnits(amount, 18);
      const have = (await pub.readContract({ address: USDSO, abi: ERC20, functionName: 'balanceOf', args: [account.address] })) as bigint;
      if (have < value) throw new Error('Not enough USDso in this wallet for that amount.');
      const gas = await pub.getBalance({ address: account.address });
      if (gas === 0n) throw new Error('This wallet has 0 STT, so it cannot pay gas for the transfer. Send it some STT first.');
      hash = await wallet.writeContract({ address: USDSO, abi: ERC20, functionName: 'transfer', args: [to, value] });
    }
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== 'success') throw new Error('The transfer was sent but failed on the chain.');
    logActivity({ signer: account.address, kind: 'transfer', title: `Sent ${amount} ${token} to ${to.slice(0, 8)}…${to.slice(-6)}`, hash, status: 'confirmed' });
    return hash;
  } catch (e) {
    if (e instanceof Error && /^(Not enough|This wallet|The transfer)/.test(e.message)) throw e;
    logActivity({ signer: account.address, kind: 'transfer', title: `Send ${amount} ${token} to ${to.slice(0, 8)}…${to.slice(-6)}`, detail: reason(e), status: 'not sent' });
    throw new Error(`Transfer failed: ${reason(e)}`);
  }
}
