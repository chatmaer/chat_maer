import express from "express";
import { v4 as uuidv4 } from "uuid";
import { query } from "../db/connection.js";
import logger from "../lib/logger.js";
import { getUserBalance, updateUserBalance } from "../utils/roomManager.js";
import { authenticateToken, AuthRequest } from "../middleware/auth.js";
import { config } from "../config/env.js";
import { createRequire } from "module";

// Use createRequire to import CommonJS module in ESM context
const require = createRequire(import.meta.url);

let mercadopagoModule: any = null;
let mercadopagoClient: any = null;

try {
  mercadopagoModule = require("mercadopago");
  logger.info({ keys: Object.keys(mercadopagoModule) }, "mercadopago package loaded");
} catch (err: any) {
  logger.error({ err: err.message }, "mercadopago package not found. Run: npm i mercadopago");
  mercadopagoModule = null;
}

function initMercadoPagoClient() {
  if (!mercadopagoModule) return null;

  // Common init patterns:
  // - v1: require('mercadopago'); mercadopago.configure({ access_token: '...' }) OR mercadopago.configurations.setAccessToken(...)
  // - v2: const MP = require('mercadopago'); const client = new MP({ accessToken: '...' }) or MP.MercadoPago
  // We'll try a few patterns and return a client object with standardized shape.
  try {
    // 1) If module has default export that is a class or function
    const exported = mercadopagoModule.default ?? mercadopagoModule;

    // If it is a class constructor (v2)
    if (typeof exported === "function" && exported.name && /MercadoPago|Mercadopago/i.test(exported.name)) {
      try {
        const client = new exported({ accessToken: config.mercadoPago.accessToken });
        logger.info("Initialized MercadoPago as class instance (new exported(...))");
        return client;
      } catch (e) {
        // fallback
        logger.warn({ err: (e as Error).message }, "new MercadoPago(...) failed, trying configure() fallback");
      }
    }

    // 2) If module exposes MercadoPago property/class
    if (mercadopagoModule.MercadoPago && typeof mercadopagoModule.MercadoPago === "function") {
      try {
        const client = new mercadopagoModule.MercadoPago({ accessToken: config.mercadoPago.accessToken });
        logger.info("Initialized MercadoPago via mercadopago.MercadoPago class");
        return client;
      } catch (e) {
        logger.warn({ err: (e as Error).message }, "mercadopago.MercadoPago(...) failed");
      }
    }

    // 3) If module has configure or configurations.setAccessToken (v1 style)
    if (mercadopagoModule.configure && typeof mercadopagoModule.configure === "function") {
      try {
        mercadopagoModule.configure({ access_token: config.mercadoPago.accessToken });
        logger.info("Initialized MercadoPago via configure()");
        return mercadopagoModule;
      } catch (e) {
        logger.warn({ err: (e as Error).message }, "mercadopago.configure failed");
      }
    }

    if (mercadopagoModule.configurations && typeof mercadopagoModule.configurations.setAccessToken === "function") {
      try {
        mercadopagoModule.configurations.setAccessToken(config.mercadoPago.accessToken);
        logger.info("Initialized MercadoPago via configurations.setAccessToken()");
        return mercadopagoModule;
      } catch (e) {
        logger.warn({ err: (e as Error).message }, "mercadopago.configurations.setAccessToken failed");
      }
    }

    // Otherwise, attempt to instantiate if module itself is a constructor
    if (typeof mercadopagoModule === "function") {
      try {
        const client = new mercadopagoModule({ accessToken: config.mercadoPago.accessToken });
        logger.info("Initialized MercadoPago via direct constructor");
        return client;
      } catch (e) {
        logger.warn({ err: (e as Error).message }, "Direct constructor attempt failed");
      }
    }

    // If we get here, return the module in case it has usable methods directly
    logger.info("Falling back to using mercadopago module object directly");
    return mercadopagoModule;
  } catch (error: any) {
    logger.error({ error: error.message }, "initMercadoPagoClient failed");
    return null;
  }
}

// initialize once
if (config.mercadoPago.accessToken) {
  mercadopagoClient = initMercadoPagoClient();
  if (!mercadopagoClient) {
    logger.error("Mercado Pago client initialization failed. Check package version and access token.");
  }
} else {
  logger.warn("Mercado Pago access token missing in config");
}

// Helper: create payment and normalize result across SDK versions
async function createPaymentWithMercadoPago(paymentData: any) {
  if (!mercadopagoClient) throw new Error("Mercado Pago client not initialized");
  if (!mercadopagoModule) throw new Error("Mercado Pago module not loaded");

  // Try common invocation patterns:
  // v1: mercadopago.payment.create(paymentData) => { response: {...} }
  // v2: new Payment(client).create({ body: paymentData }) => returns object directly
  // v2 alt: client.payments.create({ body: paymentData })

  // We'll attempt a sequence and normalize result to { id, status, status_detail, point_of_interaction }
  const diagnostics: any[] = [];

  // helper to normalize candidate response object to common shape
  function normalize(resp: any) {
    // candidate resp may be:
    // - { response: {...} }
    // - { body: {...} }
    // - direct payment object

    const candidate = resp?.response ?? resp?.body ?? resp;
    if (!candidate) return null;

    const id = candidate.id ?? (candidate.payment_id ?? null);
    const status = candidate.status ?? candidate.payment_status ?? null;
    const status_detail = candidate.status_detail ?? null;
    const poi = candidate.point_of_interaction ?? candidate.point_of_interaction ?? null;

    return {
      raw: candidate,
      id,
      status,
      status_detail,
      point_of_interaction: poi,
    };
  }

  // Attempt patterns
  try {
    // pattern 0: v2.x SDK - Use Payment class with client instance (CORRECT PATTERN FOR v2.10.0)
    if (mercadopagoModule.Payment && typeof mercadopagoModule.Payment === "function" && mercadopagoClient) {
      try {
        diagnostics.push("calling new Payment(client).create({ body: paymentData })");
        const PaymentClass = mercadopagoModule.Payment;
        const paymentInstance = new PaymentClass(mercadopagoClient);
        const r = await paymentInstance.create({ body: paymentData });
        const n = normalize(r);
        if (n && n.id) {
          logger.info({ paymentId: n.id, diagnostics }, "Payment created successfully using Payment class");
          return { normalized: n, diagnostics };
        }
      } catch (err: any) {
        diagnostics.push(`Payment class pattern failed: ${err.message}`);
        logger.warn({ err: err.message }, "Payment class pattern failed, trying other patterns");
      }
    }

    // pattern 1: mercadopagoClient.payment.create(paymentData) (v1)
    if (mercadopagoClient.payment && typeof mercadopagoClient.payment.create === "function") {
      diagnostics.push("calling mercadopagoClient.payment.create(paymentData)");
      const r = await mercadopagoClient.payment.create(paymentData);
      const n = normalize(r);
      if (n && n.id) return { normalized: n, diagnostics };
    }

    // pattern 1b: mercadopagoClient.payment.create({ body: paymentData })
    if (mercadopagoClient.payment && typeof mercadopagoClient.payment.create === "function") {
      diagnostics.push("calling mercadopagoClient.payment.create({ body }) (alternate)");
      const r = await mercadopagoClient.payment.create({ body: paymentData });
      const n = normalize(r);
      if (n && n.id) return { normalized: n, diagnostics };
    }

    // pattern 2: mercadopagoClient.payments.create({ body })
    if (mercadopagoClient.payments && typeof mercadopagoClient.payments.create === "function") {
      diagnostics.push("calling mercadopagoClient.payments.create({ body })");
      const r = await mercadopagoClient.payments.create({ body: paymentData });
      const n = normalize(r);
      if (n && n.id) return { normalized: n, diagnostics };
    }

    // pattern 3: mercadopagoClient.payment.create when mercadopagoClient is module itself (some versions)
    if (typeof mercadopagoClient.create === "function") {
      diagnostics.push("calling mercadopagoClient.create(paymentData)");
      const r = await mercadopagoClient.create(paymentData);
      const n = normalize(r);
      if (n && n.id) return { normalized: n, diagnostics };
    }

    // pattern 4: fallback to direct POST using the SDK client if it exposes a post function
    if (typeof mercadopagoClient.post === "function") {
      diagnostics.push("calling mercadopagoClient.post('/v1/payments', paymentData)");
      const r = await mercadopagoClient.post({ uri: "/v1/payments", data: paymentData });
      const n = normalize(r);
      if (n && n.id) return { normalized: n, diagnostics };
    }

    // final fallback: try calling the rest client if present
    if (mercadopagoModule && typeof mercadopagoModule === "object" && mercadopagoModule.post) {
      diagnostics.push("calling mercadopagoModule.post('/v1/payments', ...)");
      const r = await mercadopagoModule.post({ uri: "/v1/payments", data: paymentData });
      const n = normalize(r);
      if (n && n.id) return { normalized: n, diagnostics };
    }

    throw new Error("No supported mercadopago client method found");
  } catch (err: any) {
    logger.error({ err: err.message, diagnostics, clientKeys: mercadopagoClient ? Object.keys(mercadopagoClient) : [], moduleKeys: mercadopagoModule ? Object.keys(mercadopagoModule) : [] }, "createPaymentWithMercadoPago failed");
    // make the error message more friendly upstream
    const e: any = new Error("Mercado Pago payment creation failed");
    e.cause = { diagnostics, inner: err?.message ?? err };
    throw e;
  }
}

// Helper: get payment status by paymentId (normalizes)
async function getPaymentStatusFromMercadoPago(paymentId: string | number) {
  if (!mercadopagoClient) throw new Error("Mercado Pago client not initialized");
  if (!mercadopagoModule) throw new Error("Mercado Pago module not loaded");

  const diagnostics: any[] = [];

  try {
    // pattern 0: v2.x SDK - Use Payment class with client instance (CORRECT PATTERN FOR v2.10.0)
    if (mercadopagoModule.Payment && typeof mercadopagoModule.Payment === "function" && mercadopagoClient) {
      try {
        diagnostics.push("calling new Payment(client).get({ id })");
        const PaymentClass = mercadopagoModule.Payment;
        const paymentInstance = new PaymentClass(mercadopagoClient);
        const r = await paymentInstance.get({ id: Number(paymentId) });
        const candidate = r?.response ?? r?.body ?? r;
        if (candidate && candidate.id) {
          return { candidate, diagnostics };
        }
      } catch (err: any) {
        diagnostics.push(`Payment class pattern failed: ${err.message}`);
        logger.warn({ err: err.message }, "Payment class get pattern failed, trying other patterns");
      }
    }

    // pattern A: mercadopagoClient.payment.findById(id)
    if (mercadopagoClient.payment && typeof mercadopagoClient.payment.findById === "function") {
      diagnostics.push("calling mercadopagoClient.payment.findById");
      const r = await mercadopagoClient.payment.findById(Number(paymentId));
      const candidate = r?.response ?? r?.body ?? r;
      if (candidate && candidate.id) return { candidate, diagnostics };
    }

    // pattern B: mercadopagoClient.payments.get({ id })
    if (mercadopagoClient.payments && typeof mercadopagoClient.payments.get === "function") {
      diagnostics.push("calling mercadopagoClient.payments.get");
      const r = await mercadopagoClient.payments.get({ id: Number(paymentId) });
      const candidate = r?.response ?? r?.body ?? r;
      if (candidate && candidate.id) return { candidate, diagnostics };
    }

    // pattern C: mercadopagoClient.payment.get({ id })
    if (mercadopagoClient.payment && typeof mercadopagoClient.payment.get === "function") {
      diagnostics.push("calling mercadopagoClient.payment.get");
      const r = await mercadopagoClient.payment.get({ id: Number(paymentId) });
      const candidate = r?.response ?? r?.body ?? r;
      if (candidate && candidate.id) return { candidate, diagnostics };
    }

    // fallback: perform raw GET to /v1/payments/{id} if library exposes rest
    if (mercadopagoModule && typeof mercadopagoModule.get === "function") {
      diagnostics.push("calling mercadopagoModule.get('/v1/payments/{id}') fallback");
      const r = await mercadopagoModule.get({ uri: `/v1/payments/${paymentId}` });
      const candidate = r?.response ?? r?.body ?? r;
      if (candidate && candidate.id) return { candidate, diagnostics };
    }

    throw new Error("No supported mercadopago client method for get status");
  } catch (err: any) {
    logger.error({ err: err.message, diagnostics }, "getPaymentStatusFromMercadoPago failed");
    const e: any = new Error("Failed to fetch payment status from Mercado Pago");
    e.cause = { diagnostics, inner: err?.message ?? err };
    throw e;
  }
}

const router = express.Router();

// Use JWT authentication middleware for all pix routes
router.use(authenticateToken);

// Request Pix deposit (creates QR code)
router.post("/deposit/request", async (req: AuthRequest, res) => {
  try {
    if (!config.mercadoPago.accessToken) {
      return res.status(503).json({
        error: "Pix integration is not configured",
        enabled: false,
      });
    }

    if (!mercadopagoClient) {
      logger.error("Mercado Pago SDK is not available. Please install: npm install mercadopago");
      return res.status(503).json({
        error: "Pix integration is not available. Mercado Pago SDK not installed.",
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

    // Create payment and normalize
    const { normalized, diagnostics } = await createPaymentWithMercadoPago(paymentData).catch((e) => { throw e; });

    const payment = normalized.raw;
    const paymentId = normalized.id ?? (payment?.id ?? null);
    const status = normalized.status ?? payment?.status ?? null;
    const poi = normalized.point_of_interaction ?? payment?.point_of_interaction ?? null;

    // Attempt to read QR info
    const qrCode = poi?.transaction_data?.qr_code ?? null;
    const qrCodeBase64 = poi?.transaction_data?.qr_code_base64 ?? null;

    if (!qrCode || !qrCodeBase64) {
      logger.error({ normalized, diagnostics, payment }, "Payment created but QR code not found");
      return res.status(500).json({ error: "Failed to generate QR code", details: "qr_code missing from response" });
    }

    // Calculate expiration time (Mercado Pago Pix QR codes typically expire in 30 minutes)
    // Format as MySQL DATETIME: 'YYYY-MM-DD HH:mm:ss' (no milliseconds, no timezone)
    const expiresAtDate = new Date(Date.now() + 30 * 60 * 1000);
    const expiresAt = expiresAtDate.toISOString().slice(0, 19).replace('T', ' ');

    // Save to DB
    const qrCodeData = { qrCode, qrCodeBase64, transactionId, expiresAt, mercadoPagoPaymentId: String(paymentId) };

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
        String(paymentId),
      ],
    );

    logger.info(`Pix deposit request created: userId=${userId}, amount=${amount}, paymentId=${paymentId}`);

    res.json({
      transactionId,
      qrCode,
      qrCodeBase64: `data:image/jpeg;base64,${qrCodeBase64}`,
      expiresAt,
      amount,
      paymentId,
      status,
      message: "Pix deposit request created. Scan QR code to complete payment.",
    });
  } catch (error: any) {
    logger.error({ err: error.message, cause: error.cause ?? null }, "Error in Pix deposit request");
    // Provide diagnostics but avoid leaking sensitive data to clients
    res.status(500).json({ error: error.message || "Failed to create Pix deposit request" });
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

    // If we have a Mercado Pago payment id, attempt to fetch current payment info
    if (tx.pix_transaction_id && mercadopagoClient) {
      try {
        const { candidate } = await getPaymentStatusFromMercadoPago(tx.pix_transaction_id);
        const payment = candidate;
        const mpStatus = payment?.status ?? null;

        let newStatus = tx.status;
        if (mpStatus === "approved") {
          newStatus = "completed";
          if (tx.status === "pending" || tx.status === "processing") {
            const amount = typeof tx.amount === "number" ? tx.amount : Number(tx.amount || 0);
            const currentBalance = await getUserBalance(userId);
            const newBalance = currentBalance + amount;

            await updateUserBalance(userId, newBalance);

            await query(`UPDATE pix_transactions SET status = 'completed', balance_after = ?, updated_at = NOW() WHERE id = ?`, [newBalance, transactionId]);
            logger.info(`Pix deposit completed: userId=${userId}, amount=${amount}, newBalance=${newBalance}`);
          }
        } else if (mpStatus === "rejected" || mpStatus === "cancelled") {
          newStatus = "failed";
          if (tx.status === "pending" || tx.status === "processing") {
            await query(`UPDATE pix_transactions SET status = 'failed', error_message = ?, updated_at = NOW() WHERE id = ?`, [payment?.status_detail ?? mpStatus, transactionId]);
          }
        } else if (mpStatus === "pending" || mpStatus === "in_process") {
          newStatus = "processing";
          if (tx.status === "pending") {
            await query(`UPDATE pix_transactions SET status = 'processing', updated_at = NOW() WHERE id = ?`, [transactionId]);
          }
        }

        const balanceAfter = typeof tx.balance_after === "number" ? tx.balance_after : (tx.balance_after ? Number(tx.balance_after) : null);

        return res.json({
          transactionId: tx.id,
          amount: typeof tx.amount === "number" ? tx.amount : Number(tx.amount || 0),
          status: newStatus,
          balanceAfter,
          errorMessage: tx.error_message,
          createdAt: tx.created_at,
          updatedAt: tx.updated_at,
          mercadoPagoStatus: mpStatus,
        });
      } catch (mpErr: any) {
        logger.error(mpErr, "Error checking Mercado Pago payment status, returning DB status");
        // fallthrough and return DB status
      }
    }

    // Fallback: return DB status
    const balanceAfter = typeof tx.balance_after === "number" ? tx.balance_after : (tx.balance_after ? Number(tx.balance_after) : null);
    res.json({
      transactionId: tx.id,
      amount: typeof tx.amount === "number" ? tx.amount : Number(tx.amount || 0),
      status: tx.status,
      balanceAfter,
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

// Get user balance (for wallet modal - works even when not in a room)
router.get("/balance", async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const balance = await getUserBalance(userId);
    res.json({ balance });
  } catch (error) {
    logger.error(error, "Error fetching user balance");
    res.status(500).json({ error: "Failed to fetch balance" });
  }
});

// Webhook endpoint for Mercado Pago payment notifications
// NOTE: This endpoint should NOT use authenticateToken middleware as it's called by Mercado Pago
// Configure this URL in Mercado Pago dashboard: https://www.mercadopago.com.ar/developers/en/docs/checkout-pro/payment-notifications
router.post("/webhook", async (req, res) => {
  try {
    // Mercado Pago sends notifications with payment data
    // The notification structure can vary, but typically includes:
    // - type: "payment"
    // - data: { id: "payment_id" }
    const { type, data } = req.body;

    if (type === "payment" && data?.id) {
      const paymentId = String(data.id);

      // First, check for platform updates
      const platformUpdates = (await query(
        `SELECT id, user_id, amount, status FROM platform_updates 
         WHERE pix_transaction_id = ?`,
        [paymentId],
      )) as Array<{
        id: string;
        user_id: string;
        amount: number | string;
        status: string;
      }>;

      if (platformUpdates.length > 0) {
        const tx = platformUpdates[0];

        // Fetch current payment status from Mercado Pago
        if (mercadopagoClient) {
          try {
            const { candidate } = await getPaymentStatusFromMercadoPago(paymentId);
            const payment = candidate;
            const mpStatus = payment?.status ?? null;

            if (mpStatus === "approved" && (tx.status === "pending" || tx.status === "processing")) {
              await query(
                `UPDATE platform_updates 
                 SET status = 'completed', updated_at = NOW() 
                 WHERE id = ?`,
                [tx.id],
              );

              logger.info(`Platform update completed via webhook: userId=${tx.user_id}, amount=${tx.amount}`);
            } else if (mpStatus === "rejected" || mpStatus === "cancelled") {
              if (tx.status === "pending" || tx.status === "processing") {
                await query(
                  `UPDATE platform_updates 
                   SET status = 'failed', error_message = ?, updated_at = NOW() 
                   WHERE id = ?`,
                  [payment?.status_detail ?? mpStatus, tx.id],
                );
                logger.info(`Platform update failed via webhook: transactionId=${tx.id}, status=${mpStatus}`);
              }
            } else if (mpStatus === "pending" || mpStatus === "in_process") {
              if (tx.status === "pending") {
                await query(
                  `UPDATE platform_updates 
                   SET status = 'processing', updated_at = NOW() 
                   WHERE id = ?`,
                  [tx.id],
                );
              }
            }
          } catch (mpErr: any) {
            logger.error({ err: mpErr.message }, "Error processing webhook platform update status");
          }
        }
        return; // Platform update processed, don't check deposits
      }

      // Then check for regular deposits
      const transactions = (await query(
        `SELECT id, user_id, amount, status FROM pix_transactions 
         WHERE pix_transaction_id = ? AND transaction_type = 'deposit'`,
        [paymentId],
      )) as Array<{
        id: string;
        user_id: string;
        amount: number | string;
        status: string;
      }>;

      if (transactions.length > 0) {
        const tx = transactions[0];

        // Fetch current payment status from Mercado Pago
        if (mercadopagoClient) {
          try {
            const { candidate } = await getPaymentStatusFromMercadoPago(paymentId);
            const payment = candidate;
            const mpStatus = payment?.status ?? null;

            if (mpStatus === "approved" && (tx.status === "pending" || tx.status === "processing")) {
              const amount = typeof tx.amount === "number" ? tx.amount : Number(tx.amount || 0);
              const currentBalance = await getUserBalance(tx.user_id);
              const newBalance = currentBalance + amount;

              await updateUserBalance(tx.user_id, newBalance);

              await query(
                `UPDATE pix_transactions 
                 SET status = 'completed', balance_after = ?, updated_at = NOW() 
                 WHERE id = ?`,
                [newBalance, tx.id],
              );

              logger.info(`Pix deposit completed via webhook: userId=${tx.user_id}, amount=${amount}, newBalance=${newBalance}`);
            } else if (mpStatus === "rejected" || mpStatus === "cancelled") {
              if (tx.status === "pending" || tx.status === "processing") {
                await query(
                  `UPDATE pix_transactions 
                   SET status = 'failed', error_message = ?, updated_at = NOW() 
                   WHERE id = ?`,
                  [payment?.status_detail ?? mpStatus, tx.id],
                );
                logger.info(`Pix deposit failed via webhook: transactionId=${tx.id}, status=${mpStatus}`);
              }
            } else if (mpStatus === "pending" || mpStatus === "in_process") {
              if (tx.status === "pending") {
                await query(
                  `UPDATE pix_transactions 
                   SET status = 'processing', updated_at = NOW() 
                   WHERE id = ?`,
                  [tx.id],
                );
              }
            }
          } catch (mpErr: any) {
            logger.error({ err: mpErr.message }, "Error processing webhook payment status");
          }
        }
      } else {
        logger.warn(`Webhook received for unknown payment: ${paymentId}`);
      }
    }

    // Always return 200 to acknowledge receipt
    res.status(200).json({ received: true });
  } catch (error: any) {
    logger.error({ err: error.message }, "Error processing Mercado Pago webhook");
    // Still return 200 to prevent Mercado Pago from retrying
    res.status(200).json({ received: true, error: "Processing failed but acknowledged" });
  }
});

// Platform update (boost) - separate from balance deposits
router.post("/platform-update/request", async (req: AuthRequest, res) => {
  try {
    if (!config.mercadoPago.accessToken) {
      return res.status(503).json({
        error: "Pix integration is not configured",
        enabled: false,
      });
    }

    if (!mercadopagoClient) {
      logger.error("Mercado Pago SDK is not available. Please install: npm install mercadopago");
      return res.status(503).json({
        error: "Pix integration is not available. Mercado Pago SDK not installed.",
        enabled: false,
      });
    }

    const { payer } = req.body;
    const userId = req.userId;
    const amount = 1.00; // Fixed amount for platform updates

    if (!userId || !amount) {
      return res.status(400).json({ error: "userId and amount are required" });
    }

    if (amount <= 0) {
      return res.status(400).json({ error: "Amount must be greater than 0" });
    }

    if (amount < 1) {
      return res.status(400).json({ error: "Minimum update is R$ 1.00" });
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
    const user = (await query("SELECT id, username FROM users WHERE id = ?", [
      userId,
    ])) as Array<{ id: string; username: string }>;

    if (user.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const transactionId = uuidv4();

    // Create payment data for Mercado Pago
    const paymentData = {
      payment_method_id: "pix",
      description: `Platform update from user ${user[0].username}`,
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
      external_reference: transactionId,
    };

    // Create payment and normalize
    const { normalized, diagnostics } = await createPaymentWithMercadoPago(paymentData).catch((e) => { throw e; });

    const payment = normalized.raw;
    const paymentId = normalized.id ?? (payment?.id ?? null);
    const status = normalized.status ?? payment?.status ?? null;
    const poi = normalized.point_of_interaction ?? payment?.point_of_interaction ?? null;

    // Attempt to read QR info
    const qrCode = poi?.transaction_data?.qr_code ?? null;
    const qrCodeBase64 = poi?.transaction_data?.qr_code_base64 ?? null;

    if (!qrCode || !qrCodeBase64) {
      logger.error({ normalized, diagnostics, payment }, "Payment created but QR code not found");
      return res.status(500).json({ error: "Failed to generate QR code", details: "qr_code missing from response" });
    }

    // Calculate expiration time (Mercado Pago Pix QR codes typically expire in 30 minutes)
    const expiresAtDate = new Date(Date.now() + 30 * 60 * 1000);
    const expiresAt = expiresAtDate.toISOString().slice(0, 19).replace('T', ' ');

    // Save to platform_updates table (not pix_transactions)
    // Store QR code data as JSON string (similar to pix_transactions)
    const qrCodeData = { qrCode, qrCodeBase64, transactionId, expiresAt, mercadoPagoPaymentId: String(paymentId) };
    
    await query(
      `INSERT INTO platform_updates 
       (id, user_id, amount, status, qr_code, qr_code_base64, qr_code_expires_at, pix_transaction_id)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`,
      [
        transactionId,
        userId,
        amount,
        JSON.stringify(qrCodeData),
        qrCodeBase64,
        expiresAt,
        String(paymentId),
      ],
    );

    logger.info(`Platform update request created: userId=${userId}, amount=${amount}, paymentId=${paymentId}`);

    res.json({
      transactionId,
      qrCode,
      qrCodeBase64: `data:image/jpeg;base64,${qrCodeBase64}`,
      expiresAt,
      amount,
      paymentId,
      status,
      message: "Platform update request created. Scan QR code to complete payment.",
    });
  } catch (error: any) {
    logger.error({ err: error.message, cause: error.cause ?? null }, "Error in platform update request");
    res.status(500).json({ error: error.message || "Failed to create platform update request" });
  }
});

// Check platform update status
router.get("/platform-update/status/:transactionId", async (req: AuthRequest, res) => {
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
      `SELECT id, user_id, amount, status, error_message, created_at, updated_at, pix_transaction_id
       FROM platform_updates 
       WHERE id = ? AND user_id = ?`,
      [transactionId, userId],
    )) as Array<{
      id: string;
      user_id: string;
      amount: number | string;
      status: string;
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

    // If we have a Mercado Pago payment id, attempt to fetch current payment info
    if (tx.pix_transaction_id && mercadopagoClient) {
      try {
        const { candidate } = await getPaymentStatusFromMercadoPago(tx.pix_transaction_id);
        const payment = candidate;
        const mpStatus = payment?.status ?? null;

        let newStatus = tx.status;
        const amount = typeof tx.amount === "number" ? tx.amount : Number(tx.amount || 0);
        if (mpStatus === "approved") {
          newStatus = "completed";
          if (tx.status === "pending" || tx.status === "processing") {
            await query(`UPDATE platform_updates SET status = 'completed', updated_at = NOW() WHERE id = ?`, [transactionId]);
            logger.info(`Platform update completed: userId=${userId}, amount=${amount}`);
          }
        } else if (mpStatus === "rejected" || mpStatus === "cancelled") {
          newStatus = "failed";
          if (tx.status === "pending" || tx.status === "processing") {
            await query(`UPDATE platform_updates SET status = 'failed', error_message = ?, updated_at = NOW() WHERE id = ?`, [payment?.status_detail ?? mpStatus, transactionId]);
          }
        } else if (mpStatus === "pending" || mpStatus === "in_process") {
          newStatus = "processing";
          if (tx.status === "pending") {
            await query(`UPDATE platform_updates SET status = 'processing', updated_at = NOW() WHERE id = ?`, [transactionId]);
          }
        }

        return res.json({
          transactionId: tx.id,
          amount,
          status: newStatus,
          errorMessage: tx.error_message,
          createdAt: tx.created_at,
          updatedAt: tx.updated_at,
          mercadoPagoStatus: mpStatus,
        });
      } catch (mpErr: any) {
        logger.error(mpErr, "Error checking Mercado Pago payment status, returning DB status");
        // fallthrough and return DB status
      }
    }

    // Fallback: return DB status
    const amount = typeof tx.amount === "number" ? tx.amount : Number(tx.amount || 0);
    res.json({
      transactionId: tx.id,
      amount,
      status: tx.status,
      errorMessage: tx.error_message,
      createdAt: tx.created_at,
      updatedAt: tx.updated_at,
    });
  } catch (error) {
    logger.error(error, "Error checking platform update status");
    res.status(500).json({ error: "Failed to check update status" });
  }
});

// Get user's platform update count
router.get("/platform-update/count", async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const result = (await query(
      `SELECT COUNT(*) as update_count 
       FROM platform_updates 
       WHERE user_id = ? AND status = 'completed'`,
      [userId],
    )) as Array<{ update_count: number | string }>;

    const count = typeof result[0].update_count === 'number' 
      ? result[0].update_count 
      : Number(result[0].update_count || 0);

    res.json({ count });
  } catch (error) {
    logger.error(error, "Error fetching platform update count");
    res.status(500).json({ error: "Failed to fetch update count" });
  }
});

export default router;

