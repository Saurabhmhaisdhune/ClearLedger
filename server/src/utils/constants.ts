export const ROLES = {
  ADMIN: 'ADMIN',
  COMPLIANCE_OFFICER: 'COMPLIANCE_OFFICER',
  ANALYST: 'ANALYST',
  AUDITOR: 'AUDITOR',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const RISK_LEVELS = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;

export type RiskLevel = (typeof RISK_LEVELS)[keyof typeof RISK_LEVELS];

export const TRANSACTION_STATUS = {
  CLEAR: 'CLEAR',
  FLAGGED: 'FLAGGED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  ESCALATED: 'ESCALATED',
  STR_FILED: 'STR_FILED',   // India: Suspicious Transaction Report (not SAR)
  CLOSED: 'CLOSED',
} as const;

export const CASE_STATUS = {
  OPEN: 'OPEN',
  UNDER_REVIEW: 'UNDER_REVIEW',
  ESCALATED: 'ESCALATED',
  STR_FILED: 'STR_FILED',     // India: STR filed with FIU-IND
  CLOSED_FP: 'CLOSED_FP',     // False Positive
  CLOSED_TP: 'CLOSED_TP',     // True Positive
} as const;

// ─── India-Specific Currency ───────────────────────────────────────────────
export const DEFAULT_CURRENCY = 'INR';

// ─── India Regulatory Thresholds (PMLA 2002 + RBI Guidelines) ─────────────
export const INDIA_THRESHOLDS = {
  CTR_THRESHOLD: 1000000,      // ₹10 Lakh — Cash Transaction Report mandatory
  STR_NO_THRESHOLD: true,      // STR has NO minimum — any suspicious txn qualifies
  WIRE_SCRUTINY: 5000000,      // ₹50 Lakh — Enhanced due diligence for wire transfers
  HIGH_VALUE_CASH: 200000,     // ₹2 Lakh — PAN mandatory for cash above this
  ROUND_AMOUNT_MIN: 100000,    // ₹1 Lakh — Round amount flag threshold
} as const;