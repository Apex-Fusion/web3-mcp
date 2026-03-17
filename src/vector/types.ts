// Vector-specific type definitions

export interface VectorToken {
  unit: string;
  name: string;
  quantity: string;
}

export interface VectorWalletInfo {
  address: string;
  utxoCount: number;
  ada: string;
  tokens: VectorToken[];
}

export interface VectorAdaTransactionResult {
  txHash: string;
  senderAddress: string;
  recipientAddress: string;
  amount: number;
  links: {
    explorer: string;
  };
}

export interface VectorTokenTransactionResult {
  txHash: string;
  senderAddress: string;
  recipientAddress: string;
  token: {
    policyId: string;
    name: string;
    amount: string;
  };
  ada: string;
  links: {
    explorer: string;
  };
}

export interface SpendLimits {
  perTransaction: number; // lovelace
  daily: number; // lovelace
}

export interface SpendStatus {
  perTransactionLimit: number;
  dailyLimit: number;
  dailySpent: number;
  dailyRemaining: number;
  resetTime: string;
}

export interface AuditEntry {
  timestamp: string;
  txHash: string;
  amountLovelace: number;
  recipient: string;
  action: string;
}
