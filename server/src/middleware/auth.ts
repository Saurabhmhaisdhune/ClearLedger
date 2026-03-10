import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../modules/auth/auth.service';
import { sendError } from '../utils/response';
import { Role } from '../utils/constants';

// Protect — verifies JWT and attaches user to req.user
export const protect = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    sendError(res, 'Access token required', 401, 'NO_TOKEN');
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyAccessToken(token);
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role as Role,
    };
    next();
  } catch {
    sendError(res, 'Invalid or expired access token', 401, 'INVALID_TOKEN');
  }
};

// Authorize — checks role after protect middleware
export const authorize = (...roles: Role[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendError(res, 'Not authenticated', 401, 'NOT_AUTHENTICATED');
      return;
    }

    if (!roles.includes(req.user.role)) {
      sendError(
        res,
        `Access denied. Required role: ${roles.join(' or ')}`,
        403,
        'FORBIDDEN'
      );
      return;
    }

    next();
  };
};