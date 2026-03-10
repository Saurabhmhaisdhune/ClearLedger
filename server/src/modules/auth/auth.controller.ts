import { Request, Response } from 'express';
import { z } from 'zod';
import { UserModel } from '../../models/User.model';
import {
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  verifyAccessToken,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  isAccountLocked,
  handleFailedLogin,
  handleSuccessfulLogin,
} from './auth.service';
import { sendSuccess, sendError } from '../../utils/response';
import { asyncHandler } from '../../middleware/errorHandler';
import logger from '../../utils/logger';

// ─── Zod Validation Schemas ────────────────────────────────────────────────
const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

const registerSchema = z.object({
  firstName: z.string().min(2, 'First name must be at least 2 characters'),
  lastName: z.string().min(2, 'Last name must be at least 2 characters'),
  email: z.string().email('Invalid email format'),
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character'),
  role: z.enum(['ADMIN', 'COMPLIANCE_OFFICER', 'ANALYST', 'AUDITOR']),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .regex(/[A-Z]/, 'Must contain uppercase letter')
    .regex(/[a-z]/, 'Must contain lowercase letter')
    .regex(/[0-9]/, 'Must contain a number')
    .regex(/[^A-Za-z0-9]/, 'Must contain a special character'),
});

// ─── Controllers ───────────────────────────────────────────────────────────

// POST /api/v1/auth/register
// Creates first users. In production, lock this behind Admin role.
export const register = asyncHandler(async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, parsed.error.issues[0].message, 400, 'VALIDATION_ERROR');
  }

  const { firstName, lastName, email, password, role } = parsed.data;

  const existingUser = await UserModel.findOne({ email });
  if (existingUser) {
    return sendError(res, 'Email already registered', 409, 'EMAIL_EXISTS');
  }

  const passwordHash = await hashPassword(password);

  const user = await UserModel.create({
    firstName,
    lastName,
    email,
    passwordHash,
    role,
  });

  logger.info({ userId: user._id, email, role }, 'New user registered');

  return sendSuccess(res, { user }, 'User registered successfully', 201);
});

// POST /api/v1/auth/login
export const login = asyncHandler(async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, parsed.error.issues[0].message, 400, 'VALIDATION_ERROR');
  }

  const { email, password } = parsed.data;
  const userAgent = req.headers['user-agent'] || 'unknown';

  // Fetch user WITH passwordHash (select: false requires explicit select)
  const user = await UserModel.findOne({ email }).select('+passwordHash');
  if (!user) {
    // Vague error — do not reveal whether email exists
    return sendError(res, 'Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  if (!user.isActive) {
    return sendError(res, 'Account is deactivated. Contact your administrator.', 403, 'ACCOUNT_INACTIVE');
  }

  if (isAccountLocked(user)) {
    const minutesLeft = Math.ceil(
      ((user.lockedUntil?.getTime() ?? 0) - Date.now()) / 60000
    );
    return sendError(
      res,
      `Account locked due to too many failed attempts. Try again in ${minutesLeft} minutes.`,
      423,
      'ACCOUNT_LOCKED'
    );
  }

  const passwordValid = await verifyPassword(password, user.passwordHash);
  if (!passwordValid) {
    await handleFailedLogin(user);
    return sendError(res, 'Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  // Generate tokens
  const accessToken = generateAccessToken({
    userId: user._id.toString(),
    email: user.email,
    role: user.role,
  });

  const refreshToken = generateRefreshToken();

  // Save hashed refresh token to DB, update last login
  await handleSuccessfulLogin(user, refreshToken, userAgent);

  // Set refresh token as httpOnly cookie
  setRefreshTokenCookie(res, refreshToken.raw);

  logger.info({ userId: user._id, email, role: user.role }, 'User logged in');

  return sendSuccess(res, {
    accessToken,
    user: {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
    },
  }, 'Login successful');
});

// POST /api/v1/auth/refresh
export const refreshToken = asyncHandler(async (req: Request, res: Response) => {
  const rawToken = req.cookies?.refreshToken;
  if (!rawToken) {
    return sendError(res, 'Refresh token not found', 401, 'NO_REFRESH_TOKEN');
  }

  const hashedToken = hashRefreshToken(rawToken);

  // Find user who owns this refresh token
  const user = await UserModel.findOne({
    'refreshTokens.token': hashedToken,
    'refreshTokens.expiresAt': { $gt: new Date() },
  }).select('+refreshTokens');

  if (!user) {
    return sendError(res, 'Invalid or expired refresh token', 401, 'INVALID_REFRESH_TOKEN');
  }

  if (!user.isActive) {
    return sendError(res, 'Account deactivated', 403, 'ACCOUNT_INACTIVE');
  }

  // Rotate: remove old token, issue new one
  const newRefreshToken = generateRefreshToken();
  const userAgent = req.headers['user-agent'] || 'unknown';

  const updatedTokens = user.refreshTokens
    .filter((t) => t.token !== hashedToken && t.expiresAt > new Date())
    .concat({
      token: newRefreshToken.hashed,
      expiresAt: newRefreshToken.expiresAt,
      userAgent,
      createdAt: new Date(),
    });

  await UserModel.findByIdAndUpdate(user._id, { refreshTokens: updatedTokens });

  const accessToken = generateAccessToken({
    userId: user._id.toString(),
    email: user.email,
    role: user.role,
  });

  setRefreshTokenCookie(res, newRefreshToken.raw);

  return sendSuccess(res, { accessToken }, 'Token refreshed');
});

// POST /api/v1/auth/logout
export const logout = asyncHandler(async (req: Request, res: Response) => {
  const rawToken = req.cookies?.refreshToken;

  if (rawToken) {
    const hashedToken = hashRefreshToken(rawToken);
    // Remove only this device's refresh token
    await UserModel.findOneAndUpdate(
      { 'refreshTokens.token': hashedToken },
      { $pull: { refreshTokens: { token: hashedToken } } }
    );
  }

  clearRefreshTokenCookie(res);

  return sendSuccess(res, null, 'Logged out successfully');
});

// GET /api/v1/auth/me
export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const user = await UserModel.findById(req.user?.userId);
  if (!user) {
    return sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
  }
  return sendSuccess(res, { user });
});

// POST /api/v1/auth/change-password
export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, parsed.error.issues[0].message, 400, 'VALIDATION_ERROR');
  }

  const { currentPassword, newPassword } = parsed.data;

  const user = await UserModel.findById(req.user?.userId).select('+passwordHash');
  if (!user) {
    return sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
  }

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    return sendError(res, 'Current password is incorrect', 401, 'WRONG_PASSWORD');
  }

  const newHash = await hashPassword(newPassword);
  await UserModel.findByIdAndUpdate(user._id, { passwordHash: newHash });

  logger.info({ userId: user._id }, 'Password changed');

  return sendSuccess(res, null, 'Password changed successfully');
});