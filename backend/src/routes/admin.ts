import express from "express";
import { query } from "../db/connection.js";
import logger from "../lib/logger.js";
import { authenticateToken, requireAdmin, AuthRequest } from "../middleware/auth.js";

const router = express.Router();

// Use JWT authentication middleware for all admin routes
router.use(authenticateToken);
router.use(requireAdmin);

// Get all users with pagination
router.post("/users", async (req: AuthRequest, res) => {
  try {
    const { page = 1, limit = 50, search = "" } = req.body;
    const offset = (page - 1) * limit;

    let sql = `
      SELECT id, username, balance, coins, user_type, is_banned, banned_at, ban_reason, 
             report_count, created_at, pix_key
      FROM users
    `;
    const params: Array<string | number> = [];

    if (search) {
      sql += ` WHERE username LIKE ? OR id LIKE ?`;
      params.push(`%${search}%`, `%${search}%`);
    }

    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const users = (await query(sql, params)) as Array<{
      id: string;
      username: string;
      balance: number;
      coins: number;
      user_type: string;
      is_banned: boolean;
      banned_at: Date | null;
      ban_reason: string | null;
      report_count: number;
      created_at: Date;
      pix_key: string | null;
    }>;

    // Get total count
    let countSql = "SELECT COUNT(*) as total FROM users";
    const countParams: Array<string> = [];
    if (search) {
      countSql += " WHERE username LIKE ? OR id LIKE ?";
      countParams.push(`%${search}%`, `%${search}%`);
    }

    const countResult = (await query(countSql, countParams)) as Array<{
      total: number;
    }>;
    const total = countResult[0]?.total || 0;

    res.json({
      users: users.map((u) => ({
        id: u.id,
        username: u.username,
        balance: typeof u.balance === 'number' 
          ? u.balance 
          : (u.balance ? Number(u.balance) : 0),
        coins: u.coins,
        userType: u.user_type,
        isBanned: u.is_banned,
        bannedAt: u.banned_at,
        banReason: u.ban_reason,
        reportCount: u.report_count,
        createdAt: u.created_at,
        pixKey: u.pix_key ? u.pix_key.replace(/(.{4})(.*)(.{4})/, "$1****$3") : null,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error(error, "Error fetching users");
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// Ban user
router.post("/users/ban", async (req: AuthRequest, res) => {
  try {
    const { targetUserId, banReason } = req.body;

    if (!targetUserId) {
      return res.status(400).json({ error: "Target user ID required" });
    }

    await query(
      `UPDATE users 
       SET is_banned = TRUE, banned_at = NOW(), ban_reason = ?
       WHERE id = ?`,
      [banReason || "Banned by admin", targetUserId],
    );

    logger.info(`User ${targetUserId} banned by admin. Reason: ${banReason || "No reason provided"}`);

    res.json({ message: "User banned successfully" });
  } catch (error) {
    logger.error(error, "Error banning user");
    res.status(500).json({ error: "Failed to ban user" });
  }
});

// Unban user
router.post("/users/unban", async (req: AuthRequest, res) => {
  try {
    const { targetUserId } = req.body;

    if (!targetUserId) {
      return res.status(400).json({ error: "Target user ID required" });
    }

    await query(
      `UPDATE users 
       SET is_banned = FALSE, banned_at = NULL, ban_reason = NULL
       WHERE id = ?`,
      [targetUserId],
    );

    logger.info(`User ${targetUserId} unbanned by admin`);

    res.json({ message: "User unbanned successfully" });
  } catch (error) {
    logger.error(error, "Error unbanning user");
    res.status(500).json({ error: "Failed to unban user" });
  }
});

// Update user balance
router.post("/users/balance", async (req: AuthRequest, res) => {
  try {
    const { targetUserId, balance } = req.body;

    if (!targetUserId || balance === undefined) {
      return res.status(400).json({ error: "Target user ID and balance required" });
    }

    if (balance < 0) {
      return res.status(400).json({ error: "Balance cannot be negative" });
    }

    await query("UPDATE users SET balance = ? WHERE id = ?", [balance, targetUserId]);

    logger.info(`Admin updated balance for user ${targetUserId} to ${balance}`);

    res.json({ message: "Balance updated successfully" });
  } catch (error) {
    logger.error(error, "Error updating user balance");
    res.status(500).json({ error: "Failed to update balance" });
  }
});

// Get user reports
router.post("/reports", async (req: AuthRequest, res) => {
  try {
    const { page = 1, limit = 50 } = req.body;
    const offset = (page - 1) * limit;

    const reports = (await query(
      `SELECT r.id, r.reported_user_id, r.reporter_user_id, r.room_id, r.reason, r.created_at,
              u1.username as reported_username,
              u2.username as reporter_username
       FROM reports r
       JOIN users u1 ON r.reported_user_id = u1.id
       JOIN users u2 ON r.reporter_user_id = u2.id
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset],
    )) as Array<{
      id: string;
      reported_user_id: string;
      reporter_user_id: string;
      room_id: string | null;
      reason: string;
      created_at: Date;
      reported_username: string;
      reporter_username: string;
    }>;

    const countResult = (await query(
      "SELECT COUNT(*) as total FROM reports",
    )) as Array<{ total: number }>;
    const total = countResult[0]?.total || 0;

    res.json({
      reports: reports.map((r) => ({
        id: r.id,
        reportedUserId: r.reported_user_id,
        reportedUsername: r.reported_username,
        reporterUserId: r.reporter_user_id,
        reporterUsername: r.reporter_username,
        roomId: r.room_id,
        reason: r.reason,
        createdAt: r.created_at,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error(error, "Error fetching reports");
    res.status(500).json({ error: "Failed to fetch reports" });
  }
});

// Get statistics
router.post("/stats", async (req: AuthRequest, res) => {
  try {
    const totalUsers = (await query(
      "SELECT COUNT(*) as total FROM users",
    )) as Array<{ total: number }>;

    const totalBanned = (await query(
      "SELECT COUNT(*) as total FROM users WHERE is_banned = TRUE",
    )) as Array<{ total: number }>;

    const totalReports = (await query(
      "SELECT COUNT(*) as total FROM reports",
    )) as Array<{ total: number }>;

    const totalRooms = (await query(
      "SELECT COUNT(*) as total FROM rooms",
    )) as Array<{ total: number }>;

    const totalMatches = (await query(
      "SELECT COUNT(*) as total FROM matches",
    )) as Array<{ total: number }>;

    const totalBalance = (await query(
      "SELECT SUM(balance) as total FROM users",
    )) as Array<{ total: number | null }>;

    const activeRooms = (await query(
      "SELECT COUNT(*) as total FROM rooms WHERE status = 'playing'",
    )) as Array<{ total: number }>;

    // Convert balance total to number (MySQL DECIMAL returns as string)
    const balanceTotal = totalBalance[0]?.total 
      ? (typeof totalBalance[0].total === 'string' 
          ? parseFloat(totalBalance[0].total) 
          : Number(totalBalance[0].total)) 
      : 0;

    res.json({
      users: {
        total: totalUsers[0]?.total || 0,
        banned: totalBanned[0]?.total || 0,
        active: (totalUsers[0]?.total || 0) - (totalBanned[0]?.total || 0),
      },
      reports: {
        total: totalReports[0]?.total || 0,
      },
      rooms: {
        total: totalRooms[0]?.total || 0,
        active: activeRooms[0]?.total || 0,
      },
      matches: {
        total: totalMatches[0]?.total || 0,
      },
      balance: {
        total: balanceTotal,
      },
    });
  } catch (error) {
    logger.error(error, "Error fetching statistics");
    res.status(500).json({ error: "Failed to fetch statistics" });
  }
});

export default router;

