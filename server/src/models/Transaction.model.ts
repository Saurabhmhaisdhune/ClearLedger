import mongoose, { Document, Schema } from 'mongoose';
import {
  RISK_LEVELS,
  TRANSACTION_STATUS,
  RiskLevel,
} from '../utils/constants';

export interface ITransaction extends Document {
  _id: mongoose.Types.ObjectId;
  txnId: string;
  amount: number;
  currency: string;
  senderId: string;
  senderName: string;
  senderBank: string;
  senderCountry: string;
  receiverId: string;
  receiverName: string;
  receiverBank: string;
  receiverCountry: string;
  txnType: 'WIRE' | 'ACH' | 'SWIFT' | 'INTERNAL' | 'CASH';
  channel: 'ONLINE' | 'BRANCH' | 'ATM' | 'MOBILE';
  riskScore: number;
  riskLevel: RiskLevel;
  flags: string[];
  status: keyof typeof TRANSACTION_STATUS;
  linkedCaseId?: mongoose.Types.ObjectId;
  reviewedBy?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  processedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    txnId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR', uppercase: true },
    senderId: { type: String, required: true },
    senderName: { type: String, required: true },
    senderBank: { type: String, required: true },
    senderCountry: { type: String, required: true, uppercase: true },
    receiverId: { type: String, required: true },
    receiverName: { type: String, required: true },
    receiverBank: { type: String, required: true },
    receiverCountry: { type: String, required: true, uppercase: true },
  txnType: {
  type: String,
  enum: ['RTGS', 'NEFT', 'IMPS', 'SWIFT', 'CASH'],
  required: true,
},
    channel: {
      type: String,
      enum: ['ONLINE', 'BRANCH', 'ATM', 'MOBILE'],
      required: true,
    },
    riskScore: { type: Number, default: 0, min: 0, max: 150 },
    riskLevel: {
      type: String,
      enum: Object.values(RISK_LEVELS),
      default: RISK_LEVELS.LOW,
    },
    flags: [{ type: String }],
    status: {
      type: String,
      enum: Object.values(TRANSACTION_STATUS),
      default: TRANSACTION_STATUS.CLEAR,
    },
    linkedCaseId: {
      type: Schema.Types.ObjectId,
      ref: 'Case',
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    reviewedAt: { type: Date },
    processedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// ─── Compound Indexes ──────────────────────────────────────────────────────
// These are what make server-side pagination fast at 100k+ records

// Primary query pattern: list view sorted by date with filters
TransactionSchema.index({ processedAt: -1, riskLevel: 1, status: 1 });

// Velocity rule check: find all txns by sender in last 24hrs
TransactionSchema.index({ senderId: 1, processedAt: -1 });

// Dashboard aggregations by date
TransactionSchema.index({ processedAt: -1 });

// Filter by status + riskLevel (common compliance officer query)
TransactionSchema.index({ status: 1, riskLevel: 1 });

export const TransactionModel = mongoose.model<ITransaction>(
  'Transaction',
  TransactionSchema
);