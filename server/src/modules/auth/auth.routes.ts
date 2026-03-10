import { Router } from 'express';
import {
  register,
  login,
  refreshToken,
  logout,
  getMe,
  changePassword,
} from './auth.controller';
import { protect } from '../../middleware/auth';

const router = Router();

// Public routes
router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refreshToken);
router.post('/logout', logout);

// Protected routes — require valid access token
router.get('/me', protect, getMe);
router.post('/change-password', protect, changePassword);

export default router;