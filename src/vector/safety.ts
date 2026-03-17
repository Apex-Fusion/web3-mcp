import type { SpendLimits, SpendStatus, AuditEntry } from './types.js';

const VECTOR_SPEND_LIMIT_PER_TX = parseInt(process.env.VECTOR_SPEND_LIMIT_PER_TX || '100000000'); // 100 ADA
const VECTOR_SPEND_LIMIT_DAILY = parseInt(process.env.VECTOR_SPEND_LIMIT_DAILY || '500000000'); // 500 ADA

export class SafetyLayer {
  private dailySpent: number = 0;
  private dailyResetTime: number;
  private auditLog: AuditEntry[] = [];
  private limits: SpendLimits;

  constructor() {
    this.limits = {
      perTransaction: VECTOR_SPEND_LIMIT_PER_TX,
      daily: VECTOR_SPEND_LIMIT_DAILY,
    };
    // Reset daily limit at midnight UTC
    this.dailyResetTime = this.getNextMidnightUTC();
  }

  private getNextMidnightUTC(): number {
    const now = new Date();
    const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return tomorrow.getTime();
  }

  private checkAndResetDaily(): void {
    if (Date.now() >= this.dailyResetTime) {
      this.dailySpent = 0;
      this.dailyResetTime = this.getNextMidnightUTC();
    }
  }

  checkTransaction(amountLovelace: number): { allowed: boolean; reason?: string } {
    this.checkAndResetDaily();

    if (amountLovelace > this.limits.perTransaction) {
      return {
        allowed: false,
        reason: `Transaction amount ${(amountLovelace / 1_000_000).toFixed(6)} ADA exceeds per-transaction limit of ${(this.limits.perTransaction / 1_000_000).toFixed(6)} ADA`,
      };
    }

    if (this.dailySpent + amountLovelace > this.limits.daily) {
      const remaining = this.limits.daily - this.dailySpent;
      return {
        allowed: false,
        reason: `Transaction would exceed daily spend limit. Daily limit: ${(this.limits.daily / 1_000_000).toFixed(6)} ADA, already spent: ${(this.dailySpent / 1_000_000).toFixed(6)} ADA, remaining: ${(remaining / 1_000_000).toFixed(6)} ADA`,
      };
    }

    return { allowed: true };
  }

  recordTransaction(txHash: string, amountLovelace: number, recipient: string): void {
    this.checkAndResetDaily();
    this.dailySpent += amountLovelace;

    this.auditLog.push({
      timestamp: new Date().toISOString(),
      txHash,
      amountLovelace,
      recipient,
      action: 'send',
    });
  }

  getSpendStatus(): SpendStatus {
    this.checkAndResetDaily();
    return {
      perTransactionLimit: this.limits.perTransaction,
      dailyLimit: this.limits.daily,
      dailySpent: this.dailySpent,
      dailyRemaining: Math.max(0, this.limits.daily - this.dailySpent),
      resetTime: new Date(this.dailyResetTime).toISOString(),
    };
  }

  getAuditLog(): AuditEntry[] {
    return [...this.auditLog];
  }
}

// Singleton instance
export const safetyLayer = new SafetyLayer();
