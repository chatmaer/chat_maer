import { Request, Response, NextFunction } from "express";
import { verifyToken, extractTokenFromHeader } from "../utils/jwt.js";
import { query } from "../db/connection.js";
import logger from "../lib/logger.js";
import { checkAndAutoBanUser } from "../utils/banManager.js";

// Extend Express Request to include user info
export interface AuthRequest extends Request {
  userId?: string;
  username?: string;
  userType?: string;
}

/**
 * Middleware to verify JWT token and attach user info to request
 */
export const authenticateToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    // Try to get token from Authorization header or query/body
    const authHeader = req.headers.authorization;
    const token = extractTokenFromHeader(authHeader) || req.query.token || req.body.token;

    if (!token) {
      res.status(401).json({ error: "Authentication token required" });
      return;
    }

    // Verify token
    const payload = verifyToken(token as string);
    if (!payload) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    // Verify user still exists and is not banned
    const user = (await query(
      "SELECT id, username, is_banned, user_type FROM users WHERE id = ?",
      [payload.userId],
    )) as Array<{
      id: string;
      username: string;
      is_banned: boolean;
      user_type: string;
    }>;

    if (user.length === 0) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    // Check and auto-ban if user has 5+ reports
    const isBanned = await checkAndAutoBanUser(payload.userId);
    if (isBanned) {
      res.status(403).json({ error: "Account is banned" });
      return;
    }

    // Attach user info to request
    req.userId = payload.userId;
    req.username = payload.username;
    req.userType = payload.userType;

    next();
  } catch (error) {
    logger.error(error, "Error in authenticateToken middleware");
    res.status(500).json({ error: "Authentication failed" });
  }
};

/**
 * Middleware to verify admin access
 */
export const requireAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void => {
  if (req.userType !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
};

