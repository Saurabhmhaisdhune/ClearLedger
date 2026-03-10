import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { UserModel, IUser } from '../../models/User.model';
import { sendError } from '../../utils/response';
import { Response } from 'express';

const SALT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const MAX_REFRESH_TOKENS = 3; // Max concurrent sessions per user

// ─── Password Helpers ──────────────────────────────────────────────────────
export const hashPassword = async (plainText: string): Promise<string> => {
  return bcrypt.hash(plainText, SALT_ROUNDS);
};

export const verifyPassword = async (
  plainText: string,
  hash: string
): Promise<boolean> => {
  return bcrypt.compare(plainText, hash);
};

// ─── Token Helpers ─────────────────────────────────────────────────────────
export interface AccessTokenPayload {
  userId: string;
  email: string;
  role: string;
}

export const generateAccessToken = (payload: AccessTokenPayload): string => {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET as string, {
    expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m',
  } as jwt.SignOptions);
};

export const verifyAccessToken = (token: string): AccessTokenPayload => {
  return jwt.verify(
    token,
    process.env.JWT_ACCESS_SECRET as string
  ) as AccessTokenPayload;
};

// Refresh token = random UUID, stored as SHA-256 hash in DB
export const generateRefreshToken = (): {
  raw: string;
  hashed: string;
  expiresAt: Date;
} => {
  const raw = crypto.randomUUID();
  const hashed = crypto.createHash('sha256').update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  return { raw, hashed, expiresAt };
};

export const hashRefreshToken = (raw: string): string => {
  return crypto.createHash('sha256').update(raw).digest('hex');
};

// ─── Cookie Helper ─────────────────────────────────────────────────────────
export const setRefreshTokenCookie = (res: Response, token: string): void => {
  res.cookie('refreshToken', token, {
    httpOnly: true,           // Not accessible via JavaScript
    secure: process.env.NODE_ENV === 'production', // HTTPS only in prod
    sameSite: 'strict',       // CSRF protection
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    path: '/api/v1/auth',     // Only sent to auth endpoints
  });
};

export const clearRefreshTokenCookie = (res: Response): void => {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/v1/auth',
  });
};

// ─── Account Lock Helpers ─────────────────────────────────────────────────
export const isAccountLocked = (user: IUser): boolean => {
  if (!user.lockedUntil) return false;
  if (user.lockedUntil > new Date()) return true;
  return false;
};

export const handleFailedLogin = async (user: IUser): Promise<void> => {
  const attempts = user.failedLoginAttempts + 1;
  const update: Partial<IUser> = { failedLoginAttempts: attempts } as Partial<IUser>;

  if (attempts >= MAX_FAILED_ATTEMPTS) {
    (update as Record<string, unknown>).lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
    (update as Record<string, unknown>).failedLoginAttempts = 0;
  }

  await UserModel.findByIdAndUpdate(user._id, update);
};

export const handleSuccessfulLogin = async (
  user: IUser,
  refreshToken: { hashed: string; expiresAt: Date },
  userAgent: string
): Promise<void> => {
  // Fetch with refreshTokens (select: false field)
  const userWithTokens = await UserModel.findById(user._id).select('+refreshTokens');
  if (!userWithTokens) return;

  // Keep only the latest MAX_REFRESH_TOKENS - 1 tokens, add new one
  const tokens = userWithTokens.refreshTokens
    .filter((t) => t.expiresAt > new Date()) // Remove expired
    .slice(-(MAX_REFRESH_TOKENS - 1));       // Keep most recent

  tokens.push({
    token: refreshToken.hashed,
    expiresAt: refreshToken.expiresAt,
    userAgent,
    createdAt: new Date(),
  });

  await UserModel.findByIdAndUpdate(user._id, {
    refreshTokens: tokens,
    lastLogin: new Date(),
    failedLoginAttempts: 0,
    lockedUntil: undefined,
  });
};