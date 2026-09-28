const TOKEN_KEY = 'sitemark_token';
const USER_KEY = 'sitemark_user';

// In local dev, Vite proxies /api to the backend (vite.config.js), so a
// relative path works. In production the frontend and backend are on
// different domains (e.g. Vercel + Render), so a deployed build needs
// VITE_API_URL set to the backend's full URL at build time.
const API_BASE = import.meta.env.VITE_API_URL || '/api';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const getUser = () => {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
};
export const saveSession = (token, user) => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
};
export const clearSession = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
};

async function request(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API_BASE}${path}`, { method, headers, body: payload });
  if (res.status === 401 && token) {
    clearSession();
    window.location.reload();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  // employee
  myToday: () => request('/me/today'),
  myHistory: () => request('/me/history'),
  checkIn: (form) => request('/attendance/check-in', { method: 'POST', form }),
  checkout: () => request('/attendance/checkout', { method: 'POST' }),
  // admin
  attendance: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return request(`/attendance${qs ? `?${qs}` : ''}`);
  },
  approve: (id) => request(`/attendance/${id}/approve`, { method: 'POST' }),
  approveAll: (date) => request('/attendance/approve-all', { method: 'POST', body: { date } }),
  revoke: (id, reason) => request(`/attendance/${id}/revoke`, { method: 'POST', body: { reason } }),
  sites: () => request('/sites'),
  createSite: (b) => request('/sites', { method: 'POST', body: b }),
  updateSite: (id, b) => request(`/sites/${id}`, { method: 'PUT', body: b }),
  employees: () => request('/employees'),
  createEmployee: (b) => request('/employees', { method: 'POST', body: b }),
  updateEmployee: (id, b) => request(`/employees/${id}`, { method: 'PATCH', body: b }),
};

// Photos need the auth header, so fetch as a blob and hand back an object URL.
export async function fetchPhotoUrl(id) {
  const res = await fetch(`${API_BASE}/attendance/${id}/photo`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error('Photo unavailable');
  return URL.createObjectURL(await res.blob());
}