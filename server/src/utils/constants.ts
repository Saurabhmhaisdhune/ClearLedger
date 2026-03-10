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
  SAR_FILED: 'SAR_FILED',
  CLOSED: 'CLOSED',
} as const;

export const CASE_STATUS = {
  OPEN: 'OPEN',
  UNDER_REVIEW: 'UNDER_REVIEW',
  ESCALATED: 'ESCALATED',
  SAR_FILED: 'SAR_FILED',
  CLOSED_FP: 'CLOSED_FP',   // False Positive
  CLOSED_TP: 'CLOSED_TP',   // True Positive
} as const;