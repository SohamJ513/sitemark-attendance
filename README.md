# SiteMark: on-site attendance for a logistics team

React PWA + Node/Express + PostgreSQL.

## How it works
- **Employee** logs in, opens the live camera, takes a snap. Their GPS is captured with it.
  Submit unlocks only inside the site radius, and the **server re-checks the distance** (haversine), so the client can't fake it.
- **Admin** sees each pending snap with its location, the distance from the site centre and a map link.
  Approve one, **Approve all** (optionally for one date), or **Revoke** with a reason. Revoked records can be re-approved.
- One check-in per employee per day. Photos are only served to the admin or the owner.
- Admin can add sites (lat/lng/radius; "use my current location" button), add employees and assign them to sites.

## Run locally
```bash
# 1. Database
createdb attendance

# 2. Backend
cd backend
cp .env.example .env        # edit DATABASE_URL and JWT_SECRET
npm install
npm run migrate
npm run seed                # demo admin, employee and a site
npm run dev                 # http://localhost:4000

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

Demo logins (change immediately): `admin@example.com / admin123`, `employee@example.com / employee123`.
Edit the seeded site's coordinates (Admin > Sites) to your real location.

## Important for real phones
- Browsers only allow **camera and GPS over HTTPS** (localhost is exempt). Deploy behind HTTPS, or use a tunnel such as ngrok while testing.
- Set `WORK_TZ` (default `Asia/Kolkata`) to define when "today" rolls over.
- `MAX_ACCURACY_M` (default 100) rejects check-ins with a weak GPS fix.

## Known limits (MVP)
- GPS spoofing apps can still fool browser location. The live-camera-only snap and admin review are the mitigations. Stronger options: native app with mock-location detection, or Wi-Fi/QR verification at the gate.
- Photos are stored on local disk (`backend/uploads`). Move to S3 or similar for production.
- No password reset, check-out time or reports/export yet.

## Tests
`cd backend && npm test` runs the geofence maths tests.
