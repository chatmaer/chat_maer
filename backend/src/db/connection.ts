import mysql from "mysql2/promise";

interface DBConfig {
  host: string;
  user: string;
  password: string;
  database: string;
  port?: number;
  ssl?: mysql.SslOptions;
  connectTimeout?: number;
}

// Fix common typo: 127.0.0.0.1 -> 127.0.0.1
const fixHostAddress = (host: string): string => {
  if (host === "127.0.0.0.1") {
    return "127.0.0.1";
  }
  return host;
};

const config: DBConfig = {
  host: fixHostAddress(process.env.DB_HOST || "localhost"),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "real_skills",
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
  connectTimeout: process.env.DB_CONNECT_TIMEOUT
    ? parseInt(process.env.DB_CONNECT_TIMEOUT, 10)
    : 60000,
};

// Configure SSL for cloud MySQL databases
const getSSLConfig = (): mysql.SslOptions | undefined => {
  const sslMode = process.env.DB_SSL_MODE?.toLowerCase();

  // If SSL is explicitly disabled, return undefined (no SSL)
  if (sslMode === "false" || sslMode === "disabled") {
    return undefined;
  }

  // If SSL is required (cloud databases)
  if (sslMode === "required" || sslMode === "true" || process.env.DB_SSL_CA) {
    const sslConfig: mysql.SslOptions = {};

    // CA certificate (for cloud providers like AWS RDS, Google Cloud SQL, etc.)
    if (process.env.DB_SSL_CA) {
      sslConfig.ca = process.env.DB_SSL_CA;
    }

    // Client certificate and key (if required)
    if (process.env.DB_SSL_CERT) {
      sslConfig.cert = process.env.DB_SSL_CERT;
    }
    if (process.env.DB_SSL_KEY) {
      sslConfig.key = process.env.DB_SSL_KEY;
    }

    // Reject unauthorized connections (recommended for production)
    sslConfig.rejectUnauthorized =
      process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false";

    // Return SSL config if any options are set, otherwise return minimal SSL config
    return Object.keys(sslConfig).length > 0
      ? sslConfig
      : { rejectUnauthorized: true };
  }

  // For local development, SSL is optional (undefined = no SSL)
  return undefined;
};

const sslConfig = getSSLConfig();
if (sslConfig) {
  config.ssl = sslConfig;
}

let pool: mysql.Pool | null = null;

export const getPool = (): mysql.Pool => {
  if (!pool) {
    pool = mysql.createPool({
      ...config,
      waitForConnections: true,
      connectionLimit: parseInt(
        process.env.DB_CONNECTION_LIMIT || "10",
        10,
      ),
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });
  }
  return pool;
};

export const query = async (
  sql: string,
  params?: unknown[],
): Promise<unknown[]> => {
  const connection = await getPool();
  const [results] = await connection.execute(sql, params || []);
  return results as unknown[];
};

export const testConnection = async (): Promise<boolean> => {
  try {
    const connection = await getPool();
    await connection.execute("SELECT 1 as test");
    return true;
  } catch (error) {
    throw error;
  }
};

