import { TransactionModel } from '../../models/Transaction.model';
import { AlertRuleModel } from '../../models/AlertRule.model';
import { RISK_LEVELS, RiskLevel } from '../../utils/constants';
import logger from '../../utils/logger';

// ─── OFAC / UN Sanctioned Countries List ─────────────────────────────────
// ─── RBI / FIU-IND High Risk Countries List ──────────────────────────────
// Based on: FATF High-Risk Jurisdictions + RBI Caution List + UNSC Sanctions
// RBI Master Direction on KYC 2016 (updated 2023) — Schedule III countries

const SANCTIONED_COUNTRIES = new Set([
  // FATF Black List (High-Risk Jurisdictions subject to a Call for Action)
  'KP', // North Korea
  'IR', // Iran
  'MM', // Myanmar (added 2022)

  // FATF Grey List (Jurisdictions under Increased Monitoring) — select high risk
  'PK', // Pakistan — high relevance for India
  'AF', // Afghanistan
  'SY', // Syria
  'YE', // Yemen
  'IQ', // Iraq
  'LY', // Libya
  'SS', // South Sudan
  'SD', // Sudan

  // UNSC Sanctions
  'CU', // Cuba
  'VE', // Venezuela

  // RBI specific caution — post 2022 geopolitical
  'RU', // Russia (certain transactions)
  'BY', // Belarus
]);

// ─── India Regulatory Thresholds ─────────────────────────────────────────
const CTR_THRESHOLD = 1000000;    // ₹10 Lakh — mandatory CTR filing with FIU-IND
const WIRE_THRESHOLD = 5000000;   // ₹50 Lakh — enhanced due diligence
const ROUND_AMOUNT_MIN = 100000;  // ₹1 Lakh minimum for round amount flag
const VELOCITY_LIMIT = 5;         // More than 5 transactions in 24 hours

// ─── Risk Score → Risk Level Mapping ─────────────────────────────────────
export const getRiskLevel = (score: number): RiskLevel => {
  if (score >= 81) return RISK_LEVELS.CRITICAL;
  if (score >= 51) return RISK_LEVELS.HIGH;
  if (score >= 21) return RISK_LEVELS.MEDIUM;
  return RISK_LEVELS.LOW;
};

// ─── Rule Check Result ────────────────────────────────────────────────────
interface RuleResult {
  triggered: boolean;
  weight: number;
  flagCode: string;
}

// ─── Individual Rule Checkers ─────────────────────────────────────────────

// Rule 1: LARGE_CASH_TRANSACTION
// Single cash transaction above the regulatory reporting threshold
const checkLargeCash = (
  amount: number,
  txnType: string,
  threshold: number,
  weight: number
): RuleResult => ({
  triggered: txnType === 'CASH' && amount >= threshold,
  weight,
  flagCode: 'LARGE_CASH_TRANSACTION',
});

// Rule 2: STRUCTURING
// Amount is suspiciously close to but below reporting threshold
// Classic "smurfing" — breaking large amounts into smaller ones
const checkStructuring = (
  amount: number,
  threshold: number,
  weight: number
): RuleResult => {
  const lowerBound = threshold * 0.8; // 80% of threshold
  const upperBound = threshold - 1;   // Just below threshold
  return {
    triggered: amount >= lowerBound && amount <= upperBound,
    weight,
    flagCode: 'STRUCTURING',
  };
};

// Rule 3: SANCTIONED_COUNTRY
// Any transaction involving a sanctioned country
const checkSanctionedCountry = (
  senderCountry: string,
  receiverCountry: string,
  weight: number
): RuleResult => ({
  triggered:
    SANCTIONED_COUNTRIES.has(senderCountry.toUpperCase()) ||
    SANCTIONED_COUNTRIES.has(receiverCountry.toUpperCase()),
  weight,
  flagCode: 'SANCTIONED_COUNTRY',
});

// Rule 4: ROUND_AMOUNT
// Exactly round numbers are statistically abnormal in real transactions
const checkRoundAmount = (
  amount: number,
  threshold: number,
  weight: number
): RuleResult => ({
  triggered: amount >= threshold && amount % 1000 === 0,
  weight,
  flagCode: 'ROUND_AMOUNT_STRUCTURING',
});

// Rule 5: HIGH_VALUE_WIRE
// Large wire/SWIFT transfers warrant scrutiny
const checkHighValueWire = (
  amount: number,
  txnType: string,
  threshold: number,
  weight: number
): RuleResult => ({
  triggered: ['WIRE', 'SWIFT'].includes(txnType) && amount >= threshold,
  weight,
  flagCode: 'HIGH_VALUE_WIRE',
});

// ─── Velocity Rule (requires DB lookup) ──────────────────────────────────

// Rule 6: VELOCITY_BREACH
// Same sender making too many transactions in a 24-hour window
// This is a strong indicator of smurfing or automated fraud
const checkVelocity = async (
  senderId: string,
  currentTxnId: string,
  maxCount: number,
  weight: number
): Promise<RuleResult> => {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const count = await TransactionModel.countDocuments({
    senderId,
    txnId: { $ne: currentTxnId }, // Exclude current transaction
    processedAt: { $gte: twentyFourHoursAgo },
  });

  return {
    triggered: count >= maxCount,
    weight,
    flagCode: 'VELOCITY_BREACH',
  };
};

// Rule 7: RAPID_IN_OUT (Pass-Through / Layering)
// Funds received and then sent out quickly — classic layering behavior
// For seed data we approximate this by checking if receiver is also a frequent sender
const checkRapidInOut = async (
  receiverId: string,
  weight: number
): Promise<RuleResult> => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

  // Check if this receiver has also sent money in the last 2 hours
  // (they received money and immediately moved it out)
  const outgoingCount = await TransactionModel.countDocuments({
    senderId: receiverId,
    processedAt: { $gte: twoHoursAgo },
  });

  return {
    triggered: outgoingCount >= 2,
    weight,
    flagCode: 'RAPID_IN_OUT',
  };
};

// Rule 8: DORMANT_ACCOUNT
// Account with no activity for 90+ days suddenly active
const checkDormantAccount = async (
  senderId: string,
  currentTxnId: string,
  weight: number
): Promise<RuleResult> => {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const recentActivity = await TransactionModel.findOne({
    senderId,
    txnId: { $ne: currentTxnId },
    processedAt: { $gte: ninetyDaysAgo },
  });

  // Also check there IS historical activity (truly dormant, not new account)
  const hasHistory = await TransactionModel.findOne({
    senderId,
    txnId: { $ne: currentTxnId },
    processedAt: { $lt: ninetyDaysAgo },
  });

  return {
    triggered: hasHistory !== null && recentActivity === null,
    weight,
    flagCode: 'DORMANT_ACCOUNT_ACTIVATION',
  };
};

// ─── Main Scoring Function ────────────────────────────────────────────────

export interface ScoringInput {
  txnId: string;
  amount: number;
  txnType: string;
  senderCountry: string;
  receiverCountry: string;
  senderId: string;
  receiverId: string;
}

export interface ScoringResult {
  riskScore: number;
  riskLevel: RiskLevel;
  flags: string[];
}

export const scoreTransaction = async (
  input: ScoringInput
): Promise<ScoringResult> => {
  try {
    // Load active rules from DB (admin-configurable)
    const activeRules = await AlertRuleModel.find({ isActive: true });

    // Build a lookup map for quick access: ruleCode → rule
    const ruleMap = new Map(activeRules.map((r) => [r.ruleCode, r]));

    const getRule = (code: string) => ruleMap.get(code);

    // ─── Run all synchronous checks ────────────────────────────────────
    const syncResults: RuleResult[] = [];

    const largeCashRule = getRule('LARGE_CASH_TRANSACTION');
    if (largeCashRule) {
      syncResults.push(
        checkLargeCash(input.amount, input.txnType, largeCashRule.threshold, largeCashRule.riskWeight)
      );
    }

    const structuringRule = getRule('STRUCTURING');
    if (structuringRule) {
      syncResults.push(
        checkStructuring(input.amount, structuringRule.threshold, structuringRule.riskWeight)
      );
    }

    const sanctionRule = getRule('SANCTIONED_COUNTRY');
    if (sanctionRule) {
      syncResults.push(
        checkSanctionedCountry(input.senderCountry, input.receiverCountry, sanctionRule.riskWeight)
      );
    }

    const roundAmountRule = getRule('ROUND_AMOUNT_STRUCTURING');
    if (roundAmountRule) {
      syncResults.push(
        checkRoundAmount(input.amount, roundAmountRule.threshold, roundAmountRule.riskWeight)
      );
    }

    const highWireRule = getRule('HIGH_VALUE_WIRE');
    if (highWireRule) {
      syncResults.push(
        checkHighValueWire(input.amount, input.txnType, highWireRule.threshold, highWireRule.riskWeight)
      );
    }

    // ─── Run all async checks (DB lookups) ─────────────────────────────
    const asyncResults: RuleResult[] = [];

    const velocityRule = getRule('VELOCITY_BREACH');
    if (velocityRule) {
      asyncResults.push(
        await checkVelocity(input.senderId, input.txnId, velocityRule.threshold, velocityRule.riskWeight)
      );
    }

    const rapidInOutRule = getRule('RAPID_IN_OUT');
    if (rapidInOutRule) {
      asyncResults.push(await checkRapidInOut(input.receiverId, rapidInOutRule.riskWeight));
    }

    const dormantRule = getRule('DORMANT_ACCOUNT_ACTIVATION');
    if (dormantRule) {
      asyncResults.push(
        await checkDormantAccount(input.senderId, input.txnId, dormantRule.riskWeight)
      );
    }

    // ─── Tally the score ────────────────────────────────────────────────
    const allResults = [...syncResults, ...asyncResults];
    const triggeredFlags: string[] = [];
    let totalScore = 0;

    for (const result of allResults) {
      if (result.triggered) {
        totalScore += result.weight;
        triggeredFlags.push(result.flagCode);
      }
    }

    // Cap at 150 — multiple rules can stack beyond 100
    const finalScore = Math.min(totalScore, 150);
    const riskLevel = getRiskLevel(finalScore);

    return {
      riskScore: finalScore,
      riskLevel,
      flags: triggeredFlags,
    };

  } catch (error) {
    logger.error({ error, txnId: input.txnId }, 'Risk scoring failed');
    // Fail safe — return LOW risk if scoring errors
    // In production this would trigger an alert to engineering
    return { riskScore: 0, riskLevel: RISK_LEVELS.LOW, flags: [] };
  }
};