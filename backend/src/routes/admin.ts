import express from "express";
import { query } from "../db/connection.js";
import logger from "../lib/logger.js";
import { authenticateToken, requireAdmin, AuthRequest } from "../middleware/auth.js";
import { getUserBalance, updateUserBalance } from "../utils/roomManager.js";

const router = express.Router();

// Use JWT authentication middleware for all admin routes
router.use(authenticateToken);
router.use(requireAdmin);

// Get all users with pagination
router.post("/users", async (req: AuthRequest, res) => {
  try {
    logger.info({ userId: req.userId, userType: req.userType, body: req.body }, "Admin users request received");
    
    const { page = 1, limit = 50, search = "" } = req.body;
    // Ensure page and limit are numbers
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 50;
    const offset = (pageNum - 1) * limitNum;

    let sql = `
      SELECT id, username, balance, coins, user_type, is_banned, banned_at, ban_reason, 
             report_count, created_at, pix_key
      FROM users
    `;
    const params: Array<string | number> = [];

    if (search && typeof search === 'string' && search.trim()) {
      sql += ` WHERE username LIKE ? OR id LIKE ?`;
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    // Use template literals for LIMIT and OFFSET instead of parameters
    // Some MySQL versions/drivers don't support parameterized LIMIT/OFFSET properly
    // Ensure values are integers to prevent SQL injection
    const safeLimit = Math.max(1, Math.min(limitNum, 1000)); // Cap at 1000 for safety
    const safeOffset = Math.max(0, offset);
    sql += ` ORDER BY created_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`;

    logger.info({ sql, params: params.map(p => typeof p === 'string' ? p.substring(0, 50) : p) }, "Executing users query");

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

    logger.info({ userCount: users.length }, "Users query successful");

    // Get total count
    let countSql = "SELECT COUNT(*) as total FROM users";
    const countParams: Array<string> = [];
    if (search && typeof search === 'string' && search.trim()) {
      countSql += " WHERE username LIKE ? OR id LIKE ?";
      countParams.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }
    
    logger.info({ countSql, countParams }, "Executing count query");

    const countResult = (await query(countSql, countParams)) as Array<{
      total: number;
    }>;
    const total = countResult[0]?.total || 0;
    
    logger.info({ total }, "Count query successful");

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
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    logger.error({ 
      error: errorMessage, 
      stack: errorStack,
      userId: req.userId,
      userType: req.userType 
    }, "Error fetching users - full details");
    
    // Always return error details in development, and in production for admin debugging
    res.status(500).json({ 
      error: "Failed to fetch users",
      message: errorMessage,
      ...(process.env.NODE_ENV === "development" || req.userType === "admin" ? { 
        details: errorMessage,
        stack: errorStack 
      } : {})
    });
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
    // Ensure page and limit are numbers
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 50;
    const offset = (pageNum - 1) * limitNum;
    
    // Use template literals for LIMIT and OFFSET instead of parameters
    const safeLimit = Math.max(1, Math.min(limitNum, 1000));
    const safeOffset = Math.max(0, offset);

    const reports = (await query(
      `SELECT r.id, r.reported_user_id, r.reporter_user_id, r.room_id, r.reason, r.created_at,
              u1.username as reported_username,
              u2.username as reporter_username
       FROM reports r
       JOIN users u1 ON r.reported_user_id = u1.id
       JOIN users u2 ON r.reporter_user_id = u2.id
       ORDER BY r.created_at DESC
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      [],
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
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
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

// Get pending withdrawal requests
router.post("/withdrawals", async (req: AuthRequest, res) => {
  try {
    const { page = 1, limit = 50, status = "pending" } = req.body;
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 50;
    const offset = (pageNum - 1) * limitNum;

    const safeLimit = Math.max(1, Math.min(limitNum, 1000));
    const safeOffset = Math.max(0, offset);

    // Get withdrawal requests with user information
    const withdrawals = (await query(
      `SELECT pt.id, pt.user_id, pt.amount, pt.status, pt.pix_key, pt.balance_before, 
              pt.balance_after, pt.error_message, pt.created_at, pt.updated_at,
              u.username, u.balance as current_balance
       FROM pix_transactions pt
       JOIN users u ON pt.user_id = u.id
       WHERE pt.transaction_type = 'withdrawal' 
       ${status !== "all" ? "AND pt.status = ?" : ""}
       ORDER BY pt.created_at DESC
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      status !== "all" ? [status] : [],
    )) as Array<{
      id: string;
      user_id: string;
      amount: number | string;
      status: string;
      pix_key: string | null;
      balance_before: number | string | null;
      balance_after: number | string | null;
      error_message: string | null;
      created_at: Date;
      updated_at: Date;
      username: string;
      current_balance: number | string;
    }>;

    // Get total count
    const countResult = (await query(
      `SELECT COUNT(*) as total 
       FROM pix_transactions 
       WHERE transaction_type = 'withdrawal' 
       ${status !== "all" ? "AND status = ?" : ""}`,
      status !== "all" ? [status] : [],
    )) as Array<{ total: number }>;
    const total = countResult[0]?.total || 0;

    res.json({
      withdrawals: withdrawals.map((w) => ({
        id: w.id,
        userId: w.user_id,
        username: w.username,
        amount: typeof w.amount === "number" ? w.amount : Number(w.amount || 0),
        status: w.status,
        pixKey: w.pix_key, // Admin can see full Pix key
        balanceBefore: typeof w.balance_before === "number" 
          ? w.balance_before 
          : (w.balance_before ? Number(w.balance_before) : null),
        balanceAfter: typeof w.balance_after === "number" 
          ? w.balance_after 
          : (w.balance_after ? Number(w.balance_after) : null),
        currentBalance: typeof w.current_balance === "number" 
          ? w.current_balance 
          : Number(w.current_balance || 0),
        errorMessage: w.error_message,
        createdAt: w.created_at,
        updatedAt: w.updated_at,
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    logger.error(error, "Error fetching withdrawal requests");
    res.status(500).json({ error: "Failed to fetch withdrawal requests" });
  }
});

// Approve withdrawal request
router.post("/withdrawals/approve", async (req: AuthRequest, res) => {
  try {
    const { transactionId } = req.body;

    if (!transactionId) {
      return res.status(400).json({ error: "Transaction ID is required" });
    }

    // Get transaction details
    const transaction = (await query(
      `SELECT id, user_id, amount, status, balance_before, pix_key
       FROM pix_transactions 
       WHERE id = ? AND transaction_type = 'withdrawal'`,
      [transactionId],
    )) as Array<{
      id: string;
      user_id: string;
      amount: number | string;
      status: string;
      balance_before: number | string | null;
      pix_key: string | null;
    }>;

    if (transaction.length === 0) {
      return res.status(404).json({ error: "Withdrawal request not found" });
    }

    const tx = transaction[0];

    // Check if already processed
    if (tx.status !== "pending") {
      return res.status(400).json({ 
        error: `Withdrawal request is already ${tx.status}`,
        currentStatus: tx.status,
      });
    }

    const amount = typeof tx.amount === "number" ? tx.amount : Number(tx.amount || 0);

    // Verify user still has sufficient balance
    const currentBalance = await getUserBalance(tx.user_id);
    if (currentBalance < amount) {
      return res.status(400).json({
        error: "User has insufficient balance",
        currentBalance,
        requestedAmount: amount,
      });
    }

    // Deduct balance
    const newBalance = currentBalance - amount;
    await updateUserBalance(tx.user_id, newBalance);

    // Update transaction status
    await query(
      `UPDATE pix_transactions 
       SET status = 'completed', balance_after = ?, updated_at = NOW()
       WHERE id = ?`,
      [newBalance, transactionId],
    );

    logger.info(
      `Withdrawal approved by admin ${req.userId}: transactionId=${transactionId}, userId=${tx.user_id}, amount=${amount}, newBalance=${newBalance}`,
    );

    res.json({
      message: "Withdrawal approved successfully",
      transactionId: tx.id,
      amount,
      newBalance,
      pixKey: tx.pix_key,
    });
  } catch (error) {
    logger.error(error, "Error approving withdrawal");
    res.status(500).json({ error: "Failed to approve withdrawal" });
  }
});

// Reject withdrawal request
router.post("/withdrawals/reject", async (req: AuthRequest, res) => {
  try {
    const { transactionId, reason } = req.body;

    if (!transactionId) {
      return res.status(400).json({ error: "Transaction ID is required" });
    }

    // Get transaction details
    const transaction = (await query(
      `SELECT id, user_id, amount, status
       FROM pix_transactions 
       WHERE id = ? AND transaction_type = 'withdrawal'`,
      [transactionId],
    )) as Array<{
      id: string;
      user_id: string;
      amount: number | string;
      status: string;
    }>;

    if (transaction.length === 0) {
      return res.status(404).json({ error: "Withdrawal request not found" });
    }

    const tx = transaction[0];

    // Check if already processed
    if (tx.status !== "pending") {
      return res.status(400).json({ 
        error: `Withdrawal request is already ${tx.status}`,
        currentStatus: tx.status,
      });
    }

    // Update transaction status to failed
    await query(
      `UPDATE pix_transactions 
       SET status = 'failed', error_message = ?, updated_at = NOW()
       WHERE id = ?`,
      [reason || "Rejected by admin", transactionId],
    );

    logger.info(
      `Withdrawal rejected by admin ${req.userId}: transactionId=${transactionId}, userId=${tx.user_id}, reason=${reason || "No reason provided"}`,
    );

    res.json({
      message: "Withdrawal rejected successfully",
      transactionId: tx.id,
    });
  } catch (error) {
    logger.error(error, "Error rejecting withdrawal");
    res.status(500).json({ error: "Failed to reject withdrawal" });
  }
});

export default router;

