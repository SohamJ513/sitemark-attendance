import express from 'express';
import cors from 'cors';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

import { query } from './db.js';
import { signToken, requireAuth, requireRole } from './auth.js';
import { distanceMeters, isValidCoord } from './geo.js';
import { uploadPhoto, downloadPhoto, deletePhoto } from './storage.js';

const WORK_TZ = process.env.WORK_TZ || 'Asia/Kolkata';
const MAX_ACCURACY_M = Number(process.env.MAX_ACCURACY_M || 100);

// Photos are held in memory just long enough to validate the check-in and
// push the bytes to Supabase Storage — nothing is written to local disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json());

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const admin = [requireAuth, requireRole('admin')];

// ---------- Auth ----------
app.post(
  '/api/auth/login',
  wrap(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password required' });
    const { rows } = await query(
      'SELECT * FROM users WHERE lower(email) = lower($1)',
      [email]
    );
    const user = rows[0];
    if (!user || !user.active || !bcrypt.compareSync(password, user.password_hash))
      return res.status(401).json({ error: 'Invalid credentials' });
    res.json({
      token: signToken(user),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  })
);

// ---------- Sites (admin) ----------
app.get(
  '/api/sites',
  ...admin,
  wrap(async (_req, res) => {
    const { rows } = await query('SELECT * FROM sites ORDER BY id');
    res.json(rows);
  })
);

// Shared validation for the shift-timing fields used to judge punctuality
// and to decide when the auto-absent sweep should kick in.
function parseShiftFields(body) {
  const shiftStart = (body.shift_start || '09:00').trim();
  const grace = body.grace_minutes === undefined || body.grace_minutes === ''
    ? 10
    : Number(body.grace_minutes);
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(shiftStart)) return { error: 'shift_start must be HH:MM (24-hour)' };
  if (!Number.isFinite(grace) || grace < 0 || grace > 240) return { error: 'grace_minutes must be between 0 and 240' };

  let autoAbsent = null;
  if (body.auto_absent_minutes !== undefined && body.auto_absent_minutes !== '' && body.auto_absent_minutes !== null) {
    autoAbsent = Number(body.auto_absent_minutes);
    if (!Number.isFinite(autoAbsent) || autoAbsent < 0 || autoAbsent > 720)
      return { error: 'auto_absent_minutes must be between 0 and 720, or empty to disable' };
    autoAbsent = Math.round(autoAbsent);
  }
  return { shiftStart, grace: Math.round(grace), autoAbsent };
}

app.post(
  '/api/sites',
  ...admin,
  wrap(async (req, res) => {
    const { name, address, latitude, longitude, radius_meters } = req.body || {};
    const lat = Number(latitude);
    const lng = Number(longitude);
    const radius = Number(radius_meters);
    if (!name || !isValidCoord(lat, lng) || !(radius > 0))
      return res
        .status(400)
        .json({ error: 'name, valid latitude/longitude and radius_meters > 0 required' });
    const shift = parseShiftFields(req.body || {});
    if (shift.error) return res.status(400).json({ error: shift.error });
    const { rows } = await query(
      `INSERT INTO sites (name, address, latitude, longitude, radius_meters, shift_start, grace_minutes, auto_absent_minutes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name, address || null, lat, lng, Math.round(radius), shift.shiftStart, shift.grace, shift.autoAbsent]
    );
    res.status(201).json(rows[0]);
  })
);

app.put(
  '/api/sites/:id',
  ...admin,
  wrap(async (req, res) => {
    const { name, address, latitude, longitude, radius_meters } = req.body || {};
    const lat = Number(latitude);
    const lng = Number(longitude);
    const radius = Number(radius_meters);
    if (!name || !isValidCoord(lat, lng) || !(radius > 0))
      return res.status(400).json({ error: 'Invalid site data' });
    const shift = parseShiftFields(req.body || {});
    if (shift.error) return res.status(400).json({ error: shift.error });
    const { rows } = await query(
      `UPDATE sites SET name=$1, address=$2, latitude=$3, longitude=$4, radius_meters=$5,
              shift_start=$6, grace_minutes=$7, auto_absent_minutes=$9
       WHERE id=$8 RETURNING *`,
      [name, address || null, lat, lng, Math.round(radius), shift.shiftStart, shift.grace, req.params.id, shift.autoAbsent]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Site not found' });
    res.json(rows[0]);
  })
);

// Validates a single optional shift-override value. Empty/undefined/null
// means "no override, use the site's default" and is always accepted.
function validateOptionalShiftValue(value, field) {
  if (value === undefined || value === null || value === '') return { value: null };
  if (field === 'shift_start') {
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(value))
      return { error: 'shift_start must be HH:MM (24-hour), or empty to use the site default' };
    return { value };
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 240)
    return { error: 'grace_minutes must be between 0 and 240, or empty to use the site default' };
  return { value: Math.round(n) };
}

// ---------- Employees (admin) ----------
app.get(
  '/api/employees',
  ...admin,
  wrap(async (_req, res) => {
    const { rows } = await query(
      `SELECT u.id, u.name, u.email, u.active, u.site_id, s.name AS site_name,
              u.shift_start, u.grace_minutes,
              s.shift_start AS site_shift_start, s.grace_minutes AS site_grace_minutes
       FROM users u LEFT JOIN sites s ON s.id = u.site_id
       WHERE u.role = 'employee' ORDER BY u.name`
    );
    res.json(rows);
  })
);

app.post(
  '/api/employees',
  ...admin,
  wrap(async (req, res) => {
    const { name, email, password, site_id } = req.body || {};
    if (!name || !email || !password || password.length < 6)
      return res
        .status(400)
        .json({ error: 'name, email and password (min 6 chars) required' });
    const shiftStart = validateOptionalShiftValue(req.body?.shift_start, 'shift_start');
    if (shiftStart.error) return res.status(400).json({ error: shiftStart.error });
    const grace = validateOptionalShiftValue(req.body?.grace_minutes, 'grace_minutes');
    if (grace.error) return res.status(400).json({ error: grace.error });
    try {
      const { rows } = await query(
        `INSERT INTO users (name, email, password_hash, role, site_id, shift_start, grace_minutes)
         VALUES ($1,$2,$3,'employee',$4,$5,$6)
         RETURNING id, name, email, site_id, active, shift_start, grace_minutes`,
        [name, email, bcrypt.hashSync(password, 10), site_id || null, shiftStart.value, grace.value]
      );
      res.status(201).json(rows[0]);
    } catch (e) {
      if (e.code === '23505')
        return res.status(409).json({ error: 'Email already in use' });
      throw e;
    }
  })
);

app.patch(
  '/api/employees/:id',
  ...admin,
  wrap(async (req, res) => {
    const body = req.body || {};
    const { site_id, active } = body;
    const shiftStartGiven = 'shift_start' in body;
    const graceGiven = 'grace_minutes' in body;
    const shiftStart = validateOptionalShiftValue(body.shift_start, 'shift_start');
    if (shiftStart.error) return res.status(400).json({ error: shiftStart.error });
    const grace = validateOptionalShiftValue(body.grace_minutes, 'grace_minutes');
    if (grace.error) return res.status(400).json({ error: grace.error });
    const { rows } = await query(
      `UPDATE users SET
         site_id = CASE WHEN $1::boolean THEN $2::int ELSE site_id END,
         active  = COALESCE($3, active),
         shift_start = CASE WHEN $5::boolean THEN $6::time ELSE shift_start END,
         grace_minutes = CASE WHEN $7::boolean THEN $8::int ELSE grace_minutes END
       WHERE id = $4 AND role = 'employee'
       RETURNING id, name, email, site_id, active, shift_start, grace_minutes`,
      [
        'site_id' in body,
        site_id || null,
        typeof active === 'boolean' ? active : null,
        req.params.id,
        shiftStartGiven,
        shiftStart.value,
        graceGiven,
        grace.value,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Employee not found' });
    res.json(rows[0]);
  })
);

// ---------- Employee: my site + today's status ----------
app.get(
  '/api/me/today',
  requireAuth,
  requireRole('employee'),
  wrap(async (req, res) => {
    const site = await query(
      `SELECT s.id, s.name, s.address, s.latitude, s.longitude, s.radius_meters,
              COALESCE(u.shift_start, s.shift_start) AS shift_start,
              COALESCE(u.grace_minutes, s.grace_minutes) AS grace_minutes
       FROM users u JOIN sites s ON s.id = u.site_id WHERE u.id = $1`,
      [req.user.id]
    );
    const att = await query(
      `SELECT a.id, a.status, a.submitted_at, a.distance_m, a.revoke_reason,
              a.checkout_at, a.note,
              GREATEST(0, ROUND(EXTRACT(EPOCH FROM
                ((a.submitted_at AT TIME ZONE $2)::time - COALESCE(u.shift_start, s.shift_start))) / 60))::int AS late_minutes,
              COALESCE(u.grace_minutes, s.grace_minutes) AS grace_minutes
       FROM attendance a
       JOIN sites s ON s.id = a.site_id
       JOIN users u ON u.id = a.user_id
       WHERE a.user_id = $1 AND a.work_date = (now() AT TIME ZONE $2)::date`,
      [req.user.id, WORK_TZ]
    );
    res.json({ site: site.rows[0] || null, attendance: att.rows[0] || null });
  })
);

app.get(
  '/api/me/history',
  requireAuth,
  requireRole('employee'),
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT a.id, a.work_date, a.status, a.submitted_at, a.distance_m, a.revoke_reason,
              a.checkout_at, a.note,
              GREATEST(0, ROUND(EXTRACT(EPOCH FROM
                ((a.submitted_at AT TIME ZONE $2)::time - COALESCE(u.shift_start, s.shift_start))) / 60))::int AS late_minutes,
              COALESCE(u.grace_minutes, s.grace_minutes) AS grace_minutes
       FROM attendance a
       JOIN sites s ON s.id = a.site_id
       JOIN users u ON u.id = a.user_id
       WHERE a.user_id = $1 ORDER BY a.work_date DESC LIMIT 60`,
      [req.user.id, WORK_TZ]
    );
    res.json(rows);
  })
);

// ---------- Employee: check-in (photo + location, geofenced) ----------
app.post(
  '/api/attendance/check-in',
  requireAuth,
  requireRole('employee'),
  // Reject before touching the upload if today is already settled (in
  // particular, auto-marked 'absent' by the sweep below) — avoids wasting a
  // photo upload and gives a clearer message than a generic conflict.
  wrap(async (req, res, next) => {
    const existing = await query(
      `SELECT status FROM attendance WHERE user_id = $1 AND work_date = (now() AT TIME ZONE $2)::date`,
      [req.user.id, WORK_TZ]
    );
    const status = existing.rows[0]?.status;
    if (status === 'absent') {
      return res.status(409).json({
        error: 'You were marked absent for today because no check-in arrived within the allowed window. Contact your admin if this is a mistake.',
      });
    }
    if (status) return res.status(409).json({ error: "You've already checked in today" });
    next();
  }),
  upload.single('photo'),
  wrap(async (req, res) => {
    const lat = Number(req.body.latitude);
    const lng = Number(req.body.longitude);
    const accuracy = req.body.accuracy ? Number(req.body.accuracy) : null;

    if (!req.file) return res.status(400).json({ error: 'A photo is required' });
    if (!isValidCoord(lat, lng)) {
      return res.status(400).json({ error: 'A valid location is required' });
    }
    if (accuracy !== null && accuracy > MAX_ACCURACY_M) {
      return res.status(400).json({
        error: `GPS accuracy too low (${Math.round(accuracy)} m). Move to an open area and retry.`,
      });
    }

    const siteRes = await query(
      `SELECT s.* FROM users u JOIN sites s ON s.id = u.site_id WHERE u.id = $1`,
      [req.user.id]
    );
    const site = siteRes.rows[0];
    if (!site) {
      return res.status(400).json({ error: 'No site assigned to you. Contact admin.' });
    }

    const dist = distanceMeters(lat, lng, site.latitude, site.longitude);
    if (dist > site.radius_meters) {
      return res.status(403).json({
        error: `You are ${Math.round(dist)} m from ${site.name}. You must be within ${site.radius_meters} m.`,
        distance_m: Math.round(dist),
        radius_m: site.radius_meters,
      });
    }

    // Only touch storage once every other check has passed, so a rejected
    // check-in never leaves an orphaned file behind.
    const photoPath = `${req.user.id}/${crypto.randomUUID()}.jpg`;
    await uploadPhoto(photoPath, req.file.buffer, req.file.mimetype);

    try {
      const { rows } = await query(
        `INSERT INTO attendance
           (user_id, site_id, work_date, photo_path, latitude, longitude, accuracy_m, distance_m)
         VALUES ($1,$2,(now() AT TIME ZONE $3)::date,$4,$5,$6,$7,$8)
         RETURNING id, status, submitted_at, distance_m`,
        [req.user.id, site.id, WORK_TZ, photoPath, lat, lng, accuracy, dist]
      );
      res.status(201).json(rows[0]);
    } catch (e) {
      await deletePhoto(photoPath);
      if (e.code === '23505')
        return res.status(409).json({ error: "You've already checked in today" });
      throw e;
    }
  })
);

// ---------- Employee: end shift (checkout) ----------
app.post(
  '/api/attendance/checkout',
  requireAuth,
  requireRole('employee'),
  wrap(async (req, res) => {
    const { rows } = await query(
      `UPDATE attendance
       SET checkout_at = now()
       WHERE user_id = $1
         AND work_date = (now() AT TIME ZONE $2)::date
         AND status IN ('pending', 'approved')
         AND checkout_at IS NULL
       RETURNING id, checkout_at`,
      [req.user.id, WORK_TZ]
    );
    if (!rows[0]) {
      const existing = await query(
        `SELECT status, checkout_at FROM attendance WHERE user_id = $1 AND work_date = (now() AT TIME ZONE $2)::date`,
        [req.user.id, WORK_TZ]
      );
      const rec = existing.rows[0];
      if (!rec) return res.status(404).json({ error: 'Check in before ending your shift.' });
      if (rec.checkout_at) return res.status(409).json({ error: 'Shift already ended for today.' });
      return res.status(409).json({ error: 'Cannot end shift on a revoked or absent day.' });
    }
    res.json(rows[0]);
  })
);

// ---------- Admin: review ----------
app.get(
  '/api/attendance',
  ...admin,
  wrap(async (req, res) => {
    const { status, date, employee_id } = req.query;
    const params = [WORK_TZ];
    const where = [];
    if (status) {
      params.push(status);
      where.push(`a.status = $${params.length}`);
    }
    if (date) {
      params.push(date);
      where.push(`a.work_date = $${params.length}::date`);
    }
    if (employee_id) {
      params.push(Number(employee_id));
      where.push(`a.user_id = $${params.length}`);
    }
    const { rows } = await query(
      `SELECT a.id, a.work_date, a.status, a.submitted_at, a.reviewed_at, a.revoke_reason,
              a.latitude, a.longitude, a.accuracy_m, a.distance_m, a.checkout_at, a.note,
              u.id AS user_id, u.name AS employee_name, u.email,
              s.name AS site_name, s.latitude AS site_lat, s.longitude AS site_lng,
              s.radius_meters,
              COALESCE(u.shift_start, s.shift_start) AS shift_start,
              COALESCE(u.grace_minutes, s.grace_minutes) AS grace_minutes,
              GREATEST(0, ROUND(EXTRACT(EPOCH FROM
                ((a.submitted_at AT TIME ZONE $1)::time - COALESCE(u.shift_start, s.shift_start))) / 60))::int AS late_minutes,
              (now() AT TIME ZONE $1)::date AS today
       FROM attendance a
       JOIN users u ON u.id = a.user_id
       JOIN sites s ON s.id = a.site_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY a.submitted_at DESC LIMIT 500`,
      params
    );
    res.json(rows);
  })
);

app.get(
  '/api/attendance/:id/photo',
  requireAuth,
  wrap(async (req, res) => {
    const { rows } = await query(
      'SELECT photo_path, user_id FROM attendance WHERE id = $1',
      [req.params.id]
    );
    const rec = rows[0];
    if (!rec || !rec.photo_path) return res.status(404).end();
    if (req.user.role !== 'admin' && rec.user_id !== req.user.id)
      return res.status(403).end();
    try {
      const buffer = await downloadPhoto(rec.photo_path);
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'private, max-age=3600');
      res.send(buffer);
    } catch {
      res.status(404).end();
    }
  })
);

// Approve one (also lets admin re-approve a previously revoked record)
app.post(
  '/api/attendance/:id/approve',
  ...admin,
  wrap(async (req, res) => {
    const { rows } = await query(
      `UPDATE attendance
       SET status='approved', reviewed_by=$1, reviewed_at=now(), revoke_reason=NULL
       WHERE id=$2 AND status IN ('pending','revoked')
       RETURNING id, status`,
      [req.user.id, req.params.id]
    );
    if (!rows[0])
      return res.status(404).json({ error: 'Record not found or already approved' });
    res.json(rows[0]);
  })
);

// Approve everything pending (optionally only for one date)
app.post(
  '/api/attendance/approve-all',
  ...admin,
  wrap(async (req, res) => {
    const { date } = req.body || {};
    const params = [req.user.id];
    let extra = '';
    if (date) {
      params.push(date);
      extra = 'AND work_date = $2::date';
    }
    const { rowCount } = await query(
      `UPDATE attendance
       SET status='approved', reviewed_by=$1, reviewed_at=now()
       WHERE status='pending' ${extra}`,
      params
    );
    res.json({ approved: rowCount });
  })
);

// Revoke an approved (or pending) record
app.post(
  '/api/attendance/:id/revoke',
  ...admin,
  wrap(async (req, res) => {
    const reason = (req.body?.reason || '').toString().slice(0, 300) || null;
    const { rows } = await query(
      `UPDATE attendance
       SET status='revoked', reviewed_by=$1, reviewed_at=now(), revoke_reason=$3
       WHERE id=$2 AND status IN ('approved','pending')
       RETURNING id, status`,
      [req.user.id, req.params.id, reason]
    );
    if (!rows[0])
      return res.status(404).json({ error: 'Record not found or already revoked' });
    res.json(rows[0]);
  })
);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

// ---------- Background sweep: auto-mark absent past the buffer window ----------
// For any active employee whose site has auto_absent_minutes set, if the
// clock has passed (effective shift start + that many minutes) and no
// attendance row exists yet for today, create one with status 'absent'.
// Sites/employees that never set auto_absent_minutes are completely
// unaffected (existing behavior for anyone who hasn't opted in).
const AUTO_ABSENT_SWEEP_SQL = `
  INSERT INTO attendance (user_id, site_id, work_date, status, submitted_at, note)
  SELECT u.id, u.site_id, (now() AT TIME ZONE $1)::date, 'absent', now(),
         'Auto-marked absent: no check-in within the allowed window.'
  FROM users u
  JOIN sites s ON s.id = u.site_id
  WHERE u.role = 'employee'
    AND u.active = true
    AND s.auto_absent_minutes IS NOT NULL
    AND (now() AT TIME ZONE $1)::time >
        (COALESCE(u.shift_start, s.shift_start) + (s.auto_absent_minutes || ' minutes')::interval)::time
    AND NOT EXISTS (
      SELECT 1 FROM attendance a
      WHERE a.user_id = u.id AND a.work_date = (now() AT TIME ZONE $1)::date
    )
  ON CONFLICT (user_id, work_date) DO NOTHING
`;

async function sweepAutoAbsences() {
  try {
    const { rowCount } = await query(AUTO_ABSENT_SWEEP_SQL, [WORK_TZ]);
    if (rowCount) console.log(`Auto-absent sweep marked ${rowCount} employee(s) absent.`);
  } catch (err) {
    console.error('Auto-absent sweep failed:', err.message);
  }
}

const port = Number(process.env.PORT || 4000);
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(port, () => console.log(`API listening on :${port}`));
  sweepAutoAbsences();
  setInterval(sweepAutoAbsences, 60 * 1000);
}

export default app;
export { sweepAutoAbsences };