import mongoose, { Document, Schema } from 'mongoose';
import { ROLES, Role } from '../utils/constants';

export interface IRefreshToken {
  token: string;        // Stored as SHA-256 hash, not plain text
  expiresAt: Date;
  userAgent: string;
  createdAt: Date;
}

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  role: Role;
  isActive: boolean;
  lastLogin?: Date;
  failedLoginAttempts: number;
  lockedUntil?: Date;
  refreshTokens: IRefreshToken[];
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  fullName: string; // virtual
}

const RefreshTokenSchema = new Schema<IRefreshToken>(
  {
    token: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    userAgent: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const UserSchema = new Schema<IUser>(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false, // Never returned in queries unless explicitly requested
    },
    role: {
      type: String,
      enum: Object.values(ROLES),
      required: true,
    },
    isActive: { type: Boolean, default: true },
    lastLogin: { type: Date },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date },
    refreshTokens: {
      type: [RefreshTokenSchema],
      default: [],
      select: false, // Never returned unless explicitly requested
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: any) => {
        delete ret.passwordHash;
        delete ret.refreshTokens;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Virtual — combines firstName + lastName
UserSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Index for fast email lookups during login
// UserSchema.index({ email: 1 });

export const UserModel = mongoose.model<IUser>('User', UserSchema);