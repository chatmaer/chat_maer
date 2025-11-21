import express from "express";
import { v4 as uuidv4 } from "uuid";
import { query } from "../db/connection.js";
import logger from "../lib/logger.js";
import { generateToken } from "../utils/jwt.js";
import { checkAndAutoBanUser } from "../utils/banManager.js";
import passport from "passport";

const router = express.Router();

// Google OAuth middleware
const googleOauth = async (req: express.Request, res: express.Response) => {
  if (!req.user) {
    return res.status(400).json({ error: "Authentication failed!" });
  }

  const user = req.user as {
    id: string;
    email: string;
    username: string;
    user_type: string;
  };

  try {
    // Check and auto-ban if user has 5+ reports
    const isBanned = await checkAndAutoBanUser(user.id);
    if (isBanned) {
      return res.status(403).json({
        error: "Account is banned",
        banned: true,
      });
    }

    // Generate JWT token
    const token = generateToken({
      userId: user.id,
      username: user.username,
      userType: user.user_type,
    });

    return res.status(200).json({
      token,
      userId: user.id,
      username: user.username,
      userType: user.user_type,
      email: user.email,
      user,
    });
  } catch (err: any) {
    logger.error(err, "Error creating token");
    return res.status(500).json({ error: "Failed to create token" });
  }
};

// Simple username-based login
router.post("/login", async (req, res) => {
  try {
    const { username, type } = req.body;

    if (!username || typeof username !== "string") {
      return res.status(400).json({ error: "Username is required" });
    }

    const trimmedUsername = username.trim();
    const userType = type === "admin" ? "admin" : "user";

    // Validate username
    if (trimmedUsername.length < 3 || trimmedUsername.length > 20) {
      return res.status(400).json({
        error: "Username must be between 3 and 20 characters",
      });
    }

    // Check if username contains only allowed characters (alphanumeric, underscore, hyphen)
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedUsername)) {
      return res.status(400).json({
        error: "Username can only contain letters, numbers, underscores, and hyphens",
      });
    }

    // Check if user exists by username
    const existingUser = (await query(
      "SELECT id, username, is_banned, user_type FROM users WHERE username = ?",
      [trimmedUsername]
    )) as Array<{
      id: string;
      username: string;
      is_banned: boolean;
      user_type: string;
    }>;

    let userId: string;
    let finalUserType: string = userType;

    if (existingUser.length > 0) {
      userId = existingUser[0].id;
      finalUserType = existingUser[0].user_type; // Keep existing user type

      // Check and auto-ban if user has 5+ reports
      const isBanned = await checkAndAutoBanUser(userId);
      if (isBanned) {
        return res.status(403).json({
          error: "Account is banned",
          banned: true,
        });
      }

      // If trying to login as admin but user is not admin, deny access
      if (userType === "admin" && existingUser[0].user_type !== "admin") {
        return res.status(403).json({
          error: "Admin access denied",
        });
      }
    } else {
      // Create new user
      userId = uuidv4();
      await query(
        `INSERT INTO users (id, username, username_set, user_type)
         VALUES (?, ?, ?, ?)`,
        [userId, trimmedUsername, true, finalUserType]
      );
    }

    // Generate JWT token
    const token = generateToken({
      userId,
      username: trimmedUsername,
      userType: finalUserType,
    });

    res.json({
      userId,
      username: trimmedUsername,
      userType: finalUserType,
      token, // Include token in response
    });
  } catch (error) {
    logger.error(error, "Error in login");
    res.status(500).json({ error: "Authentication failed" });
  }
});

// Verify token endpoint
router.post("/verify", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: "Token is required" });
    }

    const { verifyToken } = await import("../utils/jwt.js");
    const payload = verifyToken(token);

    if (!payload) {
      return res.status(401).json({ error: "Invalid or expired token" });
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
      return res.status(401).json({ error: "User not found" });
    }

    // Check and auto-ban if user has 5+ reports
    const isBanned = await checkAndAutoBanUser(payload.userId);
    if (isBanned) {
      return res.status(403).json({ error: "Account is banned", banned: true });
    }

    res.json({
      userId: payload.userId,
      username: payload.username,
      userType: payload.userType,
      valid: true,
    });
  } catch (error) {
    logger.error(error, "Error verifying token");
    res.status(500).json({ error: "Token verification failed" });
  }
});

// Set display username (second step username for rooms/chatting)
router.post("/set-username", async (req, res) => {
  try {
    const { userId, username } = req.body;

    if (!userId || !username || typeof username !== "string") {
      return res.status(400).json({ error: "UserId and username are required" });
    }

    const trimmedUsername = username.trim();

    // Validate username
    if (trimmedUsername.length < 3 || trimmedUsername.length > 20) {
      return res.status(400).json({
        error: "Username must be between 3 and 20 characters",
      });
    }

    // Check if username contains only allowed characters (alphanumeric, underscore, hyphen)
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedUsername)) {
      return res.status(400).json({
        error: "Username can only contain letters, numbers, underscores, and hyphens",
      });
    }

    // Check if user exists
    const existingUser = (await query(
      "SELECT id, is_banned FROM users WHERE id = ?",
      [userId]
    )) as Array<{
      id: string;
      is_banned: boolean;
    }>;

    if (existingUser.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check and auto-ban if user has 5+ reports
    const isBanned = await checkAndAutoBanUser(userId);
    if (isBanned) {
      return res.status(403).json({
        error: "Account is banned",
        banned: true,
      });
    }

    // Update display_username
    await query(
      "UPDATE users SET display_username = ? WHERE id = ?",
      [trimmedUsername, userId]
    );

    res.json({
      success: true,
      displayUsername: trimmedUsername,
    });
  } catch (error) {
    logger.error(error, "Error setting display username");
    res.status(500).json({ error: "Failed to set display username" });
  }
});

// Check if user is banned
router.get("/check-ban/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const user = (await query(
      "SELECT is_banned, banned_at, ban_reason FROM users WHERE id = ?",
      [userId]
    )) as Array<{
      is_banned: boolean;
      banned_at: Date | null;
      ban_reason: string | null;
    }>;

    if (user.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      isBanned: user[0].is_banned,
      bannedAt: user[0].banned_at,
      banReason: user[0].ban_reason,
    });
  } catch (error) {
    logger.error(error, "Error checking ban status");
    res.status(500).json({ error: "Failed to check ban status" });
  }
});

// Google OAuth login endpoint
router.post(
  "/google",
  (req, res, next) => {
    passport.authenticate("google-token", { session: false }, (err: Error | null, user: any, info: any) => {
      if (err) {
        // Handle authentication errors (including banned users)
        if (err.message === "Account is banned") {
          return res.status(403).json({
            error: "Account is banned",
            banned: true,
          });
        }
        return res.status(400).json({ error: err.message || "Authentication failed!" });
      }
      if (!user) {
        return res.status(400).json({ error: "Authentication failed!" });
      }
      // Attach user to request and continue
      req.user = user;
      next();
    })(req, res, next);
  },
  googleOauth,
);

export default router;

