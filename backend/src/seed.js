import bcrypt from 'bcryptjs';
import { pool } from './db.js';

const hash = (p) => bcrypt.hashSync(p, 10);

const site = await pool.query(
  `INSERT INTO sites (name, address, latitude, longitude, radius_meters)
   VALUES ('Main Warehouse', 'Sample address', 18.5204, 73.8567, 150)
   RETURNING id`
);
const siteId = site.rows[0].id;

await pool.query(
  `INSERT INTO users (name, email, password_hash, role)
   VALUES ('Admin', 'admin@example.com', $1, 'admin')
   ON CONFLICT (email) DO NOTHING`,
  [hash('admin123')]
);
await pool.query(
  `INSERT INTO users (name, email, password_hash, role, site_id)
   VALUES ('Demo Employee', 'employee@example.com', $1, 'employee', $2)
   ON CONFLICT (email) DO NOTHING`,
  [hash('employee123'), siteId]
);

console.log('Seeded. Admin: admin@example.com / admin123');
console.log('Employee: employee@example.com / employee123');
console.log('Change these passwords and the site coordinates before real use.');
await pool.end();
