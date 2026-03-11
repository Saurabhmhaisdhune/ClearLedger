import { Request, Response } from 'express';
import { z } from 'zod';
import {
  getTransactions,
  getTransactionById,
  updateTransactionStatus,
  getRiskBreakdown,
  exportTransactionsCSV,
} from './transaction.service';
import { sendSuccess, sendError } from '../../utils/response';
import { asyncHandler } from '../../middleware/errorHandler';
import { TRANSACTION_STATUS } from '../../utils/constants';

// ─── Zod Schemas ──────────────────────────────────────────────────────────

const statusUpdateSchema = z.object({
  status: z.enum([
    'CLEAR',
    'FLAGGED',
    'UNDER_REVIEW',
    'ESCALATED',
    'STR_FILED',
    'CLOSED',
  ]),
  note: z.string().max(500).optional(),
});

// ─── GET /api/v1/transactions ─────────────────────────────────────────────
// Paginated list with filters

export const listTransactions = asyncHandler(
  async (req: Request, res: Response) => {
    const { transactions, meta } = await getTransactions(req.query);

    return sendSuccess(
      res,
      { transactions },
      'Transactions retrieved successfully',
      200,
      meta
    );
  }
);

// ─── GET /api/v1/transactions/stats ──────────────────────────────────────
// Summary stats for dashboard KPIs
// NOTE: This route must be registered BEFORE /:txnId to avoid
// Express treating "stats" as a txnId parameter

export const getStats = asyncHandler(
  async (_req: Request, res: Response) => {
    const { getTransactionStats } = await import('./transaction.service');
    const stats = await getTransactionStats();
    return sendSuccess(res, { stats }, 'Stats retrieved successfully');
  }
);

// ─── GET /api/v1/transactions/export ─────────────────────────────────────
// CSV export with same filters as list
// NOTE: Also register BEFORE /:txnId

export const exportCSV = asyncHandler(
  async (req: Request, res: Response) => {
    const csv = await exportTransactionsCSV(req.query);

    const filename = `clearledger_transactions_${
      new Date().toISOString().split('T')[0]
    }.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`
    );

    return res.status(200).send(csv);
  }
);

// ─── GET /api/v1/transactions/:txnId ─────────────────────────────────────
// Full transaction detail

export const getTransaction = asyncHandler(
  async (req: Request, res: Response) => {
    const { txnId } = req.params;

    const transaction = await getTransactionById(txnId as string);
    if (!transaction) {
      return sendError(
        res,
        `Transaction not found: ${txnId}`,
        404,
        'TXN_NOT_FOUND'
      );
    }

    return sendSuccess(
      res,
      { transaction },
      'Transaction retrieved successfully'
    );
  }
);

// ─── GET /api/v1/transactions/:txnId/risk-breakdown ──────────────────────
// Shows which AML rules fired and why

export const getTransactionRiskBreakdown = asyncHandler(
  async (req: Request, res: Response) => {
    const { txnId } = req.params;

    const breakdown = await getRiskBreakdown(txnId as string);
    if (!breakdown) {
      return sendError(res, 'Transaction not found', 404, 'TXN_NOT_FOUND');
    }

    return sendSuccess(
      res,
      { breakdown },
      'Risk breakdown retrieved successfully'
    );
  }
);

// ─── PATCH /api/v1/transactions/:txnId/status ────────────────────────────
// Update transaction status (state machine enforced)

export const updateStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const { txnId } = req.params;

    const parsed = statusUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(
        res,
        parsed.error.issues[0].message,
        400,
        'VALIDATION_ERROR'
      );
    }

    const { status, note } = parsed.data;
    const reviewedBy = req.user!.userId;

    const result = await updateTransactionStatus(
      txnId as string,
      status,
      reviewedBy,
      note
    );

    if (!result.success) {
      return sendError(
        res,
        result.error || 'Status update failed',
        400,
        'INVALID_STATUS_TRANSITION'
      );
    }

    return sendSuccess(
      res,
      { transaction: result.transaction },
      `Transaction status updated to ${status}`
    );
  }
);