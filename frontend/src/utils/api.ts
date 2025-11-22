import { API_BASE_URL, getApiUrl } from '../config/api';

/**
 * Utility function to make authenticated API requests
 * 
 * @param url - Full URL or endpoint path (if endpoint, will be prefixed with API_BASE_URL)
 * @param options - Fetch options
 * @returns Promise<Response>
 */
export const authenticatedFetch = async (
  url: string,
  options: RequestInit = {},
): Promise<Response> => {
  const token = localStorage.getItem('authToken');
  
  const headers = new Headers(options.headers);
  
  // Add Authorization header if token exists
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  
  // Add Content-Type if not already set and body exists
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  
  // If url doesn't start with http, treat it as an endpoint and prepend API_BASE_URL
  const fullUrl = url.startsWith('http') ? url : getApiUrl(url);
  
  return fetch(fullUrl, {
    ...options,
    headers,
  });
};

/**
 * Get the auth token from localStorage
 */
export const getAuthToken = (): string | null => {
  return localStorage.getItem('authToken');
};

/**
 * Clear all auth-related data from localStorage
 */
export const clearAuth = (): void => {
  localStorage.removeItem('authToken');
  localStorage.removeItem('userId');
  localStorage.removeItem('username');
  localStorage.removeItem('userType');
};

