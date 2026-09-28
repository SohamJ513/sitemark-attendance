CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'employee')),
  site_id       INTEGER,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  -- NULL means "use the assigned site's shift timing". Set to override
  -- punctuality tracking for this employee individually.
  shift_start   TIME,
  grace_minutes INTEGER CHECK (grace_minutes IS NULL OR (grace_minutes >= 0 AND grace_minutes <= 240)),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Upgrade path for databases migrated before per-employee shift overrides existed.
ALTER TABLE users ADD COLUMN IF NOT EXISTS shift_start TIME;
ALTER TABLE users ADD COLUMN IF NOT EXISTS grace_minutes INTEGER;

CREATE TABLE IF NOT EXISTS sites (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  address       TEXT,
  latitude      DOUBLE PRECISION NOT NULL,
  longitude     DOUBLE PRECISION NOT NULL,
  radius_meters INTEGER NOT NULL CHECK (radius_meters > 0),
  shift_start   TIME NOT NULL DEFAULT '09:00',
  grace_minutes INTEGER NOT NULL DEFAULT 10 CHECK (grace_minutes >= 0),
  -- NULL disables auto-absent marking for this site. When set, an employee
  -- with no check-in by (effective shift start + this many minutes) is
  -- automatically marked 'absent' by the background sweep.
  auto_absent_minutes INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Upgrade path for databases migrated before shift timing existed.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS shift_start TIME NOT NULL DEFAULT '09:00';
ALTER TABLE sites ADD COLUMN IF NOT EXISTS grace_minutes INTEGER NOT NULL DEFAULT 10;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS auto_absent_minutes INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_site_fk'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_site_fk FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS attendance (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id         INTEGER NOT NULL REFERENCES sites(id),
  work_date       DATE NOT NULL,
  -- Null for rows the system auto-creates (status = 'absent'), since there
  -- was no check-in at all: no photo, no location.
  photo_path      TEXT,
  latitude        DOUBLE PRECISION,
  longitude       DOUBLE PRECISION,
  accuracy_m      DOUBLE PRECISION,
  distance_m      DOUBLE PRECISION,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'revoked', 'absent')),
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  checkout_at     TIMESTAMPTZ,
  reviewed_by     INTEGER REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  revoke_reason   TEXT,
  note            TEXT,
  UNIQUE (user_id, work_date)
);

CREATE INDEX IF NOT EXISTS attendance_status_idx ON attendance (status, work_date);

-- Upgrade path for databases migrated before absence tracking / checkout existed.
ALTER TABLE attendance ALTER COLUMN photo_path DROP NOT NULL;
ALTER TABLE attendance ALTER COLUMN latitude DROP NOT NULL;
ALTER TABLE attendance ALTER COLUMN longitude DROP NOT NULL;
ALTER TABLE attendance ALTER COLUMN distance_m DROP NOT NULL;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS checkout_at TIMESTAMPTZ;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_status_check;
ALTER TABLE attendance ADD CONSTRAINT attendance_status_check
  CHECK (status IN ('pending', 'approved', 'revoked', 'absent'));