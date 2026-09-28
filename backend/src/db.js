import pg from 'pg';
import 'dotenv/config';

const connectionString =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/attendance';

// Supabase (and most managed Postgres hosts) require SSL; local Postgres doesn't have it
// set up at all, so we auto-detect by host and let DB_SSL override either way if needed.
const needsSSL =
  process.env.DB_SSL === 'true' ||
  (process.env.DB_SSL !== 'false' && /supabase\.(co|com)/.test(connectionString));

export const pool = new pg.Pool({
  connectionString,
  ssl: needsSSL ? { rejectUnauthorized: false } : false,
});

export const query = (text, params) => pool.query(text, params);