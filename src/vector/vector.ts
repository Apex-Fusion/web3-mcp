import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Lucid, fromText } from 'lucid-cardano';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { OgmiosProvider } from './ogmios-provider.js';
import { safetyLayer } from './safety.js';
import type {
  VectorToken,
  VectorWalletInfo,
  VectorAdaTransactionResult,
  VectorTokenTransactionResult,
} from './types.js';

// Direct .env loading
const __filename = fileURLToPath(import.meta.url);
const projectRoot = resolve(__filename, '../../../..');
const envPath = resolve(projectRoot, '.env');

if (existsSync(envPath)) {
  const result = dotenv.config({ path: envPath });
  if (result.error) {
    console.error('Error loading .env file:', result.error);
  }
}

// Configuration from environment variables
const VECTOR_OGMIOS_URL = process.env.VECTOR_OGMIOS_URL || 'https://ogmios.vector.testnet.apexfusion.org';
const VECTOR_SUBMIT_URL = process.env.VECTOR_SUBMIT_URL || 'https://submit.vector.testnet.apexfusion.org/api/submit/tx';
const VECTOR_KOIOS_URL = process.env.VECTOR_KOIOS_URL || 'https://koios.vector.testnet.apexfusion.org/';
const VECTOR_EXPLORER_URL = process.env.VECTOR_EXPLORER_URL || 'https://vector.testnet.apexscan.org';
const VECTOR_MNEMONIC = process.env.VECTOR_MNEMONIC || '';
const VECTOR_ACCOUNT_INDEX = parseInt(process.env.VECTOR_ACCOUNT_INDEX || '0');

// Helper function to format ADA amounts
function lovelaceToAda(lovelace: string | number | bigint): string {
  return (Number(BigInt(String(lovelace))) / 1_000_000).toFixed(6);
}

// Helper function to format asset name
function formatAssetName(name: string): string {
  try {
    if (/^[0-9a-fA-F]+$/.test(name) && name.length > 0) {
      return Buffer.from(name, 'hex').toString('utf8');
    }
    return name;
  } catch {
    return name;
  }
}

// Explorer link helper
function explorerTxLink(txHash: string): string {
  return `${VECTOR_EXPLORER_URL}/transaction/${txHash}`;
}

// Initialize Lucid instance with Ogmios provider
async function initLucid() {
  const provider = new OgmiosProvider({
    ogmiosUrl: VECTOR_OGMIOS_URL,
    submitUrl: VECTOR_SUBMIT_URL,
    koiosUrl: VECTOR_KOIOS_URL,
  });

  // Vector uses --mainnet flag, so addresses are addr1... format
  const lucid = await Lucid.new(provider, 'Mainnet');

  if (!VECTOR_MNEMONIC) {
    throw new Error('VECTOR_MNEMONIC is required in .env file');
  }

  const trimmedMnemonic = VECTOR_MNEMONIC.trim();
  const words = trimmedMnemonic.split(/\s+/);

  if (words.length !== 15 && words.length !== 24) {
    throw new Error(`Invalid mnemonic: Expected 15 or 24 words, got ${words.length}`);
  }

  lucid.selectWalletFromSeed(trimmedMnemonic, { accountIndex: VECTOR_ACCOUNT_INDEX });

  const address = await lucid.wallet.address();
  if (!address) {
    throw new Error('Failed to derive address from mnemonic');
  }

  return lucid;
}

// Get wallet info
export async function getWalletInfo(): Promise<VectorWalletInfo> {
  const lucid = await initLucid();
  const address = await lucid.wallet.address();
  const utxos = await lucid.wallet.getUtxos();

  let adaBalance = '0';
  let tokenBalances: VectorToken[] = [];

  if (utxos.length > 0) {
    // Aggregate all UTxO assets
    const aggregated: Record<string, bigint> = {};
    for (const utxo of utxos) {
      for (const [unit, qty] of Object.entries(utxo.assets)) {
        aggregated[unit] = (aggregated[unit] || 0n) + BigInt(qty);
      }
    }

    adaBalance = aggregated['lovelace'] ? lovelaceToAda(aggregated['lovelace']) : '0';

    for (const [unit, quantity] of Object.entries(aggregated)) {
      if (unit === 'lovelace') continue;

      try {
        const policyId = unit.slice(0, 56);
        const assetNameHex = unit.slice(56);
        const displayName = assetNameHex
          ? formatAssetName(assetNameHex)
          : `${policyId.substring(0, 8)}...`;

        tokenBalances.push({
          unit,
          name: displayName,
          quantity: quantity.toString(),
        });
      } catch {
        tokenBalances.push({
          unit,
          name: unit,
          quantity: quantity.toString(),
        });
      }
    }
  }

  return {
    address,
    utxoCount: utxos.length,
    ada: adaBalance,
    tokens: tokenBalances,
  };
}

// Send ADA transaction
export async function sendAda(
  recipientAddress: string,
  amountAda: number,
  metadata: any = null
): Promise<VectorAdaTransactionResult> {
  if (!recipientAddress) {
    throw new Error('Recipient address is required');
  }

  if (typeof amountAda !== 'number' || amountAda <= 0) {
    throw new Error('Amount must be a positive number');
  }

  const lovelaceAmount = Math.floor(amountAda * 1_000_000);

  // Safety check
  const safetyCheck = safetyLayer.checkTransaction(lovelaceAmount);
  if (!safetyCheck.allowed) {
    throw new Error(`Safety limit exceeded: ${safetyCheck.reason}`);
  }

  const lucid = await initLucid();
  const senderAddress = await lucid.wallet.address();

  // Validate recipient address
  try {
    // @ts-ignore
    lucid.utils.getAddressDetails(recipientAddress);
  } catch (error) {
    throw new Error(`Invalid recipient address: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Build transaction
  // @ts-ignore
  let tx = lucid.newTx()
    .payToAddress(recipientAddress, { lovelace: BigInt(lovelaceAmount) });

  if (metadata) {
    const parsedMetadata = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    // @ts-ignore
    tx = tx.attachMetadata(674, parsedMetadata);
  }

  // @ts-ignore
  tx = await tx.complete();
  // @ts-ignore
  const signedTx = await tx.sign().complete();
  const txHash = await signedTx.submit();

  // Record in safety layer
  safetyLayer.recordTransaction(txHash, lovelaceAmount, recipientAddress);

  return {
    txHash,
    senderAddress,
    recipientAddress,
    amount: amountAda,
    links: {
      explorer: explorerTxLink(txHash),
    },
  };
}

// Send tokens transaction
export async function sendTokens(
  recipientAddress: string,
  policyId: string,
  assetName: string,
  amount: string,
  adaAmount: number | null = null
): Promise<VectorTokenTransactionResult> {
  if (!recipientAddress) throw new Error('Recipient address is required');
  if (!policyId) throw new Error('Policy ID is required');
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    throw new Error('Amount must be a positive number');
  }

  // Safety check on ADA portion
  const adaLovelace = adaAmount ? Math.floor(adaAmount * 1_000_000) : 2_000_000; // min ~2 ADA
  const safetyCheck = safetyLayer.checkTransaction(adaLovelace);
  if (!safetyCheck.allowed) {
    throw new Error(`Safety limit exceeded: ${safetyCheck.reason}`);
  }

  const lucid = await initLucid();
  const senderAddress = await lucid.wallet.address();

  try {
    // @ts-ignore
    lucid.utils.getAddressDetails(recipientAddress);
  } catch (error) {
    throw new Error(`Invalid recipient address: ${error instanceof Error ? error.message : String(error)}`);
  }

  let assetNameHex = assetName;
  if (assetName && !/^[0-9a-fA-F]+$/.test(assetName)) {
    assetNameHex = fromText(assetName);
  }

  const unit = `${policyId}${assetNameHex}`;
  const assets = { [unit]: BigInt(amount) };

  const outputLovelace = adaAmount
    ? BigInt(Math.floor(adaAmount * 1_000_000))
    : BigInt(2_000_000); // Default min ADA

  // @ts-ignore
  let tx = lucid.newTx()
    .payToAddress(recipientAddress, {
      lovelace: outputLovelace,
      ...assets,
    });

  // @ts-ignore
  tx = await tx.complete();
  // @ts-ignore
  const signedTx = await tx.sign().complete();
  const txHash = await signedTx.submit();

  safetyLayer.recordTransaction(txHash, Number(outputLovelace), recipientAddress);

  const displayAssetName = assetName ? formatAssetName(assetNameHex) : '';

  return {
    txHash,
    senderAddress,
    recipientAddress,
    token: {
      policyId,
      name: displayAssetName,
      amount,
    },
    ada: lovelaceToAda(outputLovelace),
    links: {
      explorer: explorerTxLink(txHash),
    },
  };
}

// Register all Vector MCP tools
export function registerVectorTools(server: McpServer) {

  // vector_get_balance — Get balance for any address
  // @ts-ignore: MCP SDK deep type instantiation
  server.tool(
    "vector_get_balance",
    "Get ADA and token balances for a Vector address",
    {
      address: z.string().describe("Vector address to check (addr1...)"),
    },
    async ({ address }) => {
      try {
        const provider = new OgmiosProvider({
          ogmiosUrl: VECTOR_OGMIOS_URL,
          submitUrl: VECTOR_SUBMIT_URL,
          koiosUrl: VECTOR_KOIOS_URL,
        });

        const utxos = await provider.getUtxos(address);

        // Aggregate all assets
        const tokenMap = new Map<string, bigint>();
        for (const utxo of utxos) {
          for (const [unit, qty] of Object.entries(utxo.assets)) {
            const current = tokenMap.get(unit) || 0n;
            tokenMap.set(unit, current + BigInt(qty));
          }
        }

        const adaBalance = tokenMap.get('lovelace') || 0n;
        tokenMap.delete('lovelace');

        const tokens = Array.from(tokenMap.entries()).map(([unit, quantity]) => {
          const policyId = unit.slice(0, 56);
          const assetNameHex = unit.slice(56);
          return {
            unit,
            policyId,
            assetName: formatAssetName(assetNameHex),
            quantity: quantity.toString(),
          };
        });

        tokens.sort((a, b) => (BigInt(b.quantity) - BigInt(a.quantity)) > 0n ? 1 : -1);

        const tokenList = tokens.length > 0
          ? tokens.map(t => `${t.quantity} ${t.assetName || t.unit} (Policy: ${t.policyId.substring(0, 8)}...)`).join('\n')
          : 'No tokens found';

        return {
          content: [{
            type: "text",
            text: `Vector Address Balance for ${address}:

ADA Balance: ${lovelaceToAda(adaBalance)} ADA
UTxO Count: ${utxos.length}

${tokens.length > 0 ? `Token Holdings (${tokens.length}):\n${tokenList}` : 'No token holdings found'}`,
          }],
        };
      } catch (err) {
        const error = err as Error;
        return {
          content: [{
            type: "text",
            text: `Failed to retrieve Vector address balance: ${error.message}`,
          }],
        };
      }
    }
  );

  // vector_get_address — Get the agent's wallet address and balance
  // @ts-ignore: MCP SDK deep type instantiation
  server.tool(
    "vector_get_address",
    "Get the agent's Vector wallet address, balance, and token holdings",
    {},
    async () => {
      try {
        const walletInfo = await getWalletInfo();

        const tokenList = walletInfo.tokens.length > 0
          ? walletInfo.tokens.map((t: VectorToken) => `${t.quantity} ${t.name}`).join('\n')
          : 'No tokens found';

        return {
          content: [{
            type: "text",
            text: `# Vector Wallet Information

Address: ${walletInfo.address}
ADA Balance: ${walletInfo.ada} ADA
UTXO Count: ${walletInfo.utxoCount}

${walletInfo.tokens.length > 0 ? `## Token Holdings (${walletInfo.tokens.length}):\n${tokenList}` : 'No token holdings found'}`,
          }],
        };
      } catch (err) {
        const error = err as Error;
        return {
          content: [{
            type: "text",
            text: `Failed to get wallet information: ${error.message}

**Troubleshooting Tips:**
1. Make sure you have a valid 15 or 24-word mnemonic in VECTOR_MNEMONIC
2. Verify the Ogmios endpoint is reachable: ${VECTOR_OGMIOS_URL}
3. Check the console logs for detailed error information`,
          }],
        };
      }
    }
  );

  // vector_get_utxos — List UTxOs for an address or the wallet
  // @ts-ignore: MCP SDK deep type instantiation
  server.tool(
    "vector_get_utxos",
    "List unspent transaction outputs (UTxOs) for a Vector address or the agent's wallet",
    {
      address: z.string().optional().describe("Vector address to query UTxOs for. If omitted, uses the agent's wallet."),
    },
    async ({ address }) => {
      try {
        let utxos;
        let queryAddress: string;

        if (address) {
          const provider = new OgmiosProvider({
            ogmiosUrl: VECTOR_OGMIOS_URL,
            submitUrl: VECTOR_SUBMIT_URL,
            koiosUrl: VECTOR_KOIOS_URL,
          });
          utxos = await provider.getUtxos(address);
          queryAddress = address;
        } else {
          const lucid = await initLucid();
          queryAddress = await lucid.wallet.address();
          utxos = await lucid.wallet.getUtxos();
        }

        if (utxos.length === 0) {
          return {
            content: [{
              type: "text",
              text: `No UTxOs found for ${queryAddress}`,
            }],
          };
        }

        const utxoList = utxos.map((utxo, i) => {
          const ada = utxo.assets['lovelace'] ? lovelaceToAda(utxo.assets['lovelace']) : '0';
          const tokenCount = Object.keys(utxo.assets).filter(k => k !== 'lovelace').length;
          return `${i + 1}. ${utxo.txHash}#${utxo.outputIndex} — ${ada} ADA${tokenCount > 0 ? ` + ${tokenCount} token(s)` : ''}`;
        }).join('\n');

        return {
          content: [{
            type: "text",
            text: `# UTxOs for ${queryAddress}

Total: ${utxos.length} UTxO(s)

${utxoList}`,
          }],
        };
      } catch (err) {
        const error = err as Error;
        return {
          content: [{
            type: "text",
            text: `Failed to get UTxOs: ${error.message}`,
          }],
        };
      }
    }
  );

  // vector_send_ada — Send ADA with safety limits
  // @ts-ignore: MCP SDK deep type instantiation
  server.tool(
    "vector_send_ada",
    "Send ADA from the agent's wallet to a recipient address (respects spend limits)",
    {
      recipientAddress: z.string().describe("Recipient Vector address (addr1...)"),
      amount: z.number().min(1).describe("Amount of ADA to send"),
      metadata: z.string().optional().describe("Optional transaction metadata in JSON format"),
    },
    async ({ recipientAddress, amount, metadata }) => {
      try {
        const result = await sendAda(recipientAddress, amount, metadata);

        return {
          content: [{
            type: "text",
            text: `# ADA Transaction Successful

Transaction Hash: ${result.txHash}
From: ${result.senderAddress}
To: ${result.recipientAddress}
Amount: ${result.amount} ADA

[View on Explorer](${result.links.explorer})`,
          }],
        };
      } catch (err) {
        const error = err as Error;
        return {
          content: [{
            type: "text",
            text: `Failed to send ADA: ${error.message}

**Troubleshooting Tips:**
1. Check that your wallet has sufficient balance
2. Verify the recipient address is correct (addr1...)
3. Check spend limits with vector_get_spend_limits
4. Verify the Ogmios endpoint is reachable`,
          }],
        };
      }
    }
  );

  // vector_send_tokens — Send native tokens with safety limits
  // @ts-ignore: MCP SDK deep type instantiation
  server.tool(
    "vector_send_tokens",
    "Send Vector native tokens from the agent's wallet to a recipient address",
    {
      recipientAddress: z.string().describe("Recipient Vector address (addr1...)"),
      policyId: z.string().describe("Token policy ID"),
      assetName: z.string().describe("Asset name (can be empty for policy-only tokens)"),
      amount: z.string().describe("Amount of tokens to send"),
      adaAmount: z.number().optional().describe("Optional ADA to include (uses minimum required if not specified)"),
    },
    async ({ recipientAddress, policyId, assetName, amount, adaAmount }) => {
      try {
        const result = await sendTokens(recipientAddress, policyId, assetName, amount, adaAmount);

        return {
          content: [{
            type: "text",
            text: `# Token Transaction Successful

Transaction Hash: ${result.txHash}
From: ${result.senderAddress}
To: ${result.recipientAddress}

Token Details:
- Policy ID: ${result.token.policyId}
- Asset Name: ${result.token.name || '(none)'}
- Amount: ${result.token.amount}

Included ADA: ${result.ada} ADA

[View on Explorer](${result.links.explorer})`,
          }],
        };
      } catch (err) {
        const error = err as Error;
        return {
          content: [{
            type: "text",
            text: `Failed to send tokens: ${error.message}

**Troubleshooting Tips:**
1. Check that your wallet has sufficient ADA and token balance
2. Verify the policy ID and asset name are correct
3. Verify the recipient address is correct (addr1...)
4. Check spend limits with vector_get_spend_limits`,
          }],
        };
      }
    }
  );

  // vector_get_spend_limits — Check safety layer status
  // @ts-ignore: MCP SDK deep type instantiation
  server.tool(
    "vector_get_spend_limits",
    "Check current spend limits and remaining daily budget",
    {},
    async () => {
      try {
        const status = safetyLayer.getSpendStatus();
        const log = safetyLayer.getAuditLog();

        const recentTxs = log.slice(-5).reverse().map((entry) =>
          `- ${entry.timestamp}: ${lovelaceToAda(entry.amountLovelace)} ADA → ${entry.recipient.substring(0, 20)}... (${entry.txHash.substring(0, 16)}...)`
        ).join('\n');

        return {
          content: [{
            type: "text",
            text: `# Vector Spend Limits

Per-Transaction Limit: ${lovelaceToAda(status.perTransactionLimit)} ADA
Daily Limit: ${lovelaceToAda(status.dailyLimit)} ADA
Daily Spent: ${lovelaceToAda(status.dailySpent)} ADA
Daily Remaining: ${lovelaceToAda(status.dailyRemaining)} ADA
Resets At: ${status.resetTime}

${log.length > 0 ? `## Recent Transactions (last ${Math.min(5, log.length)}):\n${recentTxs}` : 'No transactions recorded yet.'}`,
          }],
        };
      } catch (err) {
        const error = err as Error;
        return {
          content: [{
            type: "text",
            text: `Failed to get spend limits: ${error.message}`,
          }],
        };
      }
    }
  );
}
