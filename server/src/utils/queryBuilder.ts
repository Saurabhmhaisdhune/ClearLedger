import { ParsedQs } from 'qs';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PaginationOptions {
  page: number;
  limit: number;
  skip: number;
}

export interface SortOptions {
  [key: string]: 1 | -1;
}

export interface TransactionFilters {
  riskLevel?: string | { $in: string[] };
  status?: string | { $in: string[] };
  txnType?: string | { $in: string[] };
  senderCountry?: string;
  receiverCountry?: string;
  senderId?: string;
  receiverId?: string;
  amount?: { $gte?: number; $lte?: number };
  processedAt?: { $gte?: Date; $lte?: Date };
  flags?: { $in: string[] };
  $or?: Array<{ [key: string]: unknown }>;
}

// ─── Pagination Parser ────────────────────────────────────────────────────

export const parsePagination = (
  query: ParsedQs
): PaginationOptions => {
  const page = Math.max(1, parseInt(query.page as string) || 1);
  const limit = Math.min(
    100, // Hard cap — never return more than 100 rows
    Math.max(1, parseInt(query.limit as string) || 25)
  );
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

// ─── Sort Parser ──────────────────────────────────────────────────────────

export const parseSort = (
  query: ParsedQs,
  allowedFields: string[],
  defaultField = 'processedAt',
  defaultOrder: 1 | -1 = -1
): SortOptions => {
  const sortBy = query.sortBy as string;
  const sortOrder = query.sortOrder === 'asc' ? 1 : -1;

  if (sortBy && allowedFields.includes(sortBy)) {
    return { [sortBy]: sortOrder };
  }

  return { [defaultField]: defaultOrder };
};

// ─── Transaction Filter Builder ───────────────────────────────────────────
// Converts raw query params into a clean MongoDB $match stage

export const buildTransactionFilters = (
  query: ParsedQs
): TransactionFilters => {
  const filters: TransactionFilters = {};

  // ── Risk Level (single or comma-separated) ──────────────────────────────
  // ?riskLevel=HIGH  OR  ?riskLevel=HIGH,CRITICAL
  if (query.riskLevel) {
    const levels = (query.riskLevel as string).split(',').map((l) => l.trim().toUpperCase());
    filters.riskLevel = levels.length === 1 ? levels[0] : { $in: levels };
  }

  // ── Status (single or comma-separated) ─────────────────────────────────
  if (query.status) {
    const statuses = (query.status as string).split(',').map((s) => s.trim().toUpperCase());
    filters.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
  }

  // ── Transaction Type ────────────────────────────────────────────────────
  if (query.txnType) {
    const types = (query.txnType as string).split(',').map((t) => t.trim().toUpperCase());
    filters.txnType = types.length === 1 ? types[0] : { $in: types };
  }

  // ── Country Filters ─────────────────────────────────────────────────────
  if (query.senderCountry) {
    filters.senderCountry = (query.senderCountry as string).toUpperCase();
  }
  if (query.receiverCountry) {
    filters.receiverCountry = (query.receiverCountry as string).toUpperCase();
  }

  // ── Account ID Search ───────────────────────────────────────────────────
  if (query.senderId) {
    filters.senderId = query.senderId as string;
  }
  if (query.receiverId) {
    filters.receiverId = query.receiverId as string;
  }

  // ── Amount Range ────────────────────────────────────────────────────────
  // ?minAmount=100000&maxAmount=1000000
  if (query.minAmount || query.maxAmount) {
    filters.amount = {};
    if (query.minAmount) {
      filters.amount.$gte = parseFloat(query.minAmount as string);
    }
    if (query.maxAmount) {
      filters.amount.$lte = parseFloat(query.maxAmount as string);
    }
  }

  // ── Date Range ───────────────────────────────────────────────────────────
  // ?startDate=2025-01-01&endDate=2025-12-31
  if (query.startDate || query.endDate) {
    filters.processedAt = {};
    if (query.startDate) {
      filters.processedAt.$gte = new Date(query.startDate as string);
    }
    if (query.endDate) {
      // End of the day for the endDate
      const end = new Date(query.endDate as string);
      end.setHours(23, 59, 59, 999);
      filters.processedAt.$lte = end;
    }
  }

  // ── AML Flag Filter ──────────────────────────────────────────────────────
  // ?flag=SANCTIONED_COUNTRY
  if (query.flag) {
    const flags = (query.flag as string).split(',').map((f) => f.trim());
    filters.flags = { $in: flags };
  }

  // ── Global Search (txnId, senderName, receiverName) ─────────────────────
  // ?search=TXN-000123  OR  ?search=John
  if (query.search) {
    const searchRegex = new RegExp(query.search as string, 'i');
    filters.$or = [
      { txnId: searchRegex },
      { senderName: searchRegex },
      { receiverName: searchRegex },
      { senderId: searchRegex },
      { receiverId: searchRegex },
    ];
  }

  return filters;
};

// ─── Meta Builder (for API response) ─────────────────────────────────────

export const buildMeta = (
  total: number,
  page: number,
  limit: number
) => ({
  total,
  page,
  limit,
  totalPages: Math.ceil(total / limit),
  hasNextPage: page * limit < total,
  hasPrevPage: page > 1,
});