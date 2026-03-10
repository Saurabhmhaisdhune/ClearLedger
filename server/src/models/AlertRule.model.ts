import mongoose, { Document, Schema } from 'mongoose';

export interface IAlertRule extends Document {
  _id: mongoose.Types.ObjectId;
  ruleCode: string;
  ruleName: string;
  description: string;
  category: 'AMOUNT' | 'VELOCITY' | 'GEOGRAPHY' | 'PATTERN';
  threshold: number;
  riskWeight: number;
  isActive: boolean;
  lastModifiedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AlertRuleSchema = new Schema<IAlertRule>(
  {
    ruleCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    ruleName: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    category: {
      type: String,
      enum: ['AMOUNT', 'VELOCITY', 'GEOGRAPHY', 'PATTERN'],
      required: true,
    },
    threshold: {
      type: Number,
      required: true,
      min: 0,
    },
    riskWeight: {
      type: Number,
      required: true,
      min: 1,
      max: 100,
    },
    isActive: { type: Boolean, default: true },
    lastModifiedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

export const AlertRuleModel = mongoose.model<IAlertRule>(
  'AlertRule',
  AlertRuleSchema
);