import { Types } from 'mongoose';
import { TransactionModel, ITransaction } from '../../models/Transaction.model';
import { scoreTransaction } from './riskEngine';
import { TRANSACTION_STATUS, RISK_LEVELS } from '../../utils/constants';
import {
  buildTransactionFilters,
  parsePagination,
  parseSort,
  buildMeta,
} from '../../utils/queryBuilder';
import { ParsedQs } from 'qs';
import { Parser } from 'json2csv';
import logger from '../../utils/logger';

// ─── Allowed sort fields for transactions ─────────────────────────────────
const SORTABLE_FIELDS = [
  'processedAt', 'amount', 'riskScore',
  'riskLevel', 'status', 'createdAt',
];

// ─── Valid status transitions (state machine) ─────────────────────────────
// Key = current status, Value = allowed next statuses
const STATUS_TRANSITIONS: Record<string, string[]> = {
  CLEAR:        ['FLAGGED'],
  FLAGGED:      ['UNDER_REVIEW', 'CLEAR'],
  UNDER_REVIEW: ['ESCALATED', 'CLEAR', 'STR_FILED'],
  ESCALATED:    ['STR_FILED', 'CLEAR'],
  STR_FILED:    ['CLOSED'],
  CLOSED:       [],  // Terminal state
};

// ─── 1. Get Paginated Transaction List ───────────────────────────────────

export const getTransactions = async (query: ParsedQs) => {
  const { page, limit, skip } = parsePagination(query);
  const sort = parseSort(query, SORTABLE_FIELDS);
  const filters = buildTransactionFilters(query);

  // Single aggregation with $facet — one DB round trip for both data + count
  const result = await TransactionModel.aggregate([
    { $match: filters },
    {
      $facet: {
        data: [
          { $sort: sort },
          { $skip: skip },
          { $limit: limit },
          {
            // Only return fields needed for the table view
            // Full detail fetched separately in getTransactionById
            $project: {
              txnId: 1,
              amount: 1,
              currency: 1,
              senderId: 1,
              senderName: 1,
              senderBank: 1,
              senderCountry: 1,
              receiverId: 1,
              receiverName: 1,
              receiverBank: 1,
              receiverCountry: 1,
              txnType: 1,
              channel: 1,
              riskScore: 1,
              riskLevel: 1,
              flags: 1,
              status: 1,
              processedAt: 1,
              createdAt: 1,
            },
          },
        ],
        totalCount: [{ $count: 'count' }],
      },
    },
  ]);

  const transactions = result[0]?.data ?? [];
  const total = result[0]?.totalCount[0]?.count ?? 0;

  return {
    transactions,
    meta: buildMeta(total, page, limit),
  };
};

// ─── 2. Get Single Transaction by ID ─────────────────────────────────────

export const getTransactionById = async (
  txnId: string
): Promise<ITransaction | null> => {
  // Populate reviewer info if someone has reviewed this transaction
  return TransactionModel.findOne({ txnId })
    .populate('reviewedBy', 'firstName lastName email role')
    .populate('linkedCaseId', 'caseId title status priority')
    .lean();
};

// ─── 3. Update Transaction Status ────────────────────────────────────────

export interface StatusUpdateResult {
  success: boolean;
  transaction?: ITransaction;
  error?: string;
}

export const updateTransactionStatus = async (
  txnId: string,
  newStatus: string,
  reviewedBy: string,
  note?: string
): Promise<StatusUpdateResult> => {

  const transaction = await TransactionModel.findOne({ txnId });

  if (!transaction) {
    return { success: false, error: 'Transaction not found' };
  }

  // ── Validate the status transition ──────────────────────────────────────
  const currentStatus = transaction.status;
  const allowedTransitions = STATUS_TRANSITIONS[currentStatus] ?? [];

  if (!allowedTransitions.includes(newStatus)) {
    return {
      success: false,
      error: `Invalid status transition: ${currentStatus} → ${newStatus}. Allowed: ${allowedTransitions.join(', ') || 'none (terminal state)'}`,
    };
  }

  // ── Apply the update ────────────────────────────────────────────────────
  const updated = await TransactionModel.findOneAndUpdate(
    { txnId },
    {
      status: newStatus,
      reviewedBy: new Types.ObjectId(reviewedBy),
      reviewedAt: new Date(),
    },
    { new: true } // Return updated document
  ).populate('reviewedBy', 'firstName lastName email role');

  logger.info(
    { txnId, fromStatus: currentStatus, toStatus: newStatus, reviewedBy },
    'Transaction status updated'
  );

  return { success: true, transaction: updated as ITransaction };
};

// ─── 4. Get Risk Score Breakdown (for detail page) ───────────────────────
// Re-runs rule checks to show WHY a transaction was scored the way it was

export const getRiskBreakdown = async (txnId: string) => {
  const transaction = await TransactionModel.findOne({ txnId });
  if (!transaction) return null;

  const { AlertRuleModel } = await import('../../models/AlertRule.model');
  const allRules = await AlertRuleModel.find({}).lean();

  // Build a breakdown showing each rule, whether it fired, and its weight
  const breakdown = allRules.map((rule) => ({
    ruleCode: rule.ruleCode,
    ruleName: rule.ruleName,
    category: rule.category,
    weight: rule.riskWeight,
    triggered: transaction.flags.includes(rule.ruleCode),
    isActive: rule.isActive,
    threshold: rule.threshold,
  }));

  const triggeredRules = breakdown.filter((r) => r.triggered);
  const totalScore = triggeredRules.reduce((sum, r) => sum + r.weight, 0);

  return {
    txnId,
    riskScore: transaction.riskScore,
    riskLevel: transaction.riskLevel,
    flags: transaction.flags,
    scoreBreakdown: breakdown,
    triggeredCount: triggeredRules.length,
    calculatedScore: Math.min(totalScore, 150),
  };
};

// ─── 5. Export Transactions to CSV ───────────────────────────────────────

export const exportTransactionsCSV = async (
  query: ParsedQs
): Promise<string> => {
  const filters = buildTransactionFilters(query);

  // For CSV export: get up to 10,000 records (no pagination)
  const transactions = await TransactionModel.find(filters)
    .sort({ processedAt: -1 })
    .limit(10000)
    .lean();

  const fields = [
    { label: 'Transaction ID', value: 'txnId' },
    { label: 'Date & Time', value: 'processedAt' },
    { label: 'Amount (INR)', value: 'amount' },
    { label: 'Currency', value: 'currency' },
    { label: 'Transaction Type', value: 'txnType' },
    { label: 'Channel', value: 'channel' },
    { label: 'Sender ID', value: 'senderId' },
    { label: 'Sender Name', value: 'senderName' },
    { label: 'Sender Bank', value: 'senderBank' },
    { label: 'Sender Country', value: 'senderCountry' },
    { label: 'Receiver ID', value: 'receiverId' },
    { label: 'Receiver Name', value: 'receiverName' },
    { label: 'Receiver Bank', value: 'receiverBank' },
    { label: 'Receiver Country', value: 'receiverCountry' },
    { label: 'Risk Score', value: 'riskScore' },
    { label: 'Risk Level', value: 'riskLevel' },
    { label: 'AML Flags', value: (row: Record<string, unknown>) =>
        (row.flags as string[])?.join(' | ') || '' },
    { label: 'Status', value: 'status' },
  ];

  const parser = new Parser({ fields });
  return parser.parse(transactions as unknown as Record<string, unknown>[]);
};

// ─── 6. Dashboard Stats (used by dashboard API later) ────────────────────

export const getTransactionStats = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [riskDistribution, statusDistribution, todayStats, totalCount] =
    await Promise.all([
      // Risk level breakdown
      TransactionModel.aggregate([
        { $group: { _id: '$riskLevel', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),

      // Status breakdown
      TransactionModel.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),

      // Today's numbers
      TransactionModel.aggregate([
        { $match: { processedAt: { $gte: today } } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            flagged: {
              $sum: {
                $cond: [{ $ne: ['$status', 'CLEAR'] }, 1, 0],
              },
            },
            totalAmount: { $sum: '$amount' },
          },
        },
      ]),

      // All time total
      TransactionModel.countDocuments(),
    ]);

  return {
    totalTransactions: totalCount,
    today: todayStats[0] || { total: 0, flagged: 0, totalAmount: 0 },
    riskDistribution,
    statusDistribution,
  };
};