import { Router } from 'express';
import {
  listTransactions,
  getTransaction,
  getTransactionRiskBreakdown,
  updateStatus,
  exportCSV,
  getStats,
} from './transaction.controller';
import { protect, authorize } from '../../middleware/auth';
import { ROLES } from '../../utils/constants';

const router = Router();

router.use(protect);

// ── Static routes FIRST (before /:txnId) ─────────────────────────────────
// If these are after /:txnId, Express treats "stats" and "export"
// as transaction IDs — a very common Express routing mistake

router.get('/stats', getStats);

router.get(
  '/export',
  authorize(ROLES.ADMIN, ROLES.COMPLIANCE_OFFICER, ROLES.ANALYST, ROLES.AUDITOR),
  exportCSV
);

// ── Dynamic routes AFTER static routes ───────────────────────────────────

router.get(
  '/',
  authorize(ROLES.ADMIN, ROLES.COMPLIANCE_OFFICER, ROLES.ANALYST, ROLES.AUDITOR),
  listTransactions
);

router.get(
  '/:txnId',
  authorize(ROLES.ADMIN, ROLES.COMPLIANCE_OFFICER, ROLES.ANALYST, ROLES.AUDITOR),
  getTransaction
);

router.get(
  '/:txnId/risk-breakdown',
  authorize(ROLES.ADMIN, ROLES.COMPLIANCE_OFFICER, ROLES.ANALYST, ROLES.AUDITOR),
  getTransactionRiskBreakdown
);

router.patch(
  '/:txnId/status',
  authorize(ROLES.ADMIN, ROLES.COMPLIANCE_OFFICER), // Analysts & Auditors cannot modify
  updateStatus
);

export default router;