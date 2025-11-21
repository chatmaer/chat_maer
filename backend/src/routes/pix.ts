import express from "express";
import { v4 as uuidv4 } from "uuid";
import { query } from "../db/connection.js";
import logger from "../lib/logger.js";
import { getUserBalance, updateUserBalance } from "../utils/roomManager.js";
import { authenticateToken, AuthRequest } from "../middleware/auth.js";
import { config } from "../config/env.js";
import mercadopago from "mercadopago";

const router = express.Router();

// Use JWT authentication middleware for all pix routes
router.use(authenticateToken);

// Initialize Mercado Pago SDK
if (config.mercadoPago.accessToken) {
  mercadopago.configurations.setAccessToken(config.mercadoPago.accessToken);
} else {
  logger.warn("Mercado Pago access token not configured. Pix integration will not work.");
}

// Request Pix deposit (creates QR code)
router.post("/deposit/request", async (req: AuthRequest, res) => {
  try {
    if (!config.mercadoPago.accessToken) {
      return res.status(503).json({
        error: "Pix integration is not configured",
        enabled: false,
      });
    }

    const { amount, payer } = req.body;
    const userId = req.userId;

    if (!userId || !amount) {
      return res.status(400).json({ error: "userId and amount are required" });
    }

    if (amount <= 0) {
      return res.status(400).json({ error: "Amount must be greater than 0" });
    }

    if (amount < 1) {
      return res.status(400).json({ error: "Minimum deposit is R$ 1.00" });
    }

    // Validate payer information
    if (!payer || !payer.email || !payer.firstName || !payer.lastName) {
      return res.status(400).json({
        error: "Payer information is required (email, firstName, lastName)",
      });
    }

    if (!payer.identification || !payer.identification.type || !payer.identification.number) {
      return res.status(400).json({
        error: "Payer identification is required (type: CPF or CNPJ, number)",
      });
    }

    // Check if user exists
    const user = (await query("SELECT id, balance, username FROM users WHERE id = ?", [
      userId,
    ])) as Array<{ id: string; balance: number | string; username: string }>;

    if (user.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const transactionId = uuidv4();
    const userBalance = typeof user[0].balance === 'number' 
      ? user[0].balance 
      : Number(user[0].balance || 0);

    // Create payment data for Mercado Pago
    const paymentData = {
      payment_method_id: "pix",
      description: `Deposit for user ${user[0].username}`,
      transaction_amount: Number(amount),
      payer: {
        email: payer.email,
        first_name: payer.firstName,
        last_name: payer.lastName,
        identification: {
          type: payer.identification.type, // CPF or CNPJ
          number: payer.identification.number,
        },
      },
      external_reference: transactionId, // Link to our transaction ID
    };

    // Create payment with Mercado Pago
    const paymentResponse = await mercadopago.payment.create(paymentData);
    const payment = paymentResponse.response;

    // Extract QR code information
    const qrCode = payment.point_of_interaction?.transaction_data?.qr_code || null;
    const qrCodeBase64 = payment.point_of_interaction?.transaction_data?.qr_code_base64 || null;
    
    if (!qrCode || !qrCodeBase64) {
      logger.error({ payment }, "Mercado Pago payment created but QR code not found");
      return res.status(500).json({ error: "Failed to generate QR code" });
    }

    // Calculate expiration time (Mercado Pago Pix QR codes typically expire in 30 minutes)
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    // Store QR code data
    const qrCodeData = {
      qrCode,
      qrCodeBase64,
      transactionId,
      expiresAt,
      mercadoPagoPaymentId: payment.id,
    };

    // Create pending transaction in database
    await query(
      `INSERT INTO pix_transactions 
       (id, user_id, transaction_type, amount, status, qr_code, qr_code_expires_at, balance_before, pix_transaction_id)
       VALUES (?, ?, 'deposit', ?, 'pending', ?, ?, ?, ?)`,
      [
        transactionId,
        userId,
        amount,
        JSON.stringify(qrCodeData),
        expiresAt,
        userBalance,
        payment.id.toString(),
      ],
    );

    logger.info(
      `Pix deposit request created: userId=${userId}, amount=${amount}, paymentId=${payment.id}`,
    );

    res.json({
      transactionId,
      qrCode,
      qrCodeBase64: `data:image/jpeg;base64,${qrCodeBase64}`,
      expiresAt,
      amount,
      paymentId: payment.id,
      status: payment.status,
      message: "Pix deposit request created. Scan QR code to complete payment.",
    });
  } catch (error: any) {
    logger.error(error, "Error in Pix deposit request");
    
    // Handle Mercado Pago API errors
    let errorMessage = "Failed to create Pix deposit request";
    let errorStatus = 500;

    if (error.cause && Array.isArray(error.cause) && error.cause.length > 0) {
      errorMessage = error.cause[0].description || errorMessage;
      errorStatus = error.status || errorStatus;
    } else if (error.message) {
      errorMessage = error.message;
    }

    res.status(errorStatus).json({ error: errorMessage });
  }
});

// Check deposit status
router.get("/deposit/status/:transactionId", async (req: AuthRequest, res) => {
  try {
    if (!config.mercadoPago.accessToken) {
      return res.status(503).json({
        error: "Pix integration is not configured",
        enabled: false,
      });
    }

    const { transactionId } = req.params;
    const userId = req.userId;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    // Get transaction from database
    const transaction = (await query(
      `SELECT id, user_id, amount, status, balance_after, error_message, created_at, updated_at, pix_transaction_id
       FROM pix_transactions 
       WHERE id = ? AND user_id = ? AND transaction_type = 'deposit'`,
      [transactionId, userId],
    )) as Array<{
      id: string;
      user_id: string;
      amount: number | string;
      status: string;
      balance_after: number | string | null;
      error_message: string | null;
      created_at: Date;
      updated_at: Date;
      pix_transaction_id: string | null;
    }>;

    if (transaction.length === 0) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    const tx = transaction[0];
    const mercadoPagoPaymentId = tx.pix_transaction_id;

    // If we have a Mercado Pago payment ID, check the payment status
    if (mercadoPagoPaymentId) {
      try {
        const paymentResponse = await mercadopago.payment.findById(Number(mercadoPagoPaymentId));
        const payment = paymentResponse.response;

        // Map Mercado Pago status to our status
        let newStatus = tx.status;
        if (payment.status === "approved") {
          newStatus = "completed";
          // If payment is approved but our transaction is still pending, update it
          if (tx.status === "pending" || tx.status === "processing") {
            const amount = typeof tx.amount === 'number' ? tx.amount : Number(tx.amount || 0);
            const currentBalance = await getUserBalance(userId);
            const newBalance = currentBalance + amount;

            await updateUserBalance(userId, newBalance);

            await query(
              `UPDATE pix_transactions 
               SET status = 'completed', balance_after = ?, updated_at = NOW()
               WHERE id = ?`,
              [newBalance, transactionId],
            );

            logger.info(
              `Pix deposit completed: userId=${userId}, amount=${amount}, newBalance=${newBalance}`,
            );
          }
        } else if (payment.status === "rejected" || payment.status === "cancelled") {
          newStatus = "failed";
          if (tx.status === "pending" || tx.status === "processing") {
            await query(
              `UPDATE pix_transactions 
               SET status = 'failed', error_message = ?, updated_at = NOW()
               WHERE id = ?`,
              [payment.status_detail || "Payment rejected", transactionId],
            );
          }
        } else if (payment.status === "pending" || payment.status === "in_process") {
          newStatus = "processing";
          if (tx.status === "pending") {
            await query(
              `UPDATE pix_transactions 
               SET status = 'processing', updated_at = NOW()
               WHERE id = ?`,
              [transactionId],
            );
          }
        }

        const balanceAfter = typeof tx.balance_after === 'number' 
          ? tx.balance_after 
          : (tx.balance_after ? Number(tx.balance_after) : null);

        return res.json({
          transactionId: tx.id,
          amount: typeof tx.amount === 'number' ? tx.amount : Number(tx.amount || 0),
          status: newStatus,
          balanceAfter: balanceAfter,
          errorMessage: tx.error_message,
          createdAt: tx.created_at,
          updatedAt: tx.updated_at,
          mercadoPagoStatus: payment.status,
        });
      } catch (mpError: any) {
        logger.error(mpError, "Error checking Mercado Pago payment status");
        // Fall through to return database status
      }
    }

    // Return database status if we can't check Mercado Pago
    const balanceAfter = typeof tx.balance_after === 'number' 
      ? tx.balance_after 
      : (tx.balance_after ? Number(tx.balance_after) : null);

    res.json({
      transactionId: tx.id,
      amount: typeof tx.amount === 'number' ? tx.amount : Number(tx.amount || 0),
      status: tx.status,
      balanceAfter: balanceAfter,
      errorMessage: tx.error_message,
      createdAt: tx.created_at,
      updatedAt: tx.updated_at,
    });
  } catch (error) {
    logger.error(error, "Error checking Pix deposit status");
    res.status(500).json({ error: "Failed to check deposit status" });
  }
});

// Request Pix withdrawal
// Note: Mercado Pago doesn't provide a direct withdrawal API like deposits.
// This endpoint creates a withdrawal request that would need to be processed manually
// or through a different payment provider that supports payouts.
router.post("/withdrawal/request", async (req: AuthRequest, res) => {
  try {
    if (!config.mercadoPago.accessToken) {
      return res.status(503).json({
        error: "Pix integration is not configured",
        enabled: false,
      });
    }

    const { amount, pixKey } = req.body;
    const userId = req.userId;

    if (!userId || !amount || !pixKey) {
      return res
        .status(400)
        .json({ error: "userId, amount, and pixKey are required" });
    }

    if (amount <= 0) {
      return res.status(400).json({ error: "Amount must be greater than 0" });
    }

    if (amount < 1) {
      return res.status(400).json({ error: "Minimum withdrawal is R$ 1.00" });
    }

    // Validate Pix key format (basic validation)
    const pixKeyRegex = /^[a-zA-Z0-9@.\-+() ]+$/;
    if (!pixKeyRegex.test(pixKey) || pixKey.length < 3) {
      return res.status(400).json({
        error: "Invalid Pix key format",
      });
    }

    // Check user balance
    const userBalance = await getUserBalance(userId);
    if (userBalance < amount) {
      return res.status(400).json({
        error: "Insufficient balance",
        currentBalance: userBalance,
      });
    }

    // Check if user exists
    const user = (await query("SELECT id FROM users WHERE id = ?", [
      userId,
    ])) as Array<{ id: string }>;

    if (user.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const transactionId = uuidv4();

    // Note: Mercado Pago doesn't have a direct withdrawal/payout API for Pix.
    // Withdrawals would need to be processed manually or through a different service.
    // For now, we create a pending transaction that can be processed manually by admins.

    // Create pending withdrawal transaction
    await query(
      `INSERT INTO pix_transactions 
       (id, user_id, transaction_type, amount, status, pix_key, balance_before)
       VALUES (?, ?, 'withdrawal', ?, 'pending', ?, ?)`,
      [transactionId, userId, amount, pixKey, userBalance],
    );

    logger.info(
      `Pix withdrawal request created: userId=${userId}, amount=${amount}, pixKey=${pixKey.replace(/(.{4})(.*)(.{4})/, "$1****$3")}`,
    );

    // Withdrawals require manual processing or integration with a payout service
    // The transaction will remain in 'pending' status until manually processed

    res.json({
      transactionId,
      amount,
      pixKey: pixKey.replace(/(.{4})(.*)(.{4})/, "$1****$3"), // Mask Pix key
      status: "pending",
      message: "Withdrawal request submitted. It will be processed manually.",
    });
  } catch (error) {
    logger.error(error, "Error in Pix withdrawal request");
    res.status(500).json({ error: "Failed to create Pix withdrawal request" });
  }
});

// Check withdrawal status
router.get("/withdrawal/status/:transactionId", async (req: AuthRequest, res) => {
  try {
    const { transactionId } = req.params;
    const userId = req.userId;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const transaction = (await query(
      `SELECT id, user_id, amount, status, balance_after, error_message, created_at, updated_at
       FROM pix_transactions 
       WHERE id = ? AND user_id = ? AND transaction_type = 'withdrawal'`,
      [transactionId, userId],
    )) as Array<{
      id: string;
      user_id: string;
      amount: number;
      status: string;
      balance_after: number | null;
      error_message: string | null;
      created_at: Date;
      updated_at: Date;
    }>;

    if (transaction.length === 0) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    res.json({
      transactionId: transaction[0].id,
      amount: transaction[0].amount,
      status: transaction[0].status,
      balanceAfter: transaction[0].balance_after,
      errorMessage: transaction[0].error_message,
      createdAt: transaction[0].created_at,
      updatedAt: transaction[0].updated_at,
    });
  } catch (error) {
    logger.error(error, "Error checking Pix withdrawal status");
    res.status(500).json({ error: "Failed to check withdrawal status" });
  }
});

// Get user's Pix transactions history
router.get("/transactions", async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const transactions = (await query(
      `SELECT id, transaction_type, amount, status, pix_key, balance_after, error_message, created_at, updated_at
       FROM pix_transactions 
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId],
    )) as Array<{
      id: string;
      transaction_type: string;
      amount: number;
      status: string;
      pix_key: string | null;
      balance_after: number | null;
      error_message: string | null;
      created_at: Date;
      updated_at: Date;
    }>;

    res.json({
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.transaction_type,
        amount: t.amount,
        status: t.status,
        pixKey: t.pix_key
          ? t.pix_key.replace(/(.{4})(.*)(.{4})/, "$1****$3")
          : null,
        balanceAfter: t.balance_after,
        errorMessage: t.error_message,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      })),
    });
  } catch (error) {
    logger.error(error, "Error fetching Pix transactions");
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

// Update user's Pix key
router.post("/pix-key", async (req: AuthRequest, res) => {
  try {
    const { pixKey } = req.body;
    const userId = req.userId;

    if (!userId || !pixKey) {
      return res.status(400).json({ error: "userId and pixKey are required" });
    }

    // Validate Pix key format
    const pixKeyRegex = /^[a-zA-Z0-9@.\-+() ]+$/;
    if (!pixKeyRegex.test(pixKey) || pixKey.length < 3) {
      return res.status(400).json({
        error: "Invalid Pix key format",
      });
    }

    // Check if user exists
    const user = (await query("SELECT id FROM users WHERE id = ?", [
      userId,
    ])) as Array<{ id: string }>;

    if (user.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    // Update Pix key
    await query("UPDATE users SET pix_key = ? WHERE id = ?", [pixKey, userId]);

    res.json({
      message: "Pix key updated successfully",
      pixKey: pixKey.replace(/(.{4})(.*)(.{4})/, "$1****$3"), // Mask for response
    });
  } catch (error) {
    logger.error(error, "Error updating Pix key");
    res.status(500).json({ error: "Failed to update Pix key" });
  }
});

// Get user's Pix key (masked)
router.get("/pix-key/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const user = (await query("SELECT pix_key FROM users WHERE id = ?", [
      userId,
    ])) as Array<{ pix_key: string | null }>;

    if (user.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const pixKey = user[0].pix_key;
    res.json({
      pixKey: pixKey ? pixKey.replace(/(.{4})(.*)(.{4})/, "$1****$3") : null,
      hasPixKey: !!pixKey,
    });
  } catch (error) {
    logger.error(error, "Error fetching Pix key");
    res.status(500).json({ error: "Failed to fetch Pix key" });
  }
});

export default router;

