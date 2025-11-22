/**
 * Centralized API configuration
 * 
 * This file provides a single source of truth for the backend API URL.
 * Set VITE_API_URL in your .env file or environment variables.
 * 
 * Examples:
 * - Development: VITE_API_URL=http://localhost:3001
 * - Production: VITE_API_URL=https://api.yourdomain.com
 */

// Get API URL from environment variable, fallback to localhost for development
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Helper function to build API endpoint URLs
export const getApiUrl = (endpoint: string): string => {
  // Remove leading slash if present to avoid double slashes
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
  // Ensure API_BASE_URL doesn't have trailing slash
  const cleanBase = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  return `${cleanBase}/${cleanEndpoint}`;
};

// Common API endpoints
export const API_ENDPOINTS = {
  // Auth endpoints
  AUTH: {
    GOOGLE: getApiUrl('api/auth/google'),
    VERIFY: getApiUrl('api/auth/verify'),
    SET_USERNAME: getApiUrl('api/auth/set-username'),
  },
  // Pix endpoints
  PIX: {
    PIX_KEY: (userId?: string) => getApiUrl(userId ? `api/pix/pix-key/${userId}` : 'api/pix/pix-key'),
    TRANSACTIONS: getApiUrl('api/pix/transactions'),
    DEPOSIT_REQUEST: getApiUrl('api/pix/deposit/request'),
    DEPOSIT_STATUS: (transactionId: string) => getApiUrl(`api/pix/deposit/status/${transactionId}`),
    WITHDRAWAL_REQUEST: getApiUrl('api/pix/withdrawal/request'),
    WITHDRAWAL_STATUS: (transactionId: string) => getApiUrl(`api/pix/withdrawal/status/${transactionId}`),
  },
  // Admin endpoints
  ADMIN: {
    USERS: getApiUrl('api/admin/users'),
    REPORTS: getApiUrl('api/admin/reports'),
    STATS: getApiUrl('api/admin/stats'),
    BAN_USER: getApiUrl('api/admin/users/ban'),
    UNBAN_USER: getApiUrl('api/admin/users/unban'),
    UPDATE_BALANCE: getApiUrl('api/admin/users/balance'),
  },
} as const;

// Socket.IO connection URL (removes /api suffix if present)
export const getSocketUrl = (): string => {
  // Remove /api suffix if present, Socket.io connects to root
  return API_BASE_URL.replace(/\/api$/, '');
};

