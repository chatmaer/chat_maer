import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import cors from "cors";
import passport from "passport";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";

import { config } from "./config/env.js";
import { setupSocketHandlers } from "./lib/socket-handler.js";
import logger from "./lib/logger.js";
import { testConnection } from "./db/connection.js";
import {
  activeWSConnectionsGauge,
  register,
  totalRequestsCounter,
} from "./lib/monitor.js";
import authRoutes from "./routes/auth.js";
import pixRoutes from "./routes/pix.js";
import adminRoutes from "./routes/admin.js";
import "./controllers/passport.js";

const app = express();
const httpServer = createServer(app);

const allowedOrigins = [
  config.clientUrl,
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "https://chatmaer.ddns.net",
  "http://chatmaer.ddns.net",
  ...config.allowedOrigins,
];

const isOriginAllowed = (origin: string | undefined): boolean => {
  if (!origin) return true;
  
  const normalizedOrigin = origin.replace(/\/$/, '').toLowerCase();
  const normalizedAllowedOrigins = allowedOrigins.map((o) => o.replace(/\/$/, '').toLowerCase());
  if (normalizedAllowedOrigins.includes(normalizedOrigin)) return true;
  
  if (normalizedOrigin.endsWith('.vercel.app')) return true;
  
  // Allow same-origin requests (when frontend and backend are on same domain)
  if (normalizedOrigin.includes('chatmaer.ddns.net')) return true;
  
  if (config.clientUrl) {
    const clientUrlNormalized = config.clientUrl.replace(/\/$/, '').toLowerCase();
    if (normalizedOrigin === clientUrlNormalized) return true;
  }
  
  for (const allowedOrigin of config.allowedOrigins) {
    const allowedNormalized = allowedOrigin.replace(/\/$/, '').toLowerCase();
    if (normalizedOrigin === allowedNormalized) return true;
  }
  
  return false;
};

// Socket.IO CORS configuration
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Express CORS configuration
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  optionsSuccessStatus: 200,
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Session configuration for Passport
app.use(
  session({
    secret: config.session.secret,
    resave: true,
    saveUninitialized: true,
    cookie: {
      secure: config.nodeEnv === "production",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  }),
);

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Serve frontend static files
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendPath = path.join(__dirname, "../frontend");

// Serve static assets (CSS, JS, images, etc.) - must be before routes
app.use(express.static(frontendPath));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/pix", pixRoutes);
app.use("/api/admin", adminRoutes);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Metrics endpoint
app.get("/metrics", async (req, res) => {
  res.writeHead(200, { "Content-Type": register.contentType });
  res.end(await register.metrics());
});

// Admin endpoint - get active rooms
app.get("/admin/rooms", async (req, res) => {
  try {
    const { query } = await import("./db/connection.js");
    const rooms = await query(
      `
      SELECT r.id, r.keyword, r.game_type, r.status, r.created_at,
             COUNT(rp.user_id) as player_count
      FROM rooms r
      LEFT JOIN room_players rp ON r.id = rp.room_id
      GROUP BY r.id
      ORDER BY r.created_at DESC
      LIMIT 50
    `,
    );
    res.json(rooms);
  } catch (error) {
    logger.error(error, "Error fetching rooms");
    res.status(500).json({ error: "Failed to fetch rooms" });
  }
});

// Admin endpoint - get active users
app.get("/admin/users", async (req, res) => {
  try {
    const { query } = await import("./db/connection.js");
    const users = await query(
      `
      SELECT id, username, created_at, coins
      FROM users
      ORDER BY created_at DESC
      LIMIT 100
    `,
    );
    res.json(users);
  } catch (error) {
    logger.error(error, "Error fetching users");
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// Catch-all route: serve index.html for SPA routing (must be last, after all API routes)
app.get("*", (req, res) => {
  // Don't serve index.html for API routes, socket.io, health, or metrics
  if (
    req.path.startsWith("/api") ||
    req.path.startsWith("/socket.io") ||
    req.path === "/health" ||
    req.path === "/metrics"
  ) {
    return res.status(404).json({ error: "Not found" });
  }
  res.sendFile(path.join(frontendPath, "index.html"));
});

// Setup Socket.IO handlers
setupSocketHandlers(io);

// Initialize database connection and start server
(async () => {
  try {
    await testConnection();
    logger.info("Database connected");

    // Start server
    httpServer.listen(config.port, () => {
      logger.info(`Server running on port ${config.port}`);
      logger.info(`Environment: ${config.nodeEnv}`);
      if (config.mercadoPago.accessToken) {
        logger.info("Mercado Pago Pix integration: ENABLED");
      } else {
        logger.warn("Mercado Pago Pix integration: DISABLED (MERCADO_PAGO_ACCESS_TOKEN not set)");
        logger.warn("Please set MERCADO_PAGO_ACCESS_TOKEN in .env file to enable Pix payments");
      }
    });
  } catch (error) {
    logger.error(error, "Failed to connect to database");
    logger.error("Please check your database configuration in .env file");
    process.exit(1);
  }
})();
