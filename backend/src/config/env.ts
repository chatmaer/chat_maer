export const config = {
  port: Number(process.env.PORT) || 3001,
  db: {
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "chat_maer",
  },
  nodeEnv: process.env.NODE_ENV || "development",
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
  // Additional allowed origins (comma-separated list for custom domains)
  // Example: "https://example.com,https://www.example.com,https://app.example.com"
  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
    : [],
  mercadoPago: {
    accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN || "",
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  },
  session: {
    secret: process.env.SESSION_SECRET || "your-secret-key-change-in-production",
  },
};

