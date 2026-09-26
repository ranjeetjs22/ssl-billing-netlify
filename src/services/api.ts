export const API_BASE = '/api';

export function getToken(): string | null {
  return localStorage.getItem('ssl_token');
}

export function setToken(token: string) {
  localStorage.setItem('ssl_token', token);
}

export function removeToken() {
  localStorage.removeItem('ssl_token');
}

/**
 * Clear every cache between the user and the database, then reload.
 *
 * Three layers can hold stale data: the server's read cache for settings and
 * users, the browser's HTTP cache, and the Cache Storage API. The sign-in
 * token, theme and sidebar preference are kept, so this is safe to press.
 */
export async function hardRefresh(): Promise<void> {
  try { await apiRequest('/admin/clear-cache', { method: 'POST' }); } catch { /* not fatal */ }
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch { /* storage may be blocked */ }
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((regs || []).map(r => r.unregister()));
  } catch { /* no service worker */ }
  // A cache-busting query on the document URL defeats a cached index.html,
  // so the page comes back with the newest bundle as well as fresh data.
  const url = new URL(window.location.href);
  url.searchParams.set('_r', String(Date.now()));
  window.location.replace(url.toString());
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    // Never let the browser answer an API call from its HTTP cache.
    cache: 'no-store',
    ...options,
    headers,
  });

  if (response.status === 401) {
    removeToken();
    window.dispatchEvent(new Event('auth:unauthorized'));
  }

  if (!response.ok) {
    let errorDetail = 'An error occurred';
    try {
      const errJson = await response.json();
      errorDetail = errJson.detail || errJson.message || JSON.stringify(errJson);
    } catch {
      errorDetail = await response.text();
    }
    throw new Error(errorDetail || `HTTP error ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text() as any;
}
