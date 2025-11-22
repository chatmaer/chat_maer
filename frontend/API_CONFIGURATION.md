# Frontend API Configuration

This document explains how to configure the backend API URL for the frontend application.

## Overview

The frontend now uses a **centralized API configuration** located in `src/config/api.ts`. This eliminates the need to hardcode API URLs throughout the codebase.

## Environment Variable

Set the `VITE_API_URL` environment variable to point to your backend server:

```bash
# Development (local)
VITE_API_URL=http://localhost:3001

# Production
VITE_API_URL=https://api.yourdomain.com
```

## Configuration File

The main configuration is in `src/config/api.ts`:

- **`API_BASE_URL`**: The base URL for all API requests
- **`getApiUrl(endpoint)`**: Helper function to build full API URLs
- **`API_ENDPOINTS`**: Pre-defined endpoint constants for all API routes
- **`getSocketUrl()`**: Helper function to get Socket.IO connection URL

## Usage Examples

### Using Pre-defined Endpoints

```typescript
import { API_ENDPOINTS } from '../config/api';
import { authenticatedFetch } from '../utils/api';

// Auth endpoints
const response = await fetch(API_ENDPOINTS.AUTH.GOOGLE, { ... });
const response = await authenticatedFetch(API_ENDPOINTS.AUTH.VERIFY, { ... });

// Pix endpoints
const response = await authenticatedFetch(API_ENDPOINTS.PIX.TRANSACTIONS);
const response = await authenticatedFetch(API_ENDPOINTS.PIX.DEPOSIT_REQUEST, { ... });
const response = await authenticatedFetch(API_ENDPOINTS.PIX.DEPOSIT_STATUS(transactionId));

// Admin endpoints
const response = await authenticatedFetch(API_ENDPOINTS.ADMIN.USERS);
```

### Using Helper Functions

```typescript
import { getApiUrl, getSocketUrl } from '../config/api';

// Build custom endpoint URL
const customUrl = getApiUrl('api/custom/endpoint');

// Get Socket.IO URL
const socketUrl = getSocketUrl();
```

### Using authenticatedFetch with Endpoints

The `authenticatedFetch` utility automatically handles endpoint paths:

```typescript
import { authenticatedFetch } from '../utils/api';
import { API_ENDPOINTS } from '../config/api';

// Full URL (starts with http)
await authenticatedFetch('https://api.example.com/endpoint');

// Endpoint path (automatically prefixed with API_BASE_URL)
await authenticatedFetch(API_ENDPOINTS.PIX.TRANSACTIONS);
await authenticatedFetch('api/custom/endpoint');
```

## Socket.IO Configuration

Socket.IO connections use the `getSocketUrl()` function which automatically:
- Uses `VITE_API_URL` if set
- Removes `/api` suffix if present (Socket.IO connects to root)
- Falls back to `http://localhost:3001` for development

```typescript
import { getSocketUrl } from '../config/api';
import { connectSocket } from '../utils/socket';

const socket = connectSocket(); // Uses getSocketUrl() internally
```

## Files Updated

The following files have been updated to use the centralized configuration:

- ✅ `src/utils/socket.ts` - Socket.IO connection
- ✅ `src/utils/api.ts` - API utility functions
- ✅ `src/pages/Login.tsx` - Google authentication
- ✅ `src/pages/App.tsx` - Token verification
- ✅ `src/pages/AuthCallback.tsx` - Username setting
- ✅ `src/pages/Home.tsx` - Username setting
- ✅ `src/pages/AdminPanel.tsx` - Admin API calls
- ✅ `src/components/PixWallet.tsx` - Pix payment endpoints

## Setting Up Environment Variables

### Local Development

Create a `.env` file in the `frontend` directory:

```bash
VITE_API_URL=http://localhost:3001
```

### Production (Vercel)

In your Vercel project settings, add the environment variable:

```
VITE_API_URL=https://your-backend-domain.com
```

### Production (Other Platforms)

Set the environment variable according to your hosting platform's documentation.

## Benefits

1. **Single Source of Truth**: All API URLs are configured in one place
2. **Type Safety**: Pre-defined endpoints reduce typos and errors
3. **Easy Updates**: Change the backend URL in one place
4. **Environment-Specific**: Different URLs for dev/staging/production
5. **Maintainability**: Easier to add new endpoints and update existing ones

