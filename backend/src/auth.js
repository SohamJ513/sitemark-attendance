import jwt from 'jsonwebtoken';
import 'dotenv/config';

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export const signToken = (user) =>
  jwt.sign({ id: user.id, role: user.role, name: user.name }, SECRET, {
    expiresIn: '12h',
  });

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export const requireRole = (role) => (req, res, next) =>
  req.user?.role === role
    ? next()
    : res.status(403).json({ error: 'Forbidden' });
